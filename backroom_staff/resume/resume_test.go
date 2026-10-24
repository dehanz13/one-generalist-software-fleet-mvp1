package resume

// Ported from legacy/adws/tests/test_resume.py: a failed match id should
// reverify existing work instead of buying another build.

import (
	"os"
	"path/filepath"
	"testing"
)

func feed(t *testing.T, root, id, lines string) {
	t.Helper()
	dir := filepath.Join(root, "matches", id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "match_feed.jsonl"), []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestNewIDStartsNormalWork(t *testing.T) {
	root := t.TempDir()
	if ShouldReverify(root, "new-id") || ShouldReverify(root, "") {
		t.Fatal("a new or missing id asked for re-verification")
	}
}

func TestFailedExistingIDReverifies(t *testing.T) {
	root := t.TempDir()
	feed(t, root, "failed-id", `{"type": "error", "name": "not_accepted"}`+"\n")
	if !ShouldReverify(root, "failed-id") {
		t.Fatal("a failed match did not reverify")
	}
}

func TestExistingButUnfailedIDDoesNotSkipBuilder(t *testing.T) {
	root := t.TempDir()
	feed(t, root, "open-id", `{"type": "objective_end", "name": "build"}`+"\n")
	if ShouldReverify(root, "open-id") {
		t.Fatal("an unfailed match skipped the builder")
	}
}

// Beyond legacy: the defect REA.md records. A later touchdown clears an
// earlier failure.
func TestALaterTouchdownClearsAnEarlierFailure(t *testing.T) {
	root := t.TempDir()
	feed(t, root, "mended",
		`{"type": "error", "name": "not_accepted"}`+"\n"+
			`{"type": "log", "name": "console", "payload": {"message": "match mended touchdown · 1/1 objectives"}}`+"\n")
	if ShouldReverify(root, "mended") {
		t.Fatal("a match that later passed still asked for re-verification")
	}
}
