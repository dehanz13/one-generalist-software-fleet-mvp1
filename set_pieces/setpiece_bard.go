package setpieces

import (
	"fmt"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/changes"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// bard: write up the work that was just done, from the diff.
// (Legacy: adw_document.py, which had no recipe.)
//
// This runs AFTER a build, and the guard is structural rather than advisory:
// the change capture is a referee objective, and an empty diff fails there,
// before the bard is ever spawned.
func init() {
	register(SetPiece{
		Command: "bard", File: "setpiece_bard.go",
		Summary:  "write up the latest change: ogsf bard \"document the health endpoint\" [--base main]",
		Chain:    "head_coach(ask) → referee(changes) → bard(document)",
		Required: []string{"bard"},
		Run:      runBard,
	})
}

func runBard(d *Deps, a Args) (int, error) {
	base := a.Base
	if base == "" {
		base = "main"
	}
	_, m, err := start(d, a, "bard", []string{"bard"})
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {
		return 1, err
	}
	changeset, err := changesObjective(d, m, base,
		fmt.Sprintf("Diff the working tree against %s — the change to be written up", base),
		"documenting runs after a build. Build something first, or point --base at the ref the work should be measured from.")
	if err != nil {
		return 1, err
	}
	if err := documentObjective(m, a.Prompt, changeset, "Turn the captured diff into a write-up a founder can read"); err != nil {
		return 1, err
	}
	return m.Finish(true, ""), nil
}

// changesObjective captures the diff, refusing an empty one.
func changesObjective(d *Deps, m match.Runner, base, description, emptyHint string) (changes.ChangeSet, error) {
	var set changes.ChangeSet
	err := m.Objective(match.Params{Name: "changes", Kind: match.Referee, Owner: "git", Description: description},
		func(h match.Handle) error {
			var err error
			if set, err = d.CaptureChanges(m, base); err != nil {
				return err
			}
			h.Log("base", fmt.Sprintf("%s @ %s", set.Base.Label(), head7(set.Base.Commit)),
				"reason", set.Base.Reason,
				"files", len(set.Files)+len(set.Untracked),
				"lines", fmt.Sprintf("+%d -%d", set.Insertions, set.Deletions),
				"diff", set.DiffPath)
			if set.Empty() {
				return fmt.Errorf("nothing changed since %s (%s) — %s", set.Base.Label(), set.Base.Reason, emptyHint)
			}
			return nil
		})
	return set, err
}

// documentObjective runs the bard over a captured change.
func documentObjective(m match.Runner, prompt string, set changes.ChangeSet, description string) error {
	return m.Objective(match.Params{Name: "document", Kind: match.Player, Owner: "bard", Retries: 1,
		Description: description}, func(h match.Handle) error {
		_, err := h.Call(match.Call{ReportType: "BardReport", Prompt: prompt,
			Previous: changes.AsReport(set, DocumentNotes), Reviews: reviews("ball_in_play", "ball_not_flat")})
		return err
	})
}

// changesReport hands a captured change to the bard.
func changesReport(set changes.ChangeSet) *reports.ChangesReport {
	return changes.AsReport(set, DocumentNotes)
}

func head7(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}
