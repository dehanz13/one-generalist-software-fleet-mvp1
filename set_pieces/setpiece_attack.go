package setpieces

import "github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"

// attack: one-shot implementation. (Legacy: adw_build.py, which had no recipe.)
func init() {
	register(SetPiece{
		Command: "attack", File: "setpiece_attack.go",
		Summary:  "build only: ogsf attack \"add a /health endpoint\"",
		Chain:    "head_coach(ask) → builder(build)",
		Required: []string{"builder"},
		Run:      runAttack,
	})
}

func runAttack(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "attack", []string{"builder"})
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	if _, err := buildCall(m, match.Params{Name: "build", Kind: match.Player, Owner: "builder", Retries: 1,
		Description: "Implement the request"}, a.Prompt, nil, "replay_matches_report"); err != nil {
		return 1, err
	}
	return m.Finish(true, ""), nil
}
