package gitops

// Ported from legacy/adws/tests/test_git_uncommit.py: a player's own commit
// is undone before the contract looks at the tree.

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func run(t *testing.T, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// repo makes a repository with one commit in a temp dir and moves into it.
func repo(t *testing.T) string {
	t.Helper()
	t.Chdir(t.TempDir())
	run(t, "init", "-q")
	run(t, "config", "user.email", "t@example.invalid")
	run(t, "config", "user.name", "t")
	run(t, "config", "commit.gpgsign", "false")
	if err := os.WriteFile("a.txt", []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run(t, "add", "-A")
	run(t, "commit", "-q", "-m", "base")
	return run(t, "rev-parse", "HEAD")
}

func TestNothingToUndoWhenHeadIsTheBase(t *testing.T) {
	base := repo(t)
	undone, err := UncommitTo(base)
	if err != nil || len(undone) != 0 {
		t.Fatalf("got %v, %v", undone, err)
	}
	if run(t, "rev-parse", "HEAD") != base {
		t.Fatal("HEAD moved")
	}
}

func TestAnAgentsCommitIsUndoneAndItsChangesKept(t *testing.T) {
	base := repo(t)
	os.WriteFile("a.txt", []byte("two\n"), 0o644)
	os.WriteFile("b.txt", []byte("new\n"), 0o644)
	run(t, "add", "-A")
	run(t, "commit", "-q", "-m", "the builder's own commit")
	made := run(t, "rev-parse", "--short", "HEAD")
	undone, err := UncommitTo(base)
	if err != nil || len(undone) != 1 || undone[0] != made {
		t.Fatalf("got %v, %v; want [%s]", undone, err, made)
	}
	if run(t, "rev-parse", "HEAD") != base {
		t.Fatal("HEAD is not the base")
	}
	// With the commit in place, the contract's `git show HEAD:file` was the
	// builder's own file. Now it is the base's.
	if got := run(t, "show", "HEAD:a.txt"); got != "one" {
		t.Fatalf("HEAD:a.txt = %q", got)
	}
	if data, _ := os.ReadFile("a.txt"); string(data) != "two\n" {
		t.Fatalf("working copy lost the change: %q", data)
	}
	if !strings.Contains(run(t, "status", "--porcelain"), "b.txt") {
		t.Fatal("b.txt is not in the change set")
	}
}

func TestTwoCommitsAreBothUndone(t *testing.T) {
	base := repo(t)
	for _, n := range []string{"x", "y"} {
		os.WriteFile(n+".txt", []byte(n), 0o644)
		run(t, "add", "-A")
		run(t, "commit", "-q", "-m", n)
	}
	undone, err := UncommitTo(base)
	if err != nil || len(undone) != 2 {
		t.Fatalf("got %v, %v", undone, err)
	}
	if run(t, "rev-parse", "HEAD") != base {
		t.Fatal("HEAD is not the base")
	}
}

func TestABranchThatWasMovedElsewhereIsLeftAlone(t *testing.T) {
	base := repo(t)
	run(t, "checkout", "-q", "--orphan", "other")
	os.WriteFile("c.txt", []byte("c"), 0o644)
	run(t, "add", "-A")
	run(t, "commit", "-q", "-m", "unrelated")
	head := run(t, "rev-parse", "HEAD")
	undone, err := UncommitTo(base)
	if err != nil || len(undone) != 0 {
		t.Fatalf("got %v, %v", undone, err)
	}
	if run(t, "rev-parse", "HEAD") != head {
		t.Fatal("HEAD moved")
	}
}
