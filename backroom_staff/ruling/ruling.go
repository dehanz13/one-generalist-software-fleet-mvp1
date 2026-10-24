// Package ruling ends a match at the spec when the playmaker found nothing
// to build. (Legacy: adw_modules/verdict.py; the picked name is ruling.)
//
// The playmaker is the first player to look at the tree. TalkReport.Ruling
// lets it say what it saw, `noop` (already done) or `blocked` (cannot be done
// as asked), and this package is what the set piece does with that. A match
// once had no such channel: the planner wrote "make no commit" in prose and
// build, test and review ran four more minutes until `git add -A` came up empty.
//
// The policy is deliberately the same for both rulings:
//
//   - The match is NOT accepted (non-zero exit). A dispatched quest that
//     produced nothing is something the founder has to see; a quiet exit 0 is
//     how a chain of dispatches would report "all done" over work that never
//     happened. The rulings differ in the reason line, not the exit code.
//   - The plan's copy under specs/ is removed, never committed: it describes
//     no work, and left untracked it fails the next kickoff checklist's
//     clean-tree check. The record survives in <match>/torch_pass/plan.md.
package ruling

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// Finisher is what EndWithoutBuild needs from a match.
type Finisher interface {
	Finish(accepted bool, reason string) int
	TorchPassDir() string
}

func untracked(path string) bool {
	return exec.Command("git", "ls-files", "--error-unmatch", path).Run() != nil
}

func underSpecs(path string) bool {
	parts := strings.Split(filepath.ToSlash(filepath.Clean(path)), "/")
	return len(parts) > 0 && parts[0] == "specs"
}

// RestorePlanCopy puts the playmaker's specs/ copy back if a player removed
// it, and returns what it restored. A builder once ran `git status`, saw the
// playmaker's untracked plan, called it "unexpected" and deleted it; the
// quest was committed without the plan that produced it. The match's copy is
// identical by construction (the playmaker is told to `cp` it), so restoring
// is a copy, not a reconstruction, and nothing is restored that the match
// does not hold.
func RestorePlanCopy(torchPassDir string, plan *reports.TalkReport) []string {
	source := filepath.Join(torchPassDir, "plan.md")
	info, err := os.Stat(source)
	if err != nil || info.IsDir() {
		return nil
	}
	var restored []string
	for _, artifact := range plan.Artifacts {
		if !underSpecs(artifact) {
			continue
		}
		if _, err := os.Stat(artifact); err == nil {
			continue
		}
		data, err := os.ReadFile(source)
		if err != nil {
			continue
		}
		if os.MkdirAll(filepath.Dir(artifact), 0o755) != nil || os.WriteFile(artifact, data, 0o644) != nil {
			continue
		}
		restored = append(restored, artifact)
	}
	return restored
}

// EndWithoutBuild closes a match whose playmaker ruled noop or blocked, and
// returns its exit code.
func EndWithoutBuild(m Finisher, plan *reports.TalkReport) int {
	var removed []string
	for _, artifact := range plan.Artifacts {
		// Only the playmaker's repo copy: never the match's record, never a
		// tracked file, never anything outside specs/.
		info, err := os.Stat(artifact)
		if underSpecs(artifact) && err == nil && !info.IsDir() && untracked(artifact) {
			if os.Remove(artifact) == nil {
				removed = append(removed, artifact)
			}
		}
	}
	what := map[string]string{
		"noop":    "nothing to build — the tree already satisfies the request",
		"blocked": "cannot be built as specified",
	}[plan.Ruling]
	because := plan.RulingReason
	if because == "" {
		because = plan.Summary
	}
	tail := ""
	if len(removed) > 0 {
		tail = "; removed " + strings.Join(removed, ", ")
	}
	reason := fmt.Sprintf("playmaker ruling `%s`: %s. %s (plan kept at %s%s)",
		plan.Ruling, what, because, filepath.Join(m.TorchPassDir(), "plan.md"), tail)
	return m.Finish(false, reason)
}
