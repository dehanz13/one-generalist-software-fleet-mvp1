// Package changes captures what was built, straight from git. (Legacy:
// adw_modules/changes.py.)
//
// "What changed since main" is not a judgement call: it is two git commands
// and a subtraction. So it is code, and a player is only handed the result.
// Capture writes the full diff into the torch pass and returns a ChangeSet;
// AsReport adapts it into the one door every hand-over uses.
//
// The base is resolved, not assumed. Off the base branch the diff covers the
// whole branch plus the working tree; on it, the uncommitted tree; and on a
// clean tree, the last commit, because "document the work just done" still
// has an answer right after a chain committed. Whichever it picked rides
// along in BaseRef.Reason, so the record never leaves anyone guessing.
package changes

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/gitops"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// DiffFilename is the diff's name inside the torch pass.
const DiffFilename = "changes.diff"

// Capture is everything a capture needs. (Legacy: ChangeCapture.)
type Capture struct {
	Base             string // the ref the work is measured against
	MaxDiffLines     int    // the diff artifact is truncated past this
	IncludeUntracked bool   // a brand-new file is part of the change
}

// DefaultCapture is legacy's defaults: main, 2000 lines, untracked included.
func DefaultCapture(base string) Capture {
	if base == "" {
		base = "main"
	}
	return Capture{Base: base, MaxDiffLines: 2000, IncludeUntracked: true}
}

// BaseRef is the commit a change is measured from, and why that one.
type BaseRef struct {
	Ref    string // what was asked for: "main", or a pinned sha
	Commit string // the commit actually diffed against
	Reason string
}

// Label is the display form: a named ref as itself, a pinned sha shortened.
func (b BaseRef) Label() string {
	if len(b.Ref) == 40 && strings.Trim(b.Ref, "0123456789abcdef") == "" {
		return b.Ref[:7]
	}
	return b.Ref
}

// ChangeSet is what changed since the base commit: pure git facts.
type ChangeSet struct {
	Base       BaseRef
	Files      []string
	Untracked  []string
	Insertions int
	Deletions  int
	Stat       string
	DiffPath   string
	Truncated  bool
}

// Empty is true when nothing changed.
func (c ChangeSet) Empty() bool { return len(c.Files) == 0 && len(c.Untracked) == 0 }

func short(ref string) string {
	s, err := gitops.ShortSHA(ref)
	if err != nil {
		return ref
	}
	return s
}

// ResolveBase picks the commit the work is measured from, and records why.
func ResolveBase(ref string) (BaseRef, error) {
	if !gitops.IsRepo() {
		return BaseRef{}, errors.New("not a git repository — change capture needs one. Run `git init` in " +
			"the repo root before running a set piece that documents a change")
	}
	if !gitops.RefExists(ref) {
		return BaseRef{}, fmt.Errorf("base ref %q does not exist in this repository — pass --base "+
			"with a ref that does (e.g. --base master, --base HEAD~1)", ref)
	}
	commit, err := gitops.MergeBase(ref, "HEAD")
	if err != nil {
		return BaseRef{}, err
	}
	base := BaseRef{Ref: ref, Commit: commit}
	dirty, _ := gitops.IsDirty()
	switch {
	case short(base.Commit) != short("HEAD"):
		base.Reason = fmt.Sprintf("HEAD is ahead of %s — diffing every commit since, plus the working tree", base.Label())
	case dirty:
		base.Reason = fmt.Sprintf("HEAD is on %s — diffing the uncommitted working tree", base.Label())
	case gitops.RefExists("HEAD~1"):
		parent, err := gitops.Rev("HEAD~1")
		if err != nil {
			return BaseRef{}, err
		}
		base.Commit = parent
		base.Reason = fmt.Sprintf("HEAD is on %s with a clean tree — falling back to the last commit", base.Label())
	default:
		base.Reason = fmt.Sprintf("HEAD is on %s with a clean tree and no parent commit", base.Label())
	}
	return base, nil
}

// Run diffs the working tree against the resolved base and keeps the evidence.
func Run(torchPassDir string, params Capture) (ChangeSet, error) {
	base, err := ResolveBase(params.Base)
	if err != nil {
		return ChangeSet{}, err
	}
	files, err := gitops.DiffFiles(base.Commit)
	if err != nil {
		return ChangeSet{}, err
	}
	var untracked []string
	if params.IncludeUntracked {
		if untracked, err = gitops.UntrackedFiles(); err != nil {
			return ChangeSet{}, err
		}
	}
	insertions, deletions, err := gitops.DiffCounts(base.Commit)
	if err != nil {
		return ChangeSet{}, err
	}
	stat, err := gitops.DiffStat(base.Commit)
	if err != nil {
		return ChangeSet{}, err
	}
	text, err := gitops.DiffText(base.Commit)
	if err != nil {
		return ChangeSet{}, err
	}
	lines := strings.Split(text, "\n")
	if text == "" {
		lines = nil
	}
	truncated := len(lines) > params.MaxDiffLines
	if truncated {
		text = strings.Join(lines[:params.MaxDiffLines], "\n") +
			fmt.Sprintf("\n\n[truncated at %d lines of %d — run `git diff %s` for the rest]", params.MaxDiffLines, len(lines), base.Commit)
	}
	// Untracked files are absent from `git diff` by construction, so they are
	// named here rather than silently missing from the record.
	untrackedBlock := "  (none)"
	if len(untracked) > 0 {
		var b []string
		for _, f := range untracked {
			b = append(b, "  "+f)
		}
		untrackedBlock = strings.Join(b, "\n")
	}
	statBlock := stat
	if statBlock == "" {
		statBlock = "  (no tracked changes)"
	}
	diffPath := filepath.Join(torchPassDir, DiffFilename)
	content := fmt.Sprintf("# changes since %s @ %s\n# %s\n# +%d -%d across %d tracked file(s)\n\n"+
		"## stat\n%s\n\n## untracked files\n%s\n\n## diff\n%s\n",
		base.Label(), short(base.Commit), base.Reason, insertions, deletions, len(files), statBlock, untrackedBlock, text)
	if err := os.MkdirAll(torchPassDir, 0o755); err != nil {
		return ChangeSet{}, err
	}
	if err := os.WriteFile(diffPath, []byte(content), 0o644); err != nil {
		return ChangeSet{}, err
	}
	return ChangeSet{Base: base, Files: files, Untracked: untracked, Insertions: insertions,
		Deletions: deletions, Stat: stat, DiffPath: diffPath, Truncated: truncated}, nil
}

// AsReport wraps a captured change so a player can be handed it directly.
func AsReport(c ChangeSet, notes string) *reports.ChangesReport {
	total := len(c.Files) + len(c.Untracked)
	report := &reports.ChangesReport{
		MatchReport: reports.MatchReport{
			Status:             reports.Touchdown,
			Summary:            fmt.Sprintf("%d file(s) changed since %s (+%d -%d)", total, c.Base.Label(), c.Insertions, c.Deletions),
			Artifacts:          []string{c.DiffPath},
			NotesForNextPlayer: notes,
		},
		BaseRef:      fmt.Sprintf("%s @ %s — %s", c.Base.Label(), short(c.Base.Commit), c.Base.Reason),
		ChangedFiles: append(append([]string{}, c.Files...), c.Untracked...),
		Insertions:   c.Insertions,
		Deletions:    c.Deletions,
		Stat:         c.Stat,
		DiffPath:     c.DiffPath,
	}
	reports.Normalize(report)
	return report
}
