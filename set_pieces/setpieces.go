// Package setpieces holds the set pieces: each one is a runnable chain of
// objectives, such as spec → build → qa → ship. (Legacy: the adws/adw_*.py
// scripts; the picked name for an ADW is a set piece.)
//
// Set pieces stay thin: all low-level logic lives in backroom_staff. Plain
// code owns the order of work and players are bounded steps inside it. This
// design is IndyDevDan's (Super Simple Software Factory, MIT).
package setpieces

import (
	"fmt"
	"sort"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/changes"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/club"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/commitmsg"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/contract"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/gitops"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/qa"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/resume"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/ruling"
)

// MaxExtraTime bounds every repair loop. (Legacy: MAX_FIX_LOOPS; the picked
// name for the fix loop is extra time.)
const MaxExtraTime = 3

// Args are a set piece's inputs from the command line.
type Args struct {
	Prompt   string // the resolved request text
	MatchID  string // join or pin a match; empty mints one
	Player   string // ask: which player answers
	Base     string // bard: the ref the change is measured against
	Playbook string // play: the playbook file
}

// Deps are every effect a set piece has on the world. DefaultDeps wires the
// real ones; the strict set piece's tests swap them for scripted ones, the
// way legacy's tests patched the modules, so what is under test is only the
// ORDER the set piece does things in and what it refuses to do.
type Deps struct {
	LoadConfig func() (*boardroom.Config, error)
	Validate   func(cfg *boardroom.Config, required []string) error
	Ensure     func(cfg *boardroom.Config, matchID, setPiece string) (match.Runner, error)

	IsDirty    func() (bool, error)
	Rev        func(ref string) (string, error)
	ShortSHA   func(ref string) (string, error)
	UncommitTo func(base string) ([]string, error)
	CommitAll  func(message string) (string, error)

	ShouldReverify  func(dataDir, matchID string) bool
	CaptureLine     func(r match.Runner) (qa.LineOfScrimmage, error)
	RunQuality      func(r match.Runner, line qa.LineOfScrimmage) (qa.Result, error)
	RunTests        func(r match.Runner) qa.Result
	VerifyContract  func(c *contract.QuestContract, r match.Runner) ([]string, []string)
	RestorePlanCopy func(torchPassDir string, plan *reports.TalkReport) []string
	CaptureChanges  func(r match.Runner, base string) (changes.ChangeSet, error)
}

// pitch is the concrete match behind a Runner, for the qa and contract calls.
type pitch interface {
	match.Runner
	qa.Pitch
}

// DefaultDeps wires the real world. ensure opens the match (the CLI adds the
// relay and the signal handler there).
func DefaultDeps(configPath string, ensure func(cfg *boardroom.Config, matchID, setPiece string) (match.Runner, error)) *Deps {
	return &Deps{
		LoadConfig: func() (*boardroom.Config, error) { return boardroom.Load(configPath) },
		Validate: func(cfg *boardroom.Config, required []string) error {
			return boardroom.Validate(cfg, required, club.ResolveModel)
		},
		Ensure:     ensure,
		IsDirty:    gitops.IsDirty,
		Rev:        gitops.Rev,
		ShortSHA:   gitops.ShortSHA,
		UncommitTo: gitops.UncommitTo,
		CommitAll:  gitops.CommitAll,

		ShouldReverify: resume.ShouldReverify,
		CaptureLine:    func(r match.Runner) (qa.LineOfScrimmage, error) { return qa.CaptureLineOfScrimmage(r.(pitch)) },
		RunQuality: func(r match.Runner, line qa.LineOfScrimmage) (qa.Result, error) {
			return qa.RunQuality(r.(pitch), line)
		},
		RunTests: func(r match.Runner) qa.Result { return qa.RunTests(r.(pitch)) },
		VerifyContract: func(c *contract.QuestContract, r match.Runner) ([]string, []string) {
			return contract.Verify(c, r.(pitch).RepoRoot())
		},
		RestorePlanCopy: ruling.RestorePlanCopy,
		CaptureChanges: func(r match.Runner, base string) (changes.ChangeSet, error) {
			return changes.Run(r.TorchPassDir(), changes.DefaultCapture(base))
		},
	}
}

// SetPiece is one runnable chain.
type SetPiece struct {
	Command  string   // what the founder types: `ogsf run-mythic`
	File     string   // where it lives, for the help text
	Summary  string   // one line
	Chain    string   // the objectives, for the help text
	Required []string // players it validates before anything spawns
	// Kickoff runs the kickoff checklist first (unless --skip-kickoff).
	Kickoff bool
	Run     func(d *Deps, a Args) (int, error)
}

var registry = map[string]SetPiece{}

func register(s SetPiece) { registry[s.Command] = s }

// All returns every set piece, ordered by command.
func All() []SetPiece {
	out := make([]SetPiece, 0, len(registry))
	for _, s := range registry {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Command < out[j].Command })
	return out
}

// Get returns one set piece.
func Get(command string) (SetPiece, bool) {
	s, ok := registry[command]
	return s, ok
}

// ── shared steps ────────────────────────────────────────────────────────────

// start loads the config, validates the players and opens the match.
func start(d *Deps, a Args, setPiece string, required []string) (*boardroom.Config, match.Runner, error) {
	cfg, err := d.LoadConfig()
	if err != nil {
		return nil, nil, err
	}
	if err := d.Validate(cfg, required); err != nil {
		return nil, nil, err
	}
	m, err := d.Ensure(cfg, a.MatchID, setPiece)
	return cfg, m, err
}

// askObjective captures the founder's request.
func askObjective(m match.Runner, prompt string, extra ...any) error {
	return m.Objective(match.Params{Name: "ask", Kind: match.HeadCoach, Owner: m.Founder(),
		Description: "Capture the incoming ask"}, func(h match.Handle) error {
		h.Log(append([]any{"input", prompt}, extra...)...)
		return nil
	})
}

// specObjective runs the playmaker; it returns the plan.
func specObjective(m match.Runner, prompt string, logRuling bool) (*reports.TalkReport, error) {
	var plan *reports.TalkReport
	err := m.Objective(match.Params{Name: "spec", Kind: match.Player, Owner: "playmaker",
		Description: "Turn the request into an implementable plan"}, func(h match.Handle) error {
		report, err := h.Call(match.Call{ReportType: "TalkReport", Prompt: prompt,
			Reviews: reviews("ball_in_play", "ball_not_flat")})
		if err != nil {
			return err
		}
		plan = report.(*reports.TalkReport)
		if logRuling {
			h.Log("ruling", plan.Ruling, "reason", plan.RulingReason)
		}
		return nil
	})
	return plan, err
}

// record logs a qa block's verdict: the same shape in every set piece.
func record(h match.Handle, result qa.Result) {
	passed := 0
	for _, c := range result.Checks {
		if c.Passed {
			passed++
		}
	}
	h.Log("passed", result.Passed, "checks", fmt.Sprintf("%d/%d", passed, len(result.Checks)),
		"artifacts", strings.Join(result.Artifacts, ", "))
}

// testObjective runs the suite as test_<i> (or the given name).
func testObjective(d *Deps, m match.Runner, name string) (qa.Result, error) {
	var result qa.Result
	err := m.Objective(match.Params{Name: name, Kind: match.Referee, Owner: "qa",
		Description: "Run the suite — a known command, so code runs it and no player has to rediscover it"},
		func(h match.Handle) error {
			result = d.RunTests(m)
			record(h, result)
			return nil
		})
	return result, err
}

// buildCall runs the builder in a player objective and returns its report.
func buildCall(m match.Runner, p match.Params, prompt string, previous reports.Report, review ...string) (*reports.AttackReport, error) {
	var out *reports.AttackReport
	err := m.Objective(p, func(h match.Handle) error {
		report, err := h.Call(match.Call{ReportType: "AttackReport", Prompt: prompt, Previous: previous,
			Reviews: reviews(review...)})
		if err != nil {
			return err
		}
		out = report.(*reports.AttackReport)
		return nil
	})
	return out, err
}

// shipObjective commits, logging the sha and the message.
func shipObjective(d *Deps, m match.Runner, name, description, message string) error {
	return m.Objective(match.Params{Name: name, Kind: match.Referee, Owner: "git", Description: description},
		func(h match.Handle) error {
			sha, err := d.CommitAll(message)
			if err != nil {
				return err
			}
			h.Log("sha", sha, "message", message)
			return nil
		})
}

// shipMessage is a report's own commit message, normalised for commitlint.
func shipMessage(report reports.Report, defaultType, matchID string) string {
	raw := reports.CommitMessageOf(report)
	if raw == "" {
		raw = report.Base().Summary
	}
	return commitmsg.Normalise(raw, defaultType, matchID)
}

// fallbackMessage is legacy's un-normalised fallback, kept where legacy kept it.
func fallbackMessage(report reports.Report, matchID string) string {
	if msg := reports.CommitMessageOf(report); msg != "" {
		return msg
	}
	return fmt.Sprintf("ogsf(%s): %s", matchID, report.Base().Summary)
}

// DocumentNotes tell the bard how to read a captured change.
const DocumentNotes = "Read diff_path in full before writing. Document only what the " +
	"diff shows, then copy the write-up into app_docs/ as your task describes."
