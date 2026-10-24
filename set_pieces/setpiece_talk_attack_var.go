package setpieces

import (
	"errors"
	"fmt"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/commitmsg"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/contract"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/qa"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/ruling"
)

// run-mythic: the full chain plus the deterministic gate, every check on.
// (Legacy: adw_plan_build_test_quality.py, `just sdlc-strict`; the picked
// file name is setpiece_talk_attack_var.go.)
//
// Reusing an id whose last match failed runs strict qa once on the
// already-repaired checkout: no paid players, no extra time, no empty commit.
// Use a fresh id for a new implementation.
//
// The scope check runs what is cheap and decisive before the gate spends
// minutes: the repository's own pre-commit hook, the spec's `writes` scope and
// its `checks` (package contract). A failure there skips the gate for that
// loop and goes straight back to the builder.
//
// QA is CODE, not a player. Its commands are known, so running them needs no
// judgement, only repairing them does. A failing check does not fail its
// objective: the runner did its job, the code is what failed. The failure
// becomes a report and flows back into the builder, and only exhausted extra
// time fails the match.
func init() {
	register(SetPiece{
		Command: "run-mythic", File: "setpiece_talk_attack_var.go",
		Summary: "the strict difficulty: kickoff checklist, contract, line of scrimmage, progressive qa: ogsf run-mythic specs/<x>-quests/<quest>.md",
		Chain: "head_coach(ask) → playmaker(spec) → [stop on a noop/blocked ruling] → referee(benchmark) → builder(build) " +
			"→ [referee(scope_check) → referee(qa) → builder(iterate)] ×3 → referee(ship)",
		Required: []string{"playmaker", "builder"},
		Kickoff:  true,
		Run:      runMythic,
	})
}

func runMythic(d *Deps, a Args) (int, error) {
	dirty, err := d.IsDirty()
	if err != nil {
		return 1, err
	}
	if dirty {
		return 1, errors.New("the fleet needs a clean checkout before a shipping match; " +
			"finish or set aside existing edits so git add -A cannot include them")
	}
	cfg, err := d.LoadConfig()
	if err != nil {
		return 1, err
	}
	reverify := d.ShouldReverify(cfg.Defaults.DataDir, a.MatchID)
	if !reverify {
		if err := d.Validate(cfg, []string{"playmaker", "builder"}); err != nil {
			return 1, err
		}
	}
	m, err := d.Ensure(cfg, a.MatchID, "run-mythic")
	if err != nil {
		return 1, err
	}

	if reverify {
		// A failed id is a retry of work already performed: re-run the strict
		// gate once. No second playmaker/builder cycle, no empty commit when a
		// manual repair is already committed.
		var result qa.Result
		if err := m.Objective(match.Params{Name: "qa_rerun", Kind: match.Referee, Owner: "qa",
			Description: "Strictly verify the repaired prior match"}, func(h match.Handle) error {
			var err error
			if result, err = d.RunQuality(m, nil); err != nil {
				return err
			}
			record(h, result)
			return nil
		}); err != nil {
			return 1, err
		}
		return m.Finish(result.Passed, "re-verification failed; no paid extra time was launched"), nil
	}

	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	plan, err := specObjective(m, a.Prompt, true)
	if err != nil {
		return 1, err
	}
	// Nothing to build, or nothing buildable: stop before the line of
	// scrimmage spends minutes and the builder spends tokens.
	if plan.Ruling != "implement" {
		return ruling.EndWithoutBuild(m, plan), nil
	}

	// A malformed block is an error here: the kickoff checklist read the same
	// text, so reaching this with one means --skip-kickoff was used on a spec
	// nobody can hold a match to.
	questContract, err := contract.Parse(a.Prompt)
	if err != nil {
		return 1, err
	}

	// The complete lint/TypeScript diagnostics BEFORE the builder changes
	// code. Every later qa compares against it: a quest that introduced no
	// new diagnostic identity passes; tests and build still need a clean exit.
	var line qa.LineOfScrimmage
	if err := m.Objective(match.Params{Name: "benchmark", Kind: match.Referee, Owner: "qa",
		Description: "Measure pre-quest diagnostics (the progressive gate's line of scrimmage)"},
		func(h match.Handle) error {
			var err error
			if line, err = d.CaptureLine(m); err != nil {
				return err
			}
			var kv []any
			for _, name := range sortedKeys(line) {
				kv = append(kv, "line_of_scrimmage_"+name, line[name].Total())
			}
			h.Log(kv...)
			return nil
		}); err != nil {
		return 1, err
	}

	// Where the branch stood before any player could commit. The scope check
	// and the ship both assume the quest's whole diff is uncommitted.
	baseSHA, err := d.Rev("HEAD")
	if err != nil {
		return 1, err
	}

	var previous reports.Report
	build, err := buildCall(m, match.Params{Name: "build", Kind: match.Player, Owner: "builder",
		Description: "Implement the plan exactly"}, a.Prompt, plan, "replay_matches_report")
	if err != nil {
		return 1, err
	}
	previous = build
	// What the quest's commit will say. An iterate report is folded into it,
	// never allowed to replace it (commitmsg.KeepTheFuller).
	questMessage := build.CommitMessage
	if questMessage == "" {
		questMessage = build.Summary
	}

	var gate *qa.Result
	var lastScope []string
	for i := 1; i <= MaxExtraTime; i++ {
		var scopeFailures []string
		if err := m.Objective(match.Params{Name: fmt.Sprintf("scope_check_%d", i), Kind: match.Referee, Owner: "contract",
			Description: "Pre-commit hook, declared scope, and the spec's own checks — before the slow gate"},
			func(h match.Handle) error {
				undone, err := d.UncommitTo(baseSHA)
				if err != nil {
					return err
				}
				if len(undone) > 0 {
					h.Log("uncommitted", strings.Join(undone, ", "),
						"why", "a player committed its own work; the contract compares the tree with the commit "+
							"the build started from, so the commit is undone and its changes kept")
				}
				if restored := d.RestorePlanCopy(m.TorchPassDir(), plan); len(restored) > 0 {
					h.Log("restored", strings.Join(restored, ", "),
						"why", "a player removed the playmaker's plan; it is part of the record")
				}
				failures, examined := d.VerifyContract(questContract, m)
				repeated := contract.WithRepeatNote(failures, lastScope)
				h.Log("passed", len(failures) == 0, "failures", len(failures),
					"examined", strings.Join(examined, "; "), "repeated", len(repeated) != len(failures))
				lastScope, scopeFailures = failures, repeated
				if lastScope == nil {
					lastScope = []string{}
				}
				return nil
			}); err != nil {
			return 1, err
		}

		if len(scopeFailures) > 0 {
			// The hook or the scope already refuses this tree. Running lint,
			// tsc, the suite and a build on it would measure something that
			// can never be shipped.
			gate = &qa.Result{Passed: false, Failures: scopeFailures, Checks: []qa.CheckResult{}, Artifacts: []string{}}
		} else if err := m.Objective(match.Params{Name: fmt.Sprintf("qa_%d", i), Kind: match.Referee, Owner: "qa",
			Description: "Lint, typecheck, test, and eligible build — progressive gate vs the line of scrimmage"},
			func(h match.Handle) error {
				result, err := d.RunQuality(m, line)
				if err != nil {
					return err
				}
				gate = &result
				record(h, result)
				return nil
			}); err != nil {
			return 1, err
		}

		if gate.Passed || i == MaxExtraTime {
			break
		}
		// Whichever block failed becomes the builder's spec: verbatim output,
		// no parser between the failure and the fix.
		what := "regression"
		if len(scopeFailures) > 0 {
			what = "contract"
		}
		fix, err := buildCall(m, match.Params{Name: fmt.Sprintf("iterate_%d", i), Kind: match.Player, Owner: "builder",
			Retries: 1, Description: "Resolve the reported " + what}, a.Prompt, qa.AsReport(*gate, what), "replay_matches_report")
		if err != nil {
			return 1, err
		}
		previous = fix
		later := fix.CommitMessage
		if later == "" {
			later = fix.Summary
		}
		questMessage = commitmsg.KeepTheFuller(questMessage, later)
	}
	_ = previous

	verified := gate != nil && gate.Passed
	if verified {
		// `ogsf(<id>): …` was legacy's old fallback and is not a Conventional
		// Commits type: commitlint refused it after every gate had passed.
		if err := shipObjective(d, m, "ship", "Ship the quest — no new diagnostics, tests and eligible build green",
			commitmsg.Normalise(questMessage, "chore", m.ID())); err != nil {
			return 1, err
		}
	}
	return m.Finish(verified, fmt.Sprintf("contract or progressive gate still red after %d attempt(s)", MaxExtraTime)), nil
}

func sortedKeys(line qa.LineOfScrimmage) []string {
	var keys []string
	for k := range line {
		keys = append(keys, k)
	}
	// insertion order is lost in a map; a sorted order is at least stable
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}
