package setpieces

import (
	"fmt"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/qa"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/ruling"
)

// MaxHeroicRevisions bounds run-heroic's revise loop.
const MaxHeroicRevisions = 2

// run-heroic: spec, build, test, review, document, shipping as it goes.
// (Legacy: adw_simple_sdlc.py, `just simple-sdlc`.)
//
// Three commits, three work products, three authors: the spec, the code and
// the write-up each land in their own commit, each in the words of the player
// that produced it. No player's sentence is ever reused for another's diff.
//
// Two questions are asked, in order: the suite asks "does it run", the safety
// officer asks "is this what was asked for", and neither can answer the
// other's. A revision re-enters the suite, so the tree that ships is the tree
// that was both tested and approved. The code ships after verification, not
// straight after the build; a match that fails verification leaves the spec
// shipped and the working tree dirty, where the founder can see it.
//
// The bard measures against the commit this match STARTED from, not main,
// because by then the match has moved main itself.
func init() {
	register(SetPiece{
		Command: "run-heroic", File: "setpiece_run_heroic.go",
		Summary: "spec, build, test, review, document — three commits: ogsf run-heroic \"add a /health endpoint\"",
		Chain: "head_coach(ask) → playmaker(spec) → referee(ship_spec) → builder(build) → referee(test) " +
			"[→ builder(iterate) …×3] → safety_officer(review) [→ builder(revise) …×2] → referee(retest) " +
			"→ referee(ship_build) → referee(changes) → bard(document) → referee(ship_docs)",
		Required: []string{"playmaker", "builder", "safety_officer", "bard"},
		Kickoff:  true,
		Run:      runHeroic,
	})
}

func runHeroic(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "run-heroic", []string{"playmaker", "builder", "safety_officer", "bard"})
	if err != nil {
		return 1, err
	}
	baseline, err := d.Rev("HEAD") // pinned before this match ships anything
	if err != nil {
		return 1, err
	}
	shortBase, _ := d.ShortSHA(baseline)
	if err := askObjective(m, a.Prompt, "baseline", shortBase); err != nil {
		return 1, err
	}
	plan, err := specObjective(m, a.Prompt, true)
	if err != nil {
		return 1, err
	}
	// The playmaker is the first player to look at the tree. When it finds
	// nothing to build (noop) or nothing buildable (blocked), every later
	// objective is spend with no possible product.
	if plan.Ruling != "implement" {
		return ruling.EndWithoutBuild(m, plan), nil
	}
	if err := shipObjective(d, m, "ship_spec", "Put the spec on record before any code exists to blur it",
		shipMessage(plan, "docs", m.ID())); err != nil {
		return 1, err
	}
	var build reports.Report
	if build, err = buildCall(m, match.Params{Name: "build", Kind: match.Player, Owner: "builder",
		Description: "Implement the plan exactly"}, a.Prompt, plan, "replay_matches_report"); err != nil {
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
		if build, err = buildCall(m, match.Params{Name: fmt.Sprintf("iterate_%d", i), Kind: match.Player,
			Owner: "builder", Retries: 1, Description: "Repair what the suite reported, from its verbatim output"},
			a.Prompt, qa.AsReport(*test, "tests"), "replay_matches_report"); err != nil {
			return 1, err
		}
	}

	var review *reports.VarReport
	revised := false
	for i := 1; i <= MaxHeroicRevisions; i++ {
		if review, err = reviewObjective(m, fmt.Sprintf("review_%d", i), "Confirm the build matches the plan",
			a.Prompt, build); err != nil {
			return 1, err
		}
		if review.Approved || i == MaxHeroicRevisions {
			break
		}
		if build, err = buildCall(m, match.Params{Name: fmt.Sprintf("revise_%d", i), Kind: match.Player,
			Owner: "builder", Retries: 1, Description: "Close the safety officer's blocking findings"},
			a.Prompt, review, "replay_matches_report"); err != nil {
			return 1, err
		}
		revised = true
	}

	// A revision edited code after the suite last ran, so its green light is
	// stale. Run it again rather than ship on a result that predates the change.
	if revised && review != nil && review.Approved {
		result, err := testObjective(d, m, "retest")
		if err != nil {
			return 1, err
		}
		test = &result
	}

	// Red tests or a rejected review stop the chain here: the code stays
	// unshipped and nothing is documented. The spec commit stands.
	verified := test != nil && test.Passed && review != nil && review.Approved
	if verified {
		if err := shipObjective(d, m, "ship_build", "Land the code only now: green suite, approved review",
			shipMessage(build, "feat", m.ID())); err != nil {
			return 1, err
		}
		changeset, err := changesObjective(d, m, baseline,
			"Diff the whole match against its pinned baseline, for the bard", "there is nothing to document.")
		if err != nil {
			return 1, err
		}
		var document reports.Report
		if err := m.Objective(match.Params{Name: "document", Kind: match.Player, Owner: "bard", Retries: 1,
			Description: "Write up the completed change"}, func(h match.Handle) error {
			report, err := h.Call(match.Call{ReportType: "BardReport", Prompt: a.Prompt,
				Previous: changesReport(changeset), Reviews: reviews("ball_in_play", "ball_not_flat")})
			document = report
			return err
		}); err != nil {
			return 1, err
		}
		if err := shipObjective(d, m, "ship_docs", "Ship the write-up in its own commit, beside the code it describes",
			shipMessage(document, "docs", m.ID())); err != nil {
			return 1, err
		}
	}
	return m.Finish(verified, "the suite or the review never came back clean"), nil
}
