package setpieces

import "github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"

// scout-opposition: read-only recon. Just looking for things.
// (Legacy: adw_scout.py, `just scout`.)
func init() {
	register(SetPiece{
		Command: "scout-opposition", File: "setpiece_scout_opposition.go",
		Summary:  "read-only recon: ogsf scout-opposition \"where is auth handled\"",
		Chain:    "head_coach(ask) → ranger(scout_opposition)",
		Required: []string{"ranger"},
		Run:      runScoutOpposition,
	})
}

func runScoutOpposition(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "scout-opposition", []string{"ranger"})
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	if err := m.Objective(match.Params{Name: "scout_opposition", Kind: match.Player, Owner: "ranger",
		Description: "Find and report where things live — change nothing"}, func(h match.Handle) error {
		_, err := h.Call(match.Call{ReportType: "AnalystReport", Prompt: a.Prompt, Reviews: reviews("ball_in_play")})
		return err
	}); err != nil {
		return 1, err
	}
	return m.Finish(true, ""), nil
}
