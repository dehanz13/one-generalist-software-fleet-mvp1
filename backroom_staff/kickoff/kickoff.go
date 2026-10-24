// Package kickoff is the kickoff checklist: refuse a match before it spends
// a single token. (Legacy: adw_modules/preflight.py.)
//
// Every check here was once a line in a checklist a human had to remember. A
// shell-history replay once dispatched quest #4's spec from quest #7's branch,
// and four objectives (430k tokens) ran before `git add -A` found an empty
// tree; the playmaker knew in 26 seconds, and nothing upstream of it asked.
//
// Checks run against the RAW prompt argument, before it is resolved into the
// file's contents: once that happens the path is gone. Quest rules (spec ↔
// branch, committed, not already merged, contract) apply only when the prompt
// is a file under a `specs/*-quests/` directory; an inline prompt gets the
// repo-hygiene checks alone.
package kickoff

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/contract"
)

// ProtectedBranches are base branches a plan commit must never land on.
var ProtectedBranches = []string{"main", "develop"}

// ProtectedPrefixes are branch prefixes treated the same way.
var ProtectedPrefixes = []string{"release/"}

// Check is one checklist item.
type Check struct {
	Name   string
	Passed bool
	Detail string
}

func git(args ...string) (int, string) {
	cmd := exec.Command("git", args...)
	out, err := cmd.Output()
	code := 0
	if err != nil {
		code = 1
		if cmd.ProcessState != nil {
			code = cmd.ProcessState.ExitCode()
		}
	}
	return code, strings.TrimSpace(string(out))
}

// QuestSpec returns the spec file when the prompt is a quest spec, else "".
func QuestSpec(promptArg string) string {
	info, err := os.Stat(promptArg)
	if err != nil || info.IsDir() {
		return ""
	}
	parent := filepath.Base(filepath.Dir(promptArg))
	inSpecs := false
	for _, part := range strings.Split(filepath.ToSlash(promptArg), "/") {
		if part == "specs" {
			inSpecs = true
		}
	}
	if strings.HasSuffix(parent, "-quests") && inSpecs {
		return promptArg
	}
	return ""
}

func stem(path string) string {
	base := filepath.Base(path)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

// TreeClean: nothing stray would ride along in `git add -A`.
func TreeClean() Check {
	_, out := git("status", "--porcelain")
	var stray []string
	for _, line := range strings.Split(out, "\n") {
		if len(line) > 3 {
			stray = append(stray, line[3:])
		}
	}
	if len(stray) == 0 {
		return Check{"working tree clean", true, "clean"}
	}
	shown := stray
	if len(shown) > 5 {
		shown = shown[:5]
	}
	return Check{"working tree clean", false, fmt.Sprintf("%d stray path(s) would ride along in `git add -A`: %s",
		len(stray), strings.Join(shown, ", "))}
}

// OffBaseBranch: the plan commit must not land on a base branch.
func OffBaseBranch(branch string) Check {
	protected := false
	for _, b := range ProtectedBranches {
		if branch == b {
			protected = true
		}
	}
	for _, p := range ProtectedPrefixes {
		if strings.HasPrefix(branch, p) {
			protected = true
		}
	}
	if !protected {
		return Check{"on a feature branch", true, branch}
	}
	return Check{"on a feature branch", false, fmt.Sprintf("`%s` is a base branch — the plan commit would land on it. "+
		"Cut feature/<quest> first.", branch)}
}

// SpecMatchesBranch: a quest's spec runs from feature/<spec stem>.
func SpecMatchesBranch(spec, branch string) Check {
	expected := "feature/" + stem(spec)
	if branch == expected {
		return Check{"spec matches branch", true, fmt.Sprintf("%s <-> %s", filepath.Base(spec), branch)}
	}
	return Check{"spec matches branch", false, fmt.Sprintf("spec `%s` belongs on `%s`, but HEAD is `%s`. "+
		"Wrong spec (shell-history replay?) or wrong branch.", spec, expected, branch)}
}

// SpecCommitted: the spec is tracked and unmodified.
func SpecCommitted(spec string) Check {
	tracked, _ := git("ls-files", "--error-unmatch", spec)
	_, dirty := git("status", "--porcelain", "--", spec)
	switch {
	case tracked == 0 && dirty == "":
		return Check{"spec committed", true, "tracked and unmodified"}
	case tracked != 0:
		return Check{"spec committed", false, "untracked"}
	}
	return Check{"spec committed", false, "has uncommitted edits"}
}

// QuestNotMerged: a merged PR from this quest's branch means the quest
// already landed. Network-dependent, so it degrades to a pass-with-note
// rather than blocking an offline founder; the other checks still hold.
func QuestNotMerged(spec string) Check {
	head := "feature/" + stem(spec)
	if _, err := exec.LookPath("gh"); err != nil {
		return Check{"quest not already merged", true, "skipped — gh not installed"}
	}
	cmd := exec.Command("gh", "pr", "list", "--head", head, "--state", "merged",
		"--json", "number,mergedAt", "--limit", "1")
	done := make(chan struct{})
	var out []byte
	var err error
	go func() { out, err = cmd.Output(); close(done) }()
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		if cmd.Process != nil {
			cmd.Process.Kill()
		}
		return Check{"quest not already merged", true, "skipped — gh timed out"}
	}
	if err != nil {
		msg := err.Error()
		if exit, ok := err.(*exec.ExitError); ok {
			msg = strings.TrimSpace(string(exit.Stderr))
		}
		if len(msg) > 120 {
			msg = msg[:120]
		}
		return Check{"quest not already merged", true, "skipped — gh failed: " + msg}
	}
	var merged []struct {
		Number   int    `json:"number"`
		MergedAt string `json:"mergedAt"`
	}
	_ = json.Unmarshal(out, &merged)
	if len(merged) == 0 {
		return Check{"quest not already merged", true, "no merged PR from this branch"}
	}
	date := merged[0].MergedAt
	if len(date) > 10 {
		date = date[:10]
	}
	return Check{"quest not already merged", false, fmt.Sprintf("PR #%d from `%s` merged %s — this quest already landed.",
		merged[0].Number, head, date)}
}

// ContractChecks: the difficulty and work-remaining, from the spec's own block.
func ContractChecks(spec, setPiece string, resuming bool) []Check {
	text, err := os.ReadFile(spec)
	var declared *contract.QuestContract
	if err == nil {
		declared, err = contract.Parse(string(text))
	}
	if err != nil {
		return []Check{{"ogsf contract readable", false, fmt.Sprintf("%T: %v", err, err)}}
	}
	if declared == nil {
		// Not a failure: older specs have no block. But say what went unchecked.
		return []Check{{"ogsf contract", true, "none declared — difficulty, work-remaining, scope and checks NOT examined"}}
	}
	var checks []Check
	if declared.Difficulty != "" {
		detail := fmt.Sprintf("spec declares `%s`, launching `%s`", declared.Difficulty, setPiece)
		if declared.Difficulty != setPiece {
			detail += fmt.Sprintf(" — run `ogsf %s %s` instead", declared.Difficulty, spec)
		}
		checks = append(checks, Check{"difficulty matches", declared.Difficulty == setPiece, detail})
	}
	switch {
	case declared.Precondition != "" && !resuming:
		code, output := contract.Shell(declared.Precondition, 300*time.Second)
		lines := strings.Split(output, "\n")
		last := lines[len(lines)-1]
		if output == "" {
			last = "(no output)"
		}
		if len([]rune(last)) > 160 {
			last = string([]rune(last)[:160])
		}
		if code == 0 {
			checks = append(checks, Check{"work remains", true, fmt.Sprintf("precondition exit %d: %s", code, last)})
		} else {
			checks = append(checks, Check{"work remains", false, fmt.Sprintf("precondition exit %d — the spec's own probe "+
				"found nothing left to do, or could not run: %s", code, last)})
		}
	case declared.Precondition == "":
		checks = append(checks, Check{"work remains", true, "no precondition declared — NOT examined"})
	}
	return checks
}

// Run returns every applicable check, in the order a founder would read them.
func Run(promptArg string, resuming bool, setPiece string) []Check {
	_, branch := git("rev-parse", "--abbrev-ref", "HEAD")
	var checks []Check
	// A resumed match left its tree dirty on purpose: that IS the work to reverify.
	if !resuming {
		checks = append(checks, TreeClean())
	}
	checks = append(checks, OffBaseBranch(branch))
	if spec := QuestSpec(promptArg); spec != "" {
		checks = append(checks, SpecMatchesBranch(spec, branch), SpecCommitted(spec))
		if !resuming {
			checks = append(checks, QuestNotMerged(spec))
		}
		// Cheap checks first: the precondition may take a minute, and there
		// is no point measuring the work on the wrong branch.
		all := true
		for _, c := range checks {
			all = all && c.Passed
		}
		if all {
			checks = append(checks, ContractChecks(spec, setPiece, resuming)...)
		}
	}
	return checks
}

// ExitCode is a refused dispatch: distinct from a match's own failure.
const ExitCode = 2

// Enforce prints the verdict and returns false (the caller exits 2) on any miss.
func Enforce(out io.Writer, promptArg string, resuming bool, setPiece string) bool {
	checks := Run(promptArg, resuming, setPiece)
	failed := 0
	for _, c := range checks {
		mark := "✓"
		if !c.Passed {
			mark = "✗"
			failed++
		}
		fmt.Fprintf(out, "  %s kickoff checklist · %s: %s\n", mark, c.Name, c.Detail)
	}
	if failed > 0 {
		fmt.Fprintf(out, "\nthe kickoff checklist refused the dispatch (%d check(s)). "+
			"Nothing ran, no tokens spent. Pass --skip-kickoff only if you "+
			"know why each check is wrong.\n", failed)
		return false
	}
	return true
}
