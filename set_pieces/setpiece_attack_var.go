package setpieces

import (
	"fmt"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/qa"
)

// attack-var: implement, then verify; failures flow back into the builder.
// (Legacy: adw_build_test.py, which had no recipe.)
//
// A failing suite does NOT fail its objective: the runner did its job, the
// code is what failed. It fails the match, checked at the end, after extra
// time has had its chances.
func init() {
	register(SetPiece{
		Command: "attack-var", File: "setpiece_attack_var.go",
		Summary:  "build, then test with extra time: ogsf attack-var \"fix the failing date test\"",
		Chain:    "head_coach(ask) → builder(build) → referee(test) [→ builder(iterate) → referee(test) … ×3]",
		Required: []string{"builder"},
		Run:      runAttackVar,
	})
}

func runAttackVar(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "attack-var", []string{"builder"})
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	if _, err := buildCall(m, match.Params{Name: "build", Kind: match.Player, Owner: "builder",
		Description: "Implement the request"}, a.Prompt, nil, "replay_matches_report"); err != nil {
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
		if _, err := buildCall(m, match.Params{Name: fmt.Sprintf("iterate_%d", i), Kind: match.Player,
			Owner: "builder", Retries: 1, Description: "Repair what the suite reported, from its verbatim output"},
			a.Prompt, qa.AsReport(*test, "tests"), "replay_matches_report"); err != nil {
			return 1, err
		}
	}
	return m.Finish(test != nil && test.Passed,
		fmt.Sprintf("the suite still failed after %d attempt(s) of extra time", MaxExtraTime)), nil
}
