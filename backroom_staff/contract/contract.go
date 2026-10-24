// Package contract reads and checks a quest's contract: the part of a spec
// a machine can hold a match to. (Legacy: adw_modules/contract.py.)
//
// A spec is prose for players. Prose cannot refuse a dispatch, and by the
// time a player has read it the tokens are spent. So a spec may carry one
// fenced block the harness reads itself:
//
//	```ogsf
//	difficulty: run-mythic      # the set piece this quest must run under
//	precondition: |             # exit 0 = work REMAINS. Run before any player.
//	  test "$(npx eslint components/contact --format json | jq '[.[].errorCount]|add')" -gt 0
//	writes:                     # every path the match may change (fnmatch; `*` crosses `/`)
//	  - components/contact/*
//	checks:                     # must exit 0 on the built tree, before the quality gate
//	  - name: touched files are lint-clean
//	    run: git diff --name-only HEAD -- '*.test.tsx' | xargs npx eslint --no-warn-ignored
//	```
//
// Why each field exists: a spec once named a difficulty that ran tests only
// for a quest judged on its lint delta (difficulty); a quest was dispatched a
// second time after it had merged (precondition); the safety officer was the
// only scope check, and it is a judgement while a glob is not (writes); and
// an acceptance criterion written as prose is checked by whoever remembers
// to, while a command is checked every loop (checks).
//
// A spec with no block is still valid: everything here treats nil as
// "nothing declared", and says so rather than reporting a pass it did not earn.
package contract

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
)

var block = regexp.MustCompile("(?ms)^```ogsf[ \\t]*\\n(.*?)^```[ \\t]*$")

// AlwaysWritable is the playmaker's own allowlist (`writes: specs/` in the
// config). A contract that forgot it would fail every match on the plan file
// the harness asked for.
var AlwaysWritable = []string{"specs/*"}

// OutputTail is how much of a failed check's output is handed back.
const OutputTail = 3000

// Check is one named command a contract runs.
type Check struct {
	Name string `yaml:"name"`
	Run  string `yaml:"run"`
}

// QuestContract is a spec's declared contract. (Legacy: SliceContract.)
type QuestContract struct {
	Difficulty   string   `yaml:"difficulty"`
	Precondition string   `yaml:"precondition"`
	Writes       []string `yaml:"writes"`
	Checks       []Check  `yaml:"checks"`
}

// legacyDifficulty maps the difficulty words a legacy spec may still carry
// under its old `lane:` key, so a spec written for the Python factory keeps
// working.
var legacyDifficulty = map[string]string{
	"sdlc-strict": "run-mythic", "simple-sdlc": "run-heroic", "sdlc": "run-normal",
	"plan-build": "talk-attack", "plan": "team-talk", "prompt": "ask", "scout": "scout-opposition",
}

// Parse returns the contract declared in specText, or nil when it declares
// none. A malformed block is an error: a contract the harness cannot read
// must stop the dispatch, not quietly degrade into "no contract".
func Parse(specText string) (*QuestContract, error) {
	found := block.FindAllStringSubmatch(specText, -1)
	if len(found) == 0 {
		return nil, nil
	}
	if len(found) > 1 {
		return nil, fmt.Errorf("spec declares %d ```ogsf blocks; exactly one is allowed", len(found))
	}
	var raw any
	if err := yaml.Unmarshal([]byte(found[0][1]), &raw); err != nil {
		return nil, err
	}
	if raw == nil {
		return &QuestContract{}, nil
	}
	mapping, ok := raw.(map[string]any)
	if !ok {
		return nil, errors.New("```ogsf block must be a YAML mapping")
	}
	if lane, has := mapping["lane"]; has {
		if _, set := mapping["difficulty"]; !set {
			if name, ok := lane.(string); ok {
				if mapped, known := legacyDifficulty[name]; known {
					name = mapped
				}
				mapping["difficulty"] = name
			}
		}
		delete(mapping, "lane")
	}
	data, err := yaml.Marshal(mapping)
	if err != nil {
		return nil, err
	}
	var c QuestContract
	if err := yaml.Unmarshal(data, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

// Pace, when set, is extra time a contract command takes on the active clock
// (the demo's virtual clock; nil in normal use).
var Pace func(command string) time.Duration

// Shell runs a contract command the way the founder's shell would, with
// pipefail on, and returns (exit, output). A command still running at the
// limit is killed with its children and reported as exit 124.
func Shell(command string, timeout time.Duration) (int, string) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := kit.GroupCommand(ctx, "bash", "-o", "pipefail", "-c", command)
	cmd.Env = kit.OperatorEnv()
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return 124, fmt.Sprintf("timed out after %ds", int(timeout.Seconds()))
	}
	if Pace != nil {
		kit.Sleep(Pace(command))
	}
	code := 0
	if err != nil {
		code = 127
		if cmd.ProcessState != nil {
			code = cmd.ProcessState.ExitCode()
		}
	}
	return code, strings.TrimSpace(stdout.String() + stderr.String())
}

// OutOfScope returns the paths that match no allowed glob. Pure: the
// testable half of scope.
func OutOfScope(paths, writes []string) []string {
	allowed := append(append([]string{}, writes...), AlwaysWritable...)
	var out []string
	for _, p := range paths {
		matched := false
		for _, g := range allowed {
			if Fnmatch(p, g) {
				matched = true
				break
			}
		}
		if !matched {
			out = append(out, p)
		}
	}
	return out
}

// ChangedPaths is every path that differs from HEAD, renames by their new name.
func ChangedPaths() []string {
	out, _ := exec.Command("git", "status", "--porcelain", "--untracked-files=all").Output()
	var paths []string
	for _, line := range strings.Split(string(out), "\n") {
		if len(line) < 4 {
			continue
		}
		parts := strings.Split(line[3:], " -> ")
		path := strings.TrimSpace(parts[len(parts)-1])
		if len(path) >= 2 && strings.HasPrefix(path, `"`) && strings.HasSuffix(path, `"`) {
			path = path[1 : len(path)-1]
		}
		paths = append(paths, path)
	}
	return paths
}

// HookPath is the pre-commit hook a contract rehearses.
func HookPath(repoRoot string) string { return filepath.Join(repoRoot, ".husky", "pre-commit") }

func hookInstalled(repoRoot string) bool {
	info, err := os.Stat(HookPath(repoRoot))
	return err == nil && !info.IsDir()
}

// RehearsePreCommit runs the repo's pre-commit hook now, on the tree the
// commit would stage, and returns the failure text ("" when it passes).
//
// The commit is a set piece's LAST step, so a hook that refuses the tree is
// otherwise found only after every paid objective. The hook may rewrite files
// (lint-staged runs `eslint --fix` and Prettier), which is why this runs
// BEFORE the quality gate: the tree that gets tested is the tree that gets
// committed.
func RehearsePreCommit(repoRoot string) string {
	if !hookInstalled(repoRoot) {
		return ""
	}
	add := exec.Command("git", "add", "-A")
	add.Dir = repoRoot
	_ = add.Run()
	// Leave the index as it was found (a committing set piece starts clean,
	// so "as found" is empty). The restricted area tells a player's new file
	// from an old one by whether it is untracked; a file left staged would
	// read as already known. Working-tree content is kept.
	defer func() {
		reset := exec.Command("git", "reset", "-q")
		reset.Dir = repoRoot
		_ = reset.Run()
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 900*time.Second)
	defer cancel()
	cmd := kit.GroupCommand(ctx, "sh", HookPath(repoRoot))
	cmd.Dir = repoRoot
	cmd.Env = kit.OperatorEnv()
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return "pre-commit hook: timed out after 900s"
	}
	if err == nil {
		return ""
	}
	code := 1
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	return fmt.Sprintf("pre-commit hook (.husky/pre-commit) exited %d — `git commit` "+
		"would be refused on this tree. Fix what it reports; do not bypass the hook.\n%s",
		code, kit.Tail(out.String()+stderr.String(), OutputTail))
}

// RewrittenNote tells the fixer the hook already rewrote the files it was shown.
const RewrittenNote = "Note: the pre-commit hook ran before this check and has ALREADY rewritten the files it " +
	"touches (`eslint --fix`, then Prettier). The file this check read is not the file you last " +
	"wrote. Read each named file again, as it is now, before you change anything: a long line you " +
	"wrote may have been wrapped, and a `// eslint-disable-next-line` comment covers only the line " +
	"directly below it AFTER formatting. Writing the same line again will be wrapped again."

// CheckFailure is the text handed back for one failed check. Pure, so what
// the fixer is told can be tested. `rewritten` adds RewrittenNote: a quest
// once failed three attempts on a suppression Prettier kept moving off its
// line, because nothing told the builder the file it was shown was not the
// file it had written.
func CheckFailure(name string, code int, command, output string, rewritten bool) string {
	text := fmt.Sprintf("contract check `%s` failed (exit %d):\n$ %s\n%s",
		name, code, strings.TrimSpace(command), kit.Tail(output, OutputTail))
	if rewritten {
		return text + "\n" + RewrittenNote
	}
	return text
}

// RepeatNote marks a failure that is what the previous attempt ended with.
const RepeatNote = "REPEATED FAILURE: this is the same failure the previous attempt ended with (line numbers " +
	"aside). Whatever the last fix changed did not change what this check sees, so making that " +
	"change again will fail again. Before editing: read each named file as it is NOW, run the " +
	"failing command yourself and read its output, and change something different."

var digits = regexp.MustCompile(`\d+`)

func shape(failures []string) []string {
	out := make([]string, len(failures))
	for i, f := range failures {
		out[i] = digits.ReplaceAllString(f, "#")
	}
	return out
}

// WithRepeatNote returns failures, plus RepeatNote when they are what the
// previous attempt ended with (digits ignored, so a moved line number is not
// a new failure). Pure. A fixer told "this again" has a reason to look
// somewhere else; one told the same thing twice has none. previous is nil on
// the first attempt.
func WithRepeatNote(failures, previous []string) []string {
	if len(failures) > 0 && previous != nil && equal(shape(failures), shape(previous)) {
		return append(append([]string{}, failures...), RepeatNote)
	}
	return failures
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Verify runs everything deterministic that must hold before the quality
// gate is worth running. It returns (failures, examined): examined names what
// was actually checked, so a clean result cannot be mistaken for a check
// that never ran.
func Verify(c *QuestContract, repoRoot string) ([]string, []string) {
	var failures, examined []string
	hookRan := hookInstalled(repoRoot)
	hookFailure := RehearsePreCommit(repoRoot)
	if hookRan {
		examined = append(examined, "pre-commit hook")
	} else {
		examined = append(examined, "pre-commit hook (none installed)")
	}
	if hookFailure != "" {
		failures = append(failures, hookFailure)
	}
	if c == nil {
		examined = append(examined, "no ogsf contract declared — scope and checks not examined")
		return failures, examined
	}
	if len(c.Writes) > 0 {
		paths := ChangedPaths()
		stray := OutOfScope(paths, c.Writes)
		examined = append(examined, fmt.Sprintf("scope: %d changed path(s) against %d glob(s)", len(paths), len(c.Writes)))
		if len(stray) > 0 {
			if len(stray) > 40 {
				stray = stray[:40]
			}
			failures = append(failures, "scope: the match changed path(s) the spec's `writes` does not allow. Revert them "+
				"(`git checkout -- <path>`, or delete if new) — do not widen the scope:\n  "+strings.Join(stray, "\n  "))
		}
	} else {
		examined = append(examined, "scope: contract declares no `writes` — not examined")
	}
	for _, check := range c.Checks {
		code, output := Shell(check.Run, 600*time.Second)
		examined = append(examined, fmt.Sprintf("check `%s`: exit %d", check.Name, code))
		if code != 0 {
			failures = append(failures, CheckFailure(check.Name, code, check.Run, output, hookRan))
		}
	}
	return failures, examined
}

// Fnmatch is Python's fnmatch.fnmatch on POSIX: `*` matches anything,
// slashes included; `?` one character; `[seq]` and `[!seq]` classes; a `[`
// with no closing `]` is literal.
func Fnmatch(name, pattern string) bool {
	re, err := regexp.Compile(translate(pattern))
	if err != nil {
		return false
	}
	return re.MatchString(name)
}

// translate is fnmatch.translate, for RE2.
func translate(pat string) string {
	var res strings.Builder
	i, n := 0, len(pat)
	for i < n {
		c := pat[i]
		i++
		switch c {
		case '*':
			res.WriteString(".*")
			for i < n && pat[i] == '*' {
				i++
			}
		case '?':
			res.WriteString(".")
		case '[':
			j := i
			if j < n && pat[j] == '!' {
				j++
			}
			if j < n && pat[j] == ']' {
				j++
			}
			for j < n && pat[j] != ']' {
				j++
			}
			if j >= n {
				res.WriteString(`\[`)
				continue
			}
			stuff := pat[i:j]
			i = j + 1
			switch {
			case stuff == "":
				res.WriteString(`[^\x00-\x{10FFFF}]`) // an empty class never matches
			case stuff == "!":
				res.WriteString(".")
			default:
				stuff = strings.ReplaceAll(stuff, `\`, `\\`)
				if stuff[0] == '!' {
					stuff = "^" + stuff[1:]
				} else if stuff[0] == '^' || stuff[0] == '[' {
					stuff = `\` + stuff
				}
				res.WriteString("[" + stuff + "]")
			}
		default:
			res.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	return `(?s)^` + res.String() + `$`
}
