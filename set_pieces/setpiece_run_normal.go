package setpieces

import (
	"fmt"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/qa"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// run-normal: the full starter chain. (Legacy: adw_plan_build_test.py, `just sdlc`.)
//
// Testing is CODE: the suite's command lives in the config, so no player
// spends a context window rediscovering it. Failures flow back to the builder
// as a report, and only exhausted extra time fails the match.
func init() {
	register(SetPiece{
		Command: "run-normal", File: "setpiece_run_normal.go",
		Summary: "spec, build, test, ship: ogsf run-normal \"add a /health endpoint\"",
		Chain: "head_coach(ask) → playmaker(spec) → builder(build) → referee(test) " +
			"[→ builder(iterate) → referee(test) … ×3] → referee(ship)",
		Required: []string{"playmaker", "builder"},
		Run:      runNormal,
	})
}

func runNormal(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "run-normal", []string{"playmaker", "builder"})
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	plan, err := specObjective(m, a.Prompt, false)
	if err != nil {
		return 1, err
	}
	var previous reports.Report
	if previous, err = buildCall(m, match.Params{Name: "build", Kind: match.Player, Owner: "builder",
		Description: "Implement the plan exactly"}, a.Prompt, plan, "ball_in_play"); err != nil {
		return 1, err
	}
	var test *qa.Result
	for i := 1; i <= MaxExtraTime; i++ {
		result, err := testObjective(d, m, fmt.Sprintf("test_%d", i))
		if err != nil {
			return 1, err
		}
		test = &result
		if test.Passed {
			break
		}
		if previous, err = buildCall(m, match.Params{Name: fmt.Sprintf("iterate_%d", i), Kind: match.Player,
			Owner: "builder", Retries: 1, Description: "Repair what the suite reported, from its verbatim output"},
			a.Prompt, qa.AsReport(*test, "tests"), "ball_in_play"); err != nil {
			return 1, err
		}
	}
	// Only tested work ships: a red suite leaves the tree uncommitted.
	if test != nil && test.Passed {
		if err := shipObjective(d, m, "ship", "Land the code only after the suite came back green",
			fallbackMessage(previous, m.ID())); err != nil {
			return 1, err
		}
	}
	return m.Finish(test != nil && test.Passed,
		fmt.Sprintf("the suite still failed after %d attempt(s) of extra time", MaxExtraTime)), nil
}
