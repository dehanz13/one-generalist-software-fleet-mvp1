// Package gitops is the git the referee objectives run, through the git
// CLI in the current directory. (Legacy: adw_modules/git_helper.py.)
package gitops

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Git runs git and returns its trimmed stdout, or an error carrying stderr.
func Git(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git %s failed: %s", strings.Join(args, " "), strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(string(out)), nil
}

// ok runs git and reports only whether it exited 0. It never fails: it is a question.
func ok(args ...string) bool {
	return exec.Command("git", args...).Run() == nil
}

// CurrentBranch is the branch HEAD is on.
func CurrentBranch() (string, error) { return Git("rev-parse", "--abbrev-ref", "HEAD") }

// CreateBranch checks out a new branch.
func CreateBranch(name string) (string, error) {
	_, err := Git("checkout", "-b", name)
	return name, err
}

// IsRepo is true inside a git repository.
func IsRepo() bool { return ok("rev-parse", "--git-dir") }

// RepoRoot is where every player is spawned to work: the git toplevel when
// there is one, else the current directory (set pieces run fine outside git;
// only a ship objective needs a repository). Always absolute.
func RepoRoot() string {
	if IsRepo() {
		if top, err := Git("rev-parse", "--show-toplevel"); err == nil {
			if abs, err := filepath.Abs(top); err == nil {
				return abs
			}
		}
	}
	cwd, _ := os.Getwd()
	abs, _ := filepath.Abs(cwd)
	return abs
}

// CommitAll stages the working tree and commits it, returning the new short sha.
func CommitAll(message string) (string, error) {
	if !IsRepo() {
		return "", errors.New("not a git repository — a ship objective needs one. Run `git init` in the " +
			"repo root (and make a first commit) before running a set piece that commits")
	}
	if _, err := Git("add", "-A"); err != nil {
		return "", err
	}
	status, err := Git("status", "--porcelain")
	if err != nil {
		return "", err
	}
	if status == "" {
		return "", errors.New("nothing to commit — the preceding objectives changed no files")
	}
	if _, err := Git("commit", "-m", message); err != nil {
		return "", err
	}
	return Git("rev-parse", "--short", "HEAD")
}

// UncommitTo undoes commits made since `base`, keeping their changes staged,
// and returns the short shas it undid.
//
// The difficulty commits; a player must not. A builder once ran `git commit`
// itself during the build: the quest's contract compared each file with HEAD,
// so every check compared a file with itself and could not fail, and the
// scope check saw one changed path where there were fifteen. A soft reset to
// the commit the build started from puts the whole diff back where the
// contract, the hook rehearsal and the final commit expect it.
//
// Does nothing when HEAD is `base`, and refuses (returns nothing, leaves HEAD
// alone) when `base` is not an ancestor of HEAD: that is a branch somebody
// moved, not a player's extra commit.
func UncommitTo(base string) ([]string, error) {
	head, err := Rev("HEAD")
	if err != nil {
		return nil, err
	}
	target, err := Rev(base)
	if err != nil {
		return nil, err
	}
	if head == target {
		return nil, nil
	}
	if !ok("merge-base", "--is-ancestor", base, "HEAD") {
		return nil, nil
	}
	log, err := Git("log", "--format=%h", base+"..HEAD")
	if err != nil {
		return nil, err
	}
	if _, err := Git("reset", "--soft", base); err != nil {
		return nil, err
	}
	return strings.Fields(log), nil
}

// ChangedFiles lists what `git status --porcelain` reports.
func ChangedFiles() ([]string, error) {
	out, err := Git("status", "--porcelain")
	if err != nil {
		return nil, err
	}
	var files []string
	for _, line := range strings.Split(out, "\n") {
		if len(line) > 3 {
			files = append(files, line[3:])
		}
	}
	return files, nil
}

// RefExists is true when ref resolves to a commit.
func RefExists(ref string) bool { return ok("rev-parse", "--verify", "--quiet", ref+"^{commit}") }

// Rev resolves a ref to its full sha.
func Rev(ref string) (string, error) { return Git("rev-parse", ref) }

// ShortSHA resolves a ref to its short sha.
func ShortSHA(ref string) (string, error) { return Git("rev-parse", "--short", ref) }

// MergeBase is where ref and other diverged: the honest base of a branch. On
// the base branch itself it is HEAD, which makes the diff exactly "what is
// not committed yet"; off it, the whole branch plus the working tree.
func MergeBase(ref, other string) (string, error) { return Git("merge-base", ref, other) }

// IsDirty is true when the working tree has any change, untracked included.
func IsDirty() (bool, error) {
	out, err := Git("status", "--porcelain")
	return out != "", err
}

// UntrackedFiles lists untracked, unignored files.
func UntrackedFiles() ([]string, error) {
	out, err := Git("ls-files", "--others", "--exclude-standard")
	if err != nil {
		return nil, err
	}
	return lines(out), nil
}

// DiffFiles are the tracked files that differ between base and the working tree.
func DiffFiles(base string) ([]string, error) {
	out, err := Git("diff", "--name-only", base)
	if err != nil {
		return nil, err
	}
	return lines(out), nil
}

// DiffStat is `git diff --stat base`, verbatim.
func DiffStat(base string) (string, error) { return Git("diff", "--stat", base) }

// DiffCounts sums insertions and deletions; binary files count as neither.
func DiffCounts(base string) (int, int, error) {
	out, err := Git("diff", "--numstat", base)
	if err != nil {
		return 0, 0, err
	}
	ins, del := 0, 0
	for _, line := range lines(out) {
		fields := strings.Split(line, "\t")
		if len(fields) < 2 {
			continue
		}
		if n, err := strconv.Atoi(fields[0]); err == nil {
			ins += n
		}
		if n, err := strconv.Atoi(fields[1]); err == nil {
			del += n
		}
	}
	return ins, del, nil
}

// DiffText is the full diff against base.
func DiffText(base string) (string, error) { return Git("diff", base) }

func lines(out string) []string {
	var result []string
	for _, line := range strings.Split(out, "\n") {
		if line != "" {
			result = append(result, line)
		}
	}
	return result
}
