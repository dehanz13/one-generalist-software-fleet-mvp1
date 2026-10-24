package setpieces

// team-talk: plan only. (Legacy: adw_plan.py, `just plan`.)
func init() {
	register(SetPiece{
		Command: "team-talk", File: "setpiece_team_talk.go",
		Summary:  "spec only: ogsf team-talk \"add a /health endpoint\"",
		Chain:    "head_coach(ask) → playmaker(spec)",
		Required: []string{"playmaker"},
		Run:      runTeamTalk,
	})
}

func runTeamTalk(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "team-talk", []string{"playmaker"})
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	if _, err := specObjective(m, a.Prompt, false); err != nil {
		return 1, err
	}
	return m.Finish(true, ""), nil
}
