// Package demo is `ogsf demo`: a tour of every set piece and command, run
// for real through the engine against a throwaway repository, with players
// on the scripted club. No token is spent and nothing outside the tour's own
// folder changes. The match log it leaves is what Matchday Live's demo
// replays.
package demo

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/abandoned"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/club"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/contract"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/highlights"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/incorporate"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/qa"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/scheduler"
	setpieces "github.com/dehanz13/one-generalist-software-fleet-mvp1/set_pieces"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/templates"
)

// Options shape a tour.
type Options struct {
	// Dir is where the sample repository is built; a new temp dir when empty.
	Dir string
	// Out receives one line per command; Verbose adds every match's console.
	Out     io.Writer
	Verbose bool
	// Start is where the virtual clock begins. The tour plays a working week
	// from Start's date (UTC), a few matches each afternoon, in seconds.
	Start time.Time
}

// Outcome is one command of the tour.
type Outcome struct {
	Command string
	Story   string
	Ticket  string // the Upcoming Matches ticket it played
	Via     string // "" (typed), tick (the Scheduler, when due), run (ogsf upcoming run), request
	MatchID string
	Code    int
	Status  string
	Err     error
}

// Result is the whole tour.
type Result struct {
	Repo     string
	DBPath   string
	DataDir  string
	Config   string
	Outcomes []Outcome
	Steps    []string // the planning steps between matches, as printed
}

// checkPace is how long each kind of check takes in the tour, about what the
// real tools take on a small TypeScript project.
var checkPace = map[string]time.Duration{
	"lint": 9400 * time.Millisecond, "typecheck": 13800 * time.Millisecond,
	"test": 41 * time.Second, "build": 57 * time.Second,
}

const (
	configPath = "set_pieces/boardroom/club.config.yaml"
	founder    = "Danniel"
)

func git(args ...string) error {
	out, err := exec.Command("git", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return nil
}

// setUp builds the sample repository and moves into it.
func setUp(dir string, day0 time.Time) (string, error) {
	repo := filepath.Join(dir, "kickabout")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		return "", err
	}
	for path, content := range sampleFiles {
		full := filepath.Join(repo, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			return "", err
		}
	}
	if _, err := incorporate.Incorporate(repo, false); err != nil {
		return "", err
	}
	// The shipped config, pointed at the scripted club and the sample's checks.
	tmpl, err := templates.FS.ReadFile("set_pieces/boardroom/club.config.yaml")
	if err != nil {
		return "", err
	}
	cfg := string(tmpl)
	cfg = strings.Replace(cfg, "name: my-project", "name: kickabout", 1)
	cfg = strings.Replace(cfg, "  club: pi                       # pi | scripted   (claude_code: not implemented yet)",
		"  club: scripted                 # the demo's players play a script: no model, no tokens", 1)
	// Swap the qa section (it ends at the first blank line) for the sample's.
	qaStart := strings.Index(cfg, "\nqa:\n") + 1
	qaEnd := qaStart + strings.Index(cfg[qaStart:], "\n\n") + 1
	cfg = cfg[:qaStart] + qaChecks + cfg[qaEnd:]
	cfg = regexp.MustCompile(`(?m)^  timezone: "".*$`).ReplaceAllString(cfg, "  timezone: UTC")
	cfg = regexp.MustCompile(`(?m)^  accept_remote: false.*$`).ReplaceAllString(cfg,
		"  accept_remote: true            # the demo takes requests from the page and the CLI")
	if err := os.WriteFile(filepath.Join(repo, configPath), []byte(cfg), 0o644); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(repo, sprintPath), []byte(sprintFile(day0)), 0o644); err != nil {
		return "", err
	}
	if err := os.Chdir(repo); err != nil {
		return "", err
	}
	for _, args := range [][]string{
		{"init", "-q", "-b", "main"}, {"config", "user.name", founder}, {"config", "user.email", "founder@example.invalid"},
		{"config", "commit.gpgsign", "false"}, {"add", "-A"}, {"commit", "-q", "-m", "chore: start kickabout"},
	} {
		if err := git(args...); err != nil {
			return "", err
		}
	}
	return repo, nil
}

// Tour runs every scenario and returns what happened.
func Tour(opts Options) (*Result, error) {
	if opts.Out == nil {
		opts.Out = io.Discard
	}
	if opts.Start.IsZero() {
		opts.Start = time.Now().UTC().AddDate(0, 0, -5).Truncate(24 * time.Hour).Add(13*time.Hour + 50*time.Minute)
	}
	day0 := opts.Start.UTC().Truncate(24 * time.Hour)
	dir := opts.Dir
	if dir == "" {
		var err error
		if dir, err = os.MkdirTemp("", "ogsf-demo-"); err != nil {
			return nil, err
		}
	}
	home, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	defer os.Chdir(home)
	restore := setEnv(map[string]string{"FOUNDER_NAME": founder, "CLUB_MACHINE": "studio-macbook-pro",
		"CLUB_MATCHLOG": "", "CLUB_CONFIG": "", "CLUB_RELAY_URL": "", "CLUB_RELAY_TOKEN": ""})
	defer restore()

	repo, err := setUp(dir, day0)
	if err != nil {
		return nil, err
	}
	kit.UseVirtualClock(opts.Start)
	defer kit.UseRealClock()
	// On the virtual clock the sample's checks would take no time at all;
	// pace them like the real tools so the timeline reads true.
	qa.Pace = func(spec boardroom.QACheck) time.Duration { return checkPace[spec.Operation] }
	contract.Pace = func(string) time.Duration { return sec(2.6) }
	defer func() { qa.Pace, contract.Pace = nil, nil }()
	defer club.UseScript(nil)

	cfg, err := boardroom.Load(configPath)
	if err != nil {
		return nil, err
	}
	result := &Result{Repo: repo, DBPath: filepath.Join(repo, cfg.Var.MatchLog), DataDir: filepath.Join(repo, cfg.Defaults.DataDir),
		Config: filepath.Join(repo, configPath)}
	// The board and the requests go through the same feed and Scheduler the
	// commands use; only the launcher is the tour's.
	feed, err := matchfeed.Open(result.DBPath, os.DevNull, matchfeed.Options{})
	if err != nil {
		return nil, err
	}
	defer feed.Close()
	t := &tourRun{opts: opts, result: result, feed: feed, day0: day0}
	sayTo := io.Discard
	if opts.Verbose {
		sayTo = opts.Out
	}
	t.sched = scheduler.New(scheduler.Options{Config: cfg, Feed: feed, Launch: t.launcher, IsSetPiece: setpieces.IsSetPiece, Out: sayTo})
	pending := steps()
	runSteps := func(until time.Time) error {
		for len(pending) > 0 && !t.when(pending[0].day, pending[0].at).After(until) {
			st := pending[0]
			pending = pending[1:]
			t.advance(st.day, st.at)
			line, err := st.do(t)
			if err != nil {
				return fmt.Errorf("%s: %w", st.show, err)
			}
			text := fmt.Sprintf("  %-28s %s", st.show, line)
			result.Steps = append(result.Steps, text)
			fmt.Fprintln(opts.Out, text)
		}
		return nil
	}
	for _, s := range scenarios() {
		if err := runSteps(t.when(s.day, s.at)); err != nil {
			return result, err
		}
		if err := t.play(s); err != nil {
			return result, err
		}
	}
	if err := runSteps(t.when(365, "00:00")); err != nil {
		return result, err
	}
	return result, nil
}

func setEnv(values map[string]string) func() {
	old := map[string]*string{}
	for k, v := range values {
		if prev, ok := os.LookupEnv(k); ok {
			p := prev
			old[k] = &p
		} else {
			old[k] = nil
		}
		if v == "" {
			os.Unsetenv(k)
		} else {
			os.Setenv(k, v)
		}
	}
	return func() {
		for k, v := range old {
			if v == nil {
				os.Unsetenv(k)
			} else {
				os.Setenv(k, *v)
			}
		}
	}
}

// scenario is one command of the tour.
type scenario struct {
	command string                  // the command, as typed
	piece   string                  // the set piece it runs, when not the command itself (post-match)
	story   string                  // one line on what it shows
	prompt  func(t *tourRun) string // a prompt that needs an earlier outcome
	args    setpieces.Args
	raw     string // the raw prompt argument, for the kickoff checklist
	matchID string // pinned, or "" (or "@<n>": reuse the nth outcome's id)
	before  func(t *tourRun) error
	script  func(t *tourRun) *club.Script
	day     int    // days after the tour's first day
	at      string // HH:MM UTC: when it starts (or later, when the one before ran long)
	ticket  string // the Upcoming Matches ticket it plays, in set_pieces/upcoming/sprint-14.md
	title   string // the ticket's title
	// via is how it starts: "" typed at the command line; "tick" the
	// Scheduler, because its auto ticket is due; "run" `ogsf upcoming run`;
	// "request" a request the Scheduler claims.
	via     string
	request *matchfeed.RequestRow
}

type tourRun struct {
	opts    Options
	result  *Result
	opened  []*match.Match
	feed    *matchfeed.Feed
	sched   *scheduler.Scheduler
	day0    time.Time
	current *scenario // the scenario the Scheduler starts next
	ticket  string    // the ticket the match being opened plays
	failed  error     // a launch the tour did not expect to fail
}

// when is a day of the tour and a UTC clock time.
func (t *tourRun) when(day int, at string) time.Time {
	var h, m int
	fmt.Sscanf(at, "%d:%d", &h, &m)
	return t.day0.AddDate(0, 0, day).Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute)
}

// advance moves the virtual clock to a day and time, unless it is already past.
func (t *tourRun) advance(day int, at string) {
	if d := t.when(day, at).Sub(kit.Now()); d > 0 {
		kit.Sleep(d)
	}
}

func (t *tourRun) ensure(cfg *boardroom.Config, matchID, setPiece string) (match.Runner, error) {
	out := io.Discard
	if t.opts.Verbose {
		out = t.opts.Out
	}
	m, err := match.Ensure(cfg, matchID, match.Options{SetPiece: setPiece, NoSignals: true,
		Command: "ogsf " + setPiece, Console: out, TicketID: t.ticket})
	if err != nil {
		return nil, err
	}
	t.opened = append(t.opened, m)
	return m, nil
}

func (t *tourRun) play(s scenario) error {
	t.advance(s.day, s.at)
	if s.before != nil {
		if err := s.before(t); err != nil {
			return fmt.Errorf("%s: %w", s.command, err)
		}
	}
	if strings.HasPrefix(s.matchID, "@") {
		var n int
		fmt.Sscanf(s.matchID, "@%d", &n)
		s.args.MatchID = t.result.Outcomes[n].MatchID
	}
	if s.prompt != nil {
		s.args.Prompt = s.prompt(t)
	}
	if s.script != nil {
		club.UseScript(s.script(t))
	}
	before := len(t.result.Outcomes)
	ctx := context.Background()
	switch s.via {
	case "":
		t.launch(s, "")
	case "tick":
		t.current = &s
		if _, err := t.sched.Tick(ctx); err != nil {
			return fmt.Errorf("%s: %w", s.command, err)
		}
	case "run":
		t.current = &s
		if _, err := t.sched.RunTicket(ctx, s.ticket); errors.Is(err, scheduler.ErrAlreadyPlayed) {
			return fmt.Errorf("%s: %w", s.command, err)
		}
	case "request":
		r := *s.request
		if r.Kind == "ticket" {
			r.TicketID = s.ticket
		} else {
			r.Prompt, r.Player = s.args.Prompt, s.args.Player
		}
		if _, err := t.feed.RequestCreate(r); err != nil {
			return err
		}
		t.current = &s
		if _, err := t.sched.Tick(ctx); err != nil {
			return fmt.Errorf("%s: %w", s.command, err)
		}
	}
	t.current = nil
	if t.failed != nil {
		return t.failed
	}
	if len(t.result.Outcomes) != before+1 {
		return fmt.Errorf("%s (%s %s): the Scheduler did not start it", s.command, s.via, s.ticket)
	}
	return nil
}

// launch runs one scenario's set piece the way the command line does (its
// kickoff checklist, then the set piece) and records the outcome.
func (t *tourRun) launch(s scenario, ticket string) (int, error) {
	name := s.piece
	if name == "" {
		name = s.command
	}
	piece, ok := setpieces.Get(name)
	if !ok {
		t.failed = fmt.Errorf("no set piece %q", name)
		return 1, t.failed
	}
	t.opened = nil
	code, err := setpieces.Launch(setpieces.DefaultDeps(configPath, t.ensure), piece, s.args, s.raw, false, nil)
	var refused *setpieces.KickoffRefused
	if errors.As(err, &refused) {
		t.failed = fmt.Errorf("%s: %w", s.command, err)
		return code, err
	}
	outcome := Outcome{Command: s.command, Story: s.story, Ticket: ticket, Via: s.via, Code: code, Err: err}
	for _, m := range t.opened {
		outcome.MatchID = m.ID()
		m.Close()
	}
	switch {
	case abandoned.Is(err):
		outcome.Code = abandoned.ExitCode
	case err != nil && outcome.Code == 0:
		outcome.Code = 1
	}
	outcome.Status = t.status(outcome.MatchID)
	t.result.Outcomes = append(t.result.Outcomes, outcome)
	story := s.story
	switch s.via {
	case "tick":
		story += "  [" + ticket + ", started by the Scheduler when due]"
	case "run":
		story += "  [" + ticket + ", ogsf upcoming run]"
	case "request":
		if ticket != "" {
			story += "  [" + ticket + ", requested on the page]"
		} else {
			story += "  [requested on the page, claimed by the Scheduler]"
		}
	}
	fmt.Fprintf(t.opts.Out, "  %-17s %-9s %-9s %s\n", s.command, outcome.MatchID, outcome.Status, story)
	return code, err
}

func (t *tourRun) status(matchID string) string {
	if matchID == "" {
		return "-"
	}
	db, err := matchfeed.OpenDB(t.result.DBPath)
	if err != nil {
		return "?"
	}
	defer db.Close()
	var status string
	_ = db.QueryRow("SELECT status FROM matches WHERE match_id = ?", matchID).Scan(&status)
	return status
}

// writeQuest commits a quest spec on its own feature branch.
func writeQuest(name, text string) func(*tourRun) error {
	return func(*tourRun) error {
		path := filepath.Join("specs", "demo-quests", name+".md")
		if err := git("checkout", "-q", "-b", "feature/"+name); err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
			return err
		}
		if err := git("add", path); err != nil {
			return err
		}
		return git("commit", "-q", "-m", "docs: add the "+name+" quest")
	}
}

// bundleFor writes the highlights of an earlier outcome.
func bundleFor(n int) func(*tourRun) error {
	return func(t *tourRun) error {
		db, err := matchfeed.OpenDB(t.result.DBPath)
		if err != nil {
			return err
		}
		defer db.Close()
		path, lines, err := highlights.Bundle(db, t.result.DataDir, t.result.Outcomes[n].MatchID)
		if err == nil {
			fmt.Fprintf(t.opts.Out, "  %-17s %-9s %-9s %s (%d lines)\n", "highlights-match", t.result.Outcomes[n].MatchID, "-",
				"bundled the abandoned match for the post-match ranger", lines)
			_ = path
		}
		return err
	}
}
