package setpieces

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// PlaybooksDir is where `ogsf write-playbook` writes and `ogsf play` reads.
const PlaybooksDir = "set_pieces/playbooks"

// Playbook is a linear chain of players written as data. (Legacy: make_adw.py
// generated a Python script per chain; Go is compiled, so a chain the founder
// adds is a YAML file instead, run by `ogsf play`. Legacy's generated scripts
// ended with `run.succeeded`, which no longer existed; a playbook always ends
// in Finish.)
type Playbook struct {
	Name        string         `yaml:"name"`
	Description string         `yaml:"description"`
	Steps       []PlaybookStep `yaml:"steps"`
}

// PlaybookStep is one player objective.
type PlaybookStep struct {
	Player      string `yaml:"player"`
	Description string `yaml:"description"`
}

// ReportTypes are the starter roles' report types; any other player answers
// with a GenericReport.
var ReportTypes = map[string]string{
	"playmaker": "TalkReport", "builder": "AttackReport", "ranger": "AnalystReport",
	"safety_officer": "VarReport", "bard": "BardReport",
}

// PlaybookPath finds a playbook by name or path.
func PlaybookPath(nameOrPath string) string {
	if strings.HasSuffix(nameOrPath, ".yaml") || strings.HasSuffix(nameOrPath, ".yml") || strings.Contains(nameOrPath, "/") {
		return nameOrPath
	}
	return filepath.Join(PlaybooksDir, nameOrPath+".yaml")
}

// LoadPlaybook reads and checks a playbook.
func LoadPlaybook(path string) (*Playbook, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var p Playbook
	if err := yaml.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("playbook %s: %w", path, err)
	}
	if len(p.Steps) == 0 {
		return nil, fmt.Errorf("playbook %s has no steps", path)
	}
	return &p, nil
}

func init() {
	register(SetPiece{
		Command: "play", File: "setpiece_play.go",
		Summary: "run a playbook from set_pieces/playbooks/: ogsf play review_docs \"tidy the README\"",
		Chain:   "head_coach(ask) → <each player in the playbook, report to report>",
		Run:     runPlay,
	})
}

func runPlay(d *Deps, a Args) (int, error) {
	if a.Playbook == "" {
		return 1, errors.New("name a playbook: ogsf play <name> \"<prompt>\"")
	}
	book, err := LoadPlaybook(PlaybookPath(a.Playbook))
	if err != nil {
		return 1, err
	}
	seen := map[string]bool{}
	var required []string
	for _, s := range book.Steps {
		if !seen[s.Player] {
			seen[s.Player] = true
			required = append(required, s.Player)
		}
	}
	_, m, err := start(d, a, "play "+book.Name, required)
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	var previous reports.Report
	count := map[string]int{}
	for _, step := range book.Steps {
		count[step.Player]++
		name := step.Player
		if count[step.Player] > 1 {
			name = fmt.Sprintf("%s_%d", step.Player, count[step.Player])
		}
		reportType := ReportTypes[step.Player]
		if reportType == "" {
			reportType = "GenericReport"
		}
		description := step.Description
		if description == "" {
			description = fmt.Sprintf("Run %s over the request and hand its match report on", step.Player)
		}
		if err := m.Objective(match.Params{Name: name, Kind: match.Player, Owner: step.Player, Description: description},
			func(h match.Handle) error {
				report, err := h.Call(match.Call{ReportType: reportType, Prompt: a.Prompt, Previous: previous,
					Reviews: reviews("ball_in_play")})
				previous = report
				return err
			}); err != nil {
			return 1, err
		}
	}
	return m.Finish(true, ""), nil
}

// WritePlaybook writes a new playbook: one player objective per name, each
// handing its report to the next. (Legacy: make_adw.py.)
func WritePlaybook(name string, players []string, force bool) (string, error) {
	if len(players) == 0 {
		return "", errors.New("no players given")
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# A playbook: a chain of players, each handing its match report to the next.\n")
	fmt.Fprintf(&b, "# Run it with: ogsf play %s \"your request\"\n", name)
	fmt.Fprintf(&b, "name: %s\n", name)
	fmt.Fprintf(&b, "description: %q\n", strings.Join(players, " → "))
	b.WriteString("steps:\n")
	for _, p := range players {
		fmt.Fprintf(&b, "  - player: %s\n", p)
		b.WriteString("    # TODO: replace this description — say what THIS objective does and why. It is the\n")
		b.WriteString("    # only intent the record, the console and Matchday Live ever show.\n")
		fmt.Fprintf(&b, "    description: Run %s over the request and hand its match report on\n", p)
	}
	path := filepath.Join(PlaybooksDir, name+".yaml")
	if _, err := os.Stat(path); err == nil && !force {
		return "", fmt.Errorf("%s already exists — use --force to overwrite", path)
	}
	if err := os.MkdirAll(PlaybooksDir, 0o755); err != nil {
		return "", err
	}
	return path, os.WriteFile(path, []byte(b.String()), 0o644)
}
