// Package restrictedarea enforces what a player may CHANGE, in code, after
// the fact. (Legacy: adw_modules/permissions.py; the picked name for
// protected_files is the restricted area.)
//
// `tools:` is a capability list, not a sandbox, and two holes make it
// unenforceable on its own:
//
//   - `bash` runs anything. A builder handed bash to run a test suite once ran
//     `git checkout` on the very quality check it was about to be judged by.
//   - `write` reaches any path, not just the one report file it was given for.
//
// So permission is verified the way every other claim is: after the fact,
// against the repo itself. Snapshot fingerprints the working tree's
// change-set before a player runs; Enforce compares afterwards and fails the
// objective if the player touched anything outside its allowlist. Comparing
// change-sets, rather than watching writes, catches the `git checkout` case:
// a path that was modified before and is clean after has been reverted, and
// a reversion is a modification.
//
// A breach is NOT an official review failure. Reviews are for work a player
// can be asked to redo; a breach cannot be corrected by re-prompting, because
// the write already happened. It aborts the objective and names every path.
package restrictedarea

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
)

// Breach is a player modifying a path it was not permitted to modify.
// (Legacy: PermissionBreach.)
type Breach struct {
	Message string
}

func (e *Breach) Error() string { return e.Message }

func git(root string, args ...string) string {
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return string(out)
}

// Snapshot fingerprints every path the working tree differs on. Tracked
// files carry their numstat counts, so an edit to an already-dirty file still
// registers; untracked files are listed by name. Ignored paths never appear,
// which is why the match runtime under the data dir needs no special case.
func Snapshot(root string) map[string]string {
	prints := map[string]string{}
	for _, line := range strings.Split(git(root, "diff", "HEAD", "--numstat"), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) >= 3 {
			prints[strings.TrimSpace(fields[len(fields)-1])] = fields[0] + "," + fields[1]
		}
	}
	for _, path := range strings.Split(git(root, "ls-files", "--others", "--exclude-standard"), "\n") {
		if p := strings.TrimSpace(path); p != "" {
			prints[p] = "untracked"
		}
	}
	return prints
}

// ChangedPaths are the paths whose state differs: appeared, vanished, or rewritten.
func ChangedPaths(before, after map[string]string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range []map[string]string{before, after} {
		for p := range m {
			b, inB := before[p]
			a, inA := after[p]
			if (inB != inA || b != a) && !seen[p] {
				seen[p] = true
				out = append(out, p)
			}
		}
	}
	sort.Strings(out)
	return out
}

// globRegexp translates a pattern with `*` and `?` stopping at a path
// separator. fnmatch would let `*` cross `/`, which quietly widens every
// pattern; `**` is the way to say "cross directories".
func globRegexp(pattern string) *regexp.Regexp {
	var b strings.Builder
	for i := 0; i < len(pattern); {
		switch {
		case strings.HasPrefix(pattern[i:], "**"):
			b.WriteString(".*")
			i += 2
		case pattern[i] == '*':
			b.WriteString("[^/]*")
			i++
		case pattern[i] == '?':
			b.WriteString("[^/]")
			i++
		default:
			b.WriteString(regexp.QuoteMeta(pattern[i : i+1]))
			i++
		}
	}
	return regexp.MustCompile("^(?:" + b.String() + ")$")
}

// Matches applies one allowlist pattern to a path: a trailing "/" is a
// directory prefix, "*" or "?" make a glob, anything else is exact.
func Matches(path, pattern string) bool {
	if strings.HasSuffix(pattern, "/") {
		return strings.HasPrefix(path, pattern)
	}
	if strings.ContainsAny(pattern, "*?") {
		return globRegexp(pattern).MatchString(path)
	}
	return path == pattern
}

// AlwaysWritable is the match runtime, which EVERY player must be able to
// write: the torch pass is where players hand work to each other, and a
// read-only player is read-only with respect to the REPO, never with respect
// to its own report. Granted from the data dir rather than left to
// .gitignore, which someone can delete.
func AlwaysWritable(cfg *boardroom.Config) []string {
	return []string{strings.TrimRight(cfg.Defaults.DataDir, "/") + "/"}
}

// Permitted checks the match runtime first, then the player's own list, then
// what is restricted.
func Permitted(path string, player *boardroom.Player, cfg *boardroom.Config) bool {
	for _, p := range AlwaysWritable(cfg) {
		if Matches(path, p) {
			return true
		}
	}
	for _, p := range player.Writes {
		if Matches(path, p) {
			return true // naming a path is what unlocks a restricted one
		}
	}
	for _, p := range cfg.Defaults.RestrictedArea {
		if Matches(path, p) {
			return false
		}
	}
	return player.Writes == nil // nil = unrestricted, [] = no repo writes
}

// rollBack undoes one unauthorized change and says what happened. Only
// changes the player INTRODUCED are undone: a path already dirty when it
// started is the founder's uncommitted work, and discarding it to tidy up
// would be the same harm this package exists to prevent.
func rollBack(root, path string, before, after map[string]string) string {
	if _, was := before[path]; was {
		if _, still := after[path]; !still {
			return "REVERTED-BY-PLAYER (uncommitted work lost, cannot restore)"
		}
		return "left as-is (was already modified)"
	}
	if after[path] == "untracked" {
		if err := os.Remove(filepath.Join(root, path)); err != nil {
			return fmt.Sprintf("could not delete (%v)", err)
		}
		return "deleted"
	}
	cmd := exec.Command("git", "checkout", "--", path)
	cmd.Dir = root
	if cmd.Run() != nil {
		return "could not roll back"
	}
	return "rolled back"
}

// Enforce compares the tree against `before`; it undoes and fails if the
// player overstepped. It returns the paths the player legitimately changed,
// so the record shows what it actually touched, not only what it claimed.
func Enforce(root string, player *boardroom.Player, cfg *boardroom.Config, before map[string]string) ([]string, error) {
	after := Snapshot(root)
	touched := ChangedPaths(before, after)
	var breaches []string
	for _, p := range touched {
		if !Permitted(p, player, cfg) {
			breaches = append(breaches, p)
		}
	}
	if len(breaches) == 0 {
		return touched, nil
	}
	var detail []string
	for _, p := range breaches {
		detail = append(detail, fmt.Sprintf("  - %s — %s", p, rollBack(root, p, before, after)))
	}
	var scope string
	switch {
	case player.Writes != nil && len(player.Writes) == 0:
		scope = "read-only"
	case len(player.Writes) > 0:
		scope = fmt.Sprintf("limited to %s", pyList(player.Writes))
	default:
		scope = fmt.Sprintf("barred from %s", pyList(cfg.Defaults.RestrictedArea))
	}
	return touched, &Breach{Message: fmt.Sprintf("%s is %s but modified %d path(s):\n%s",
		player.Name, scope, len(breaches), strings.Join(detail, "\n"))}
}

func pyList(items []string) string {
	quoted := make([]string, len(items))
	for i, s := range items {
		quoted[i] = "'" + s + "'"
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}
