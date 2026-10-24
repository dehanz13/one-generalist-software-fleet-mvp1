package setpieces

import (
	"errors"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
)

// qa: lint, typecheck, test and build the project, strictly.
// (Legacy: adw_quality.py, which had no recipe.)
func init() {
	register(SetPiece{
		Command: "qa", File: "setpiece_qa.go",
		Summary: "run every qa check strictly: ogsf qa \"before the release\"",
		Chain:   "head_coach(ask) → referee(qa)",
		Run:     runQA,
	})
}

func runQA(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "qa", nil)
	if err != nil {
		return 1, err
	}
	if err := m.Objective(match.Params{Name: "ask", Kind: match.HeadCoach, Owner: m.Founder(),
		Description: "Capture why a qa run was requested"}, func(h match.Handle) error {
		h.Log("input", a.Prompt)
		return nil
	}); err != nil {
		return 1, err
	}
	if err := m.Objective(match.Params{Name: "qa", Kind: match.Referee, Owner: "qa",
		Description: "Run the deterministic qa checks"}, func(h match.Handle) error {
		result, err := d.RunQuality(m, nil)
		if err != nil {
			return err
		}
		record(h, result)
		if !result.Passed {
			return errors.New("qa failed: " + strings.Join(result.Failures, "; "))
		}
		return nil
	}); err != nil {
		return 1, err
	}
	return m.Finish(true, ""), nil
}
