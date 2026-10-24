package setpieces

import "github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/officialreview"

var byName = map[string]officialreview.Review{
	"ball_in_play":          officialreview.BallInPlay,
	"ball_not_flat":         officialreview.BallNotFlat,
	"replay_matches_report": officialreview.ReplayMatchesReport,
	"decision_stands":       officialreview.DecisionStands,
	"json_parses":           officialreview.JSONParses,
}

// reviews looks official reviews up by name.
func reviews(names ...string) []officialreview.Review {
	out := make([]officialreview.Review, 0, len(names))
	for _, n := range names {
		out = append(out, byName[n])
	}
	return out
}
