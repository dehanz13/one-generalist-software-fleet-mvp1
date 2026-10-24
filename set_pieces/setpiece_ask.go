package setpieces

import (
	"fmt"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
)

// ask: the smallest set piece. One player, one prompt, recorded end to end.
// (Legacy: adw_prompt.py, `just prompt`.)
func init() {
	register(SetPiece{
		Command: "ask", File: "setpiece_ask.go",
		Summary: "one player, one prompt: ogsf ask \"summarize this repo\" [--player builder]",
		Chain:   "head_coach(ask) → <player>(answer)",
		Run:     runAsk,
	})
}

func runAsk(d *Deps, a Args) (int, error) {
	player := a.Player
	if player == "" {
		player = "builder"
	}
	_, m, err := start(d, a, "ask", []string{player})
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	if err := m.Objective(match.Params{Name: "answer", Kind: match.Player, Owner: player,
		Description: fmt.Sprintf("Send the request straight to %s and parse its match report", player)},
		func(h match.Handle) error {
			_, err := h.Call(match.Call{ReportType: "GenericReport", Prompt: a.Prompt})
			return err
		}); err != nil {
		return 1, err
	}
	return m.Finish(true, ""), nil
}
