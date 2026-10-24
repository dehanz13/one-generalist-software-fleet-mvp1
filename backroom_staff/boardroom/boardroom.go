// Package boardroom loads and checks the club config,
// set_pieces/boardroom/club.config.yaml: the project's own rules, the
// defaults, the qa checks and the roster of players. (Legacy:
// agents.load_config, agents.validate and the config types in data_types.py.)
//
// Every set piece validates its players before it runs: a missing or
// misnamed player fails before anything spawns.
package boardroom

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

// DefaultPath is where the config lives in a repository; CLUB_CONFIG overrides it.
const DefaultPath = "set_pieces/boardroom/club.config.yaml"

// DefaultModel is the roster's default model, provider/id.
const DefaultModel = "anthropic/claude-sonnet-5-5"

// Clubs are the agent programs a player can run on.
var Clubs = []string{"pi", "claude_code", "scripted"}

// TeamTalks are a player's two prompt files. (Legacy: prompt_engineering.)
type TeamTalks struct {
	System string `yaml:"system" json:"system"`
	User   string `yaml:"user" json:"user"`
}

// Player is one role in the roster. (Legacy: AgentConfig.)
type Player struct {
	Name     string `yaml:"name" json:"name"`
	Club     string `yaml:"club" json:"club"`
	Model    string `yaml:"model" json:"model"`
	Thinking string `yaml:"thinking" json:"thinking"` // off | minimal | low | medium | high | xhigh | max
	Color    string `yaml:"color" json:"color"`       // hex swatch for this player's lane on the page
	Purpose  string `yaml:"purpose" json:"purpose"`

	TeamTalks    TeamTalks `yaml:"team_talks" json:"team_talks"`
	Enchantments []string  `yaml:"enchantments" json:"enchantments"` // extensions loaded into the club (pi -e)

	// Tools is an allowlist; nil means every tool.
	Tools []string `yaml:"tools" json:"tools"`

	// Writes is what this player may MODIFY in the repo, enforced in code
	// after every call (package restrictedarea). `tools` cannot express it:
	// `bash` runs anything and `write` reaches any path.
	//   nil   unrestricted, except the roster-wide restricted_area
	//   []    read-only: may modify nothing tracked
	//   [...] only these. A trailing "/" is a directory prefix; "*" makes a
	//         glob; anything else is an exact path.
	Writes []string `yaml:"writes" json:"writes"`
}

// Defaults fill every player's missing keys.
type Defaults struct {
	Club         string   `yaml:"club"`
	Model        string   `yaml:"model"`
	Thinking     string   `yaml:"thinking"`
	Color        string   `yaml:"color"`
	Enchantments []string `yaml:"enchantments"`
	Tools        []string `yaml:"tools"`
	// Off-limits to every player that has not named them in its own
	// `writes`: a player must not be able to edit the machinery that decides
	// whether its work passed. (Legacy: protected_files.)
	RestrictedArea []string `yaml:"restricted_area"`
	DataDir        string   `yaml:"data_dir"`
}

// Var is where the match log lives. (Legacy: observability.)
type Var struct {
	MatchLog string `yaml:"match_log"`
	// How often a running match sends its rows to Matchday Live, when a
	// relay is set up. (Legacy's poll_ms was the page's poll interval; the
	// page no longer polls.)
	FlushMS int `yaml:"flush_ms"`
}

// QACheck is one deterministic qa command. (Legacy: QualityCheckSpec, with
// the command moved from code into the config.)
type QACheck struct {
	Name           string   `yaml:"name" json:"name"`
	Area           string   `yaml:"area" json:"area"`           // frontend | backend
	Operation      string   `yaml:"operation" json:"operation"` // lint | typecheck | build | test
	Argv           []string `yaml:"argv" json:"argv"`
	TimeoutSeconds int      `yaml:"timeout_seconds" json:"timeout_seconds"`
	// Diagnostics names the parser that turns a failure into identities for
	// the progressive gate: eslint, tsc, or empty for exit-code only.
	Diagnostics string `yaml:"diagnostics" json:"diagnostics"`
}

// QA is the qa section.
type QA struct {
	Checks []QACheck `yaml:"checks"`
}

// ClubRules are the choices that are right in one project and wrong in
// another, told to every player. (Legacy: ProjectConventions.)
type ClubRules struct {
	// Who unmounts rendered trees between tests: each test file (`manual`),
	// or the project's test setup file for all of them (`global`).
	RTLCleanup string `yaml:"rtl_cleanup"`
	// The attribute Testing Library's `getByTestId` reads in this project,
	// and the side-effect import a test file needs for that to be true.
	TestIDAttribute string `yaml:"test_id_attribute"`
	TestIDImport    string `yaml:"test_id_import"`
	// Anything else a player must know about THIS repo: one imperative
	// sentence each.
	Notes []string `yaml:"notes"`
}

// Project is this project's own settings.
type Project struct {
	Name      string    `yaml:"name"`
	ClubRules ClubRules `yaml:"club_rules"`
}

// UpcomingSource is one place planned tickets are read from.
type UpcomingSource struct {
	// Kind is markdown, or linear (designed for; arrives later).
	Kind string `yaml:"kind"`
	// Path is a glob of markdown files, relative to the repository root.
	Path string `yaml:"path"`
}

// Upcoming is where planned work comes from. (New: Upcoming Matches.)
type Upcoming struct {
	Sources []UpcomingSource `yaml:"sources"`
	// DefaultTime is when a ticket with a date and no time is due: HH:MM.
	DefaultTime string `yaml:"default_time"`
	// Timezone is the IANA zone ticket dates are read in; empty means the Mac's own.
	Timezone string `yaml:"timezone"`
}

// Scheduler is how `ogsf scheduler` behaves on this Mac. (New.)
type Scheduler struct {
	// PollSeconds is how often it reads the sources and looks for work.
	PollSeconds int `yaml:"poll_seconds"`
	// AcceptRemote lets it take requests from Matchday Live, the Claude
	// connector and `ogsf request`. Off unless the founder turns it on.
	AcceptRemote bool `yaml:"accept_remote"`
	// AllowedSetPieces are the set pieces a request may start by name. A
	// request for a ticket the founder wrote is allowed whatever its set piece.
	AllowedSetPieces []string `yaml:"allowed_set_pieces"`
}

// Config is the whole club config. (Legacy: OGSFConfig.)
type Config struct {
	Project   Project   `yaml:"project"`
	Defaults  Defaults  `yaml:"defaults"`
	Var       Var       `yaml:"var"`
	QA        QA        `yaml:"qa"`
	Upcoming  Upcoming  `yaml:"upcoming"`
	Scheduler Scheduler `yaml:"scheduler"`
	Players   []Player  `yaml:"players"`
}

// DefaultRestrictedArea protects the club's own machinery in a repository.
var DefaultRestrictedArea = []string{"set_pieces/boardroom/", "set_pieces/playbooks/"}

// DefaultQAChecks are legacy's four checks, with legacy's time limits.
func DefaultQAChecks() []QACheck {
	return []QACheck{
		{Name: "lint", Area: "frontend", Operation: "lint", Argv: []string{"npm", "run", "lint"}, TimeoutSeconds: 180, Diagnostics: "eslint"},
		{Name: "typecheck", Area: "frontend", Operation: "typecheck", Argv: []string{"npm", "run", "typecheck"}, TimeoutSeconds: 300, Diagnostics: "tsc"},
		// Hosted unit+coverage once took over twenty minutes; ten is too narrow.
		{Name: "test", Area: "frontend", Operation: "test", Argv: []string{"npm", "run", "test"}, TimeoutSeconds: 1800},
		{Name: "build", Area: "frontend", Operation: "build", Argv: []string{"npm", "run", "build"}, TimeoutSeconds: 600},
	}
}

// Default is the config with every default filled in and no players.
func Default() *Config {
	return &Config{
		Project: Project{ClubRules: ClubRules{RTLCleanup: "manual", TestIDAttribute: "data-testid", Notes: []string{}}},
		Defaults: Defaults{
			Club: "pi", Model: DefaultModel, Thinking: "medium",
			Enchantments: []string{}, RestrictedArea: append([]string(nil), DefaultRestrictedArea...),
			DataDir: "set_pieces/clubhouse",
		},
		Var: Var{MatchLog: "set_pieces/clubhouse/match_log.db", FlushMS: 1000},
		QA:  QA{Checks: DefaultQAChecks()},
		Upcoming: Upcoming{
			Sources:     []UpcomingSource{{Kind: "markdown", Path: "set_pieces/upcoming/*.md"}},
			DefaultTime: "09:00",
		},
		Scheduler: Scheduler{PollSeconds: 30, AllowedSetPieces: []string{"ask", "scout-opposition", "team-talk"}},
	}
}

// Load reads a config file. Like legacy, each player's missing `club, model,
// thinking, color, tools, writes` come from `defaults` when `defaults` sets
// them, and its missing `enchantments` from `defaults.enchantments`.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return Parse(data)
}

// Parse reads a config from YAML text.
func Parse(data []byte) (*Config, error) {
	var raw map[string]any
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("club config: %w", err)
	}
	if raw == nil {
		raw = map[string]any{}
	}
	defaults, _ := raw["defaults"].(map[string]any)
	if players, ok := raw["players"].([]any); ok {
		for _, item := range players {
			player, ok := item.(map[string]any)
			if !ok {
				continue
			}
			for _, key := range []string{"club", "model", "thinking", "color", "tools", "writes"} {
				if value, has := defaults[key]; has {
					if _, set := player[key]; !set {
						player[key] = value
					}
				}
			}
			if _, set := player["enchantments"]; !set {
				if value, has := defaults["enchantments"]; has {
					player["enchantments"] = value
				} else {
					player["enchantments"] = []any{}
				}
			}
		}
	}

	cfg := Default()
	// The project block forbids unknown keys: a typo in a rule's name must
	// fail the load, not select a default nobody chose.
	if project, has := raw["project"]; has {
		var strict Project
		strict.ClubRules = cfg.Project.ClubRules
		if err := decodeStrict(project, &strict); err != nil {
			return nil, fmt.Errorf("club config: project: %w", err)
		}
		cfg.Project = strict
		delete(raw, "project")
	}
	if err := decodeLoose(raw, cfg); err != nil {
		return nil, fmt.Errorf("club config: %w", err)
	}
	for i := range cfg.Players {
		fillPlayer(&cfg.Players[i])
	}
	if err := cfg.check(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// FromProject builds a config with a project block from a map, for tests
// that construct a config the way legacy's OGSFConfig(project={...}) did.
func FromProject(project map[string]any) (*Config, error) {
	data, err := yaml.Marshal(map[string]any{"project": project})
	if err != nil {
		return nil, err
	}
	return Parse(data)
}

func fillPlayer(p *Player) {
	if p.Club == "" {
		p.Club = "pi"
	}
	if p.Model == "" {
		p.Model = DefaultModel
	}
	if p.Thinking == "" {
		p.Thinking = "medium"
	}
	if p.Enchantments == nil {
		p.Enchantments = []string{}
	}
}

func decodeStrict(value any, out any) error {
	data, err := yaml.Marshal(value)
	if err != nil {
		return err
	}
	decoder := yaml.NewDecoder(bytes.NewReader(data))
	decoder.KnownFields(true)
	// An empty block decodes as nothing, not as an error.
	if err := decoder.Decode(out); err != nil && !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func decodeLoose(value any, out any) error {
	data, err := yaml.Marshal(value)
	if err != nil {
		return err
	}
	return yaml.Unmarshal(data, out)
}

// RTLCleanupValues are the values rtl_cleanup accepts. A typo must fail the
// load, not select a default nobody chose. Package clubrules writes an
// instruction for each, and a test holds the two lists together.
var RTLCleanupValues = []string{"manual", "global"}

func (c *Config) check() error {
	var problems []string
	if !oneOf(c.Project.ClubRules.RTLCleanup, RTLCleanupValues) {
		problems = append(problems, fmt.Sprintf("project.club_rules.rtl_cleanup: %q is not one of %s",
			c.Project.ClubRules.RTLCleanup, strings.Join(RTLCleanupValues, ", ")))
	}
	if !oneOf(c.Defaults.Club, Clubs) {
		problems = append(problems, fmt.Sprintf("defaults.club: %q is not one of %s", c.Defaults.Club, strings.Join(Clubs, ", ")))
	}
	for _, p := range c.Players {
		if !oneOf(p.Club, Clubs) {
			problems = append(problems, fmt.Sprintf("player %q: club %q is not one of %s", p.Name, p.Club, strings.Join(Clubs, ", ")))
		}
	}
	for _, q := range c.QA.Checks {
		if !oneOf(q.Area, []string{"frontend", "backend"}) {
			problems = append(problems, fmt.Sprintf("qa check %q: area %q is not frontend or backend", q.Name, q.Area))
		}
		if !oneOf(q.Operation, []string{"lint", "typecheck", "build", "test"}) {
			problems = append(problems, fmt.Sprintf("qa check %q: operation %q is not lint, typecheck, build or test", q.Name, q.Operation))
		}
		if !oneOf(q.Diagnostics, []string{"", "eslint", "tsc"}) {
			problems = append(problems, fmt.Sprintf("qa check %q: diagnostics %q is not eslint, tsc or empty", q.Name, q.Diagnostics))
		}
		if len(q.Argv) == 0 {
			problems = append(problems, fmt.Sprintf("qa check %q: argv is empty", q.Name))
		}
	}
	for _, src := range c.Upcoming.Sources {
		if !oneOf(src.Kind, []string{"markdown", "linear"}) {
			problems = append(problems, fmt.Sprintf("upcoming source %q: kind is not markdown or linear", src.Kind))
		}
		if src.Kind == "markdown" && src.Path == "" {
			problems = append(problems, "upcoming markdown source: path is empty")
		}
	}
	if !validClock(c.Upcoming.DefaultTime) {
		problems = append(problems, fmt.Sprintf("upcoming.default_time: %q is not HH:MM", c.Upcoming.DefaultTime))
	}
	if c.Upcoming.Timezone != "" {
		if _, err := time.LoadLocation(c.Upcoming.Timezone); err != nil {
			problems = append(problems, fmt.Sprintf("upcoming.timezone: %v", err))
		}
	}
	if c.Scheduler.PollSeconds < 5 {
		problems = append(problems, "scheduler.poll_seconds: at least 5")
	}
	if len(problems) > 0 {
		return errors.New("club config:\n- " + strings.Join(problems, "\n- "))
	}
	return nil
}

// validClock is true for a 24-hour HH:MM.
func validClock(s string) bool {
	t, err := time.Parse("15:04", s)
	return err == nil && t.Format("15:04") == s
}

// ValidClock reports whether s is a 24-hour HH:MM time.
func ValidClock(s string) bool { return validClock(s) }

func oneOf(value string, allowed []string) bool {
	for _, a := range allowed {
		if value == a {
			return true
		}
	}
	return false
}

// Resolve returns the named player, or an error that lists who is available.
func (c *Config) Resolve(name string) (*Player, error) {
	for i := range c.Players {
		if c.Players[i].Name == name {
			return &c.Players[i], nil
		}
	}
	var names []string
	for _, p := range c.Players {
		names = append(names, p.Name)
	}
	return nil, fmt.Errorf("player %q is not defined in the config — available: [%s]", name, strings.Join(names, ", "))
}

// ModelResolver checks that a club can run a model, for Validate.
type ModelResolver func(club, model string) error

// Validate fails fast: every required name must resolve to a usable player.
// Every problem is collected before failing, so one run of the command
// names them all.
func Validate(c *Config, required []string, resolve ModelResolver) error {
	var problems []string
	for _, name := range required {
		player, err := c.Resolve(name)
		if err != nil {
			problems = append(problems, err.Error())
			continue
		}
		if player.Club == "claude_code" {
			problems = append(problems, fmt.Sprintf("player %q: club %q is not implemented yet (pi or scripted)", name, player.Club))
		}
		for _, ref := range []struct{ label, path string }{{"system", player.TeamTalks.System}, {"user", player.TeamTalks.User}} {
			if info, err := os.Stat(ref.path); err != nil || info.IsDir() {
				problems = append(problems, fmt.Sprintf("player %q: %s team talk not found: %s", name, ref.label, ref.path))
			}
		}
		if resolve != nil {
			if err := resolve(player.Club, player.Model); err != nil {
				problems = append(problems, fmt.Sprintf("player %q: %v", name, err))
			}
		}
	}
	if len(problems) > 0 {
		return errors.New("config validation failed:\n- " + strings.Join(problems, "\n- "))
	}
	return nil
}
