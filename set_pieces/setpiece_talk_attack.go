package setpieces

import "github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"

// talk-attack: two players, playmaker → report → builder, then ship.
// (Legacy: adw_plan_build.py, `just plan-build`.)
func init() {
	register(SetPiece{
		Command: "talk-attack", File: "setpiece_talk_attack.go",
		Summary:  "playmaker, builder, ship: ogsf talk-attack \"add a /health endpoint\"",
		Chain:    "head_coach(ask) → playmaker(spec) → builder(build) → referee(ship)",
		Required: []string{"playmaker", "builder"},
		Run:      runTalkAttack,
	})
}

func runTalkAttack(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "talk-attack", []string{"playmaker", "builder"})
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
	build, err := buildCall(m, match.Params{Name: "build", Kind: match.Player, Owner: "builder",
		Description: "Implement the plan exactly"}, a.Prompt, plan, "replay_matches_report")
	if err != nil {
		return 1, err
	}
	if err := shipObjective(d, m, "ship", "Land the builder's changes, using the message it wrote",
		fallbackMessage(build, m.ID())); err != nil {
		return 1, err
	}
	return m.Finish(true, ""), nil
}
