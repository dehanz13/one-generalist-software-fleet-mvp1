package setpieces

import (
	"fmt"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// MaxRevisions bounds attack-review's revise loop.
const MaxRevisions = 3

// attack-review: implement, then confirm it is what was asked for.
// (Legacy: adw_build_review.py, which had no recipe.)
//
// A review is not a test. Tests answer "does it run"; the safety officer
// answers "is this the thing that was asked for": it reads the spec
// (torch_pass/plan.md when the match has one, else the prompt), reads the code
// on disk, and rules on each requirement. Its objective succeeds when it RUNS
// and REPORTS; a rejection fails the match at the end, after the revisions.
func init() {
	register(SetPiece{
		Command: "attack-review", File: "setpiece_attack_review.go",
		Summary:  "build, then the safety officer's review: ogsf attack-review \"add a /health endpoint\"",
		Chain:    "head_coach(ask) → builder(build) → safety_officer(review) [→ builder(revise) → safety_officer(review) … ×3]",
		Required: []string{"builder", "safety_officer"},
		Run:      runAttackReview,
	})
}

func runAttackReview(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "attack-review", []string{"builder", "safety_officer"})
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	var previous reports.Report
	if previous, err = buildCall(m, match.Params{Name: "build", Kind: match.Player, Owner: "builder",
		Description: "Implement the request"}, a.Prompt, nil, "replay_matches_report"); err != nil {
		return 1, err
	}
	var review *reports.VarReport
	for i := 1; i <= MaxRevisions; i++ {
		if review, err = reviewObjective(m, fmt.Sprintf("review_%d", i),
			"Rule on every requirement in the spec, against the code on disk", a.Prompt, previous); err != nil {
			return 1, err
		}
		if review.Approved || i == MaxRevisions {
			break
		}
		if previous, err = buildCall(m, match.Params{Name: fmt.Sprintf("revise_%d", i), Kind: match.Player,
			Owner: "builder", Retries: 1, Description: "Close every blocking finding the safety officer named"},
			a.Prompt, review, "replay_matches_report"); err != nil {
			return 1, err
		}
	}
	return m.Finish(review != nil && review.Approved,
		fmt.Sprintf("the safety officer never approved after %d revision(s)", MaxRevisions)), nil
}

// reviewObjective runs the safety officer.
func reviewObjective(m match.Runner, name, description, prompt string, previous reports.Report) (*reports.VarReport, error) {
	var review *reports.VarReport
	err := m.Objective(match.Params{Name: name, Kind: match.Player, Owner: "safety_officer", Description: description},
		func(h match.Handle) error {
			report, err := h.Call(match.Call{ReportType: "VarReport", Prompt: prompt, Previous: previous,
				Reviews: reviews("ball_in_play", "decision_stands")})
			if err != nil {
				return err
			}
			review = report.(*reports.VarReport)
			return nil
		})
	return review, err
}
