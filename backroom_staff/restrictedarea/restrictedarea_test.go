package restrictedarea

import (
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
)

func TestPatternsStopAtASlashUnlessTold(t *testing.T) {
	cases := []struct {
		path, pattern string
		want          bool
	}{
		{"set_pieces/boardroom/club.config.yaml", "set_pieces/boardroom/", true},
		{"set_pieces/boardroomx/a", "set_pieces/boardroom/", false},
		{"specs/a.md", "specs/*", true},
		{"specs/deep/a.md", "specs/*", false}, // `*` does not cross `/`
		{"docs/deep/a.md", "**/*.md", true},
		{"README.md", "*.md", true},
		{"README.md", "README.md", true},
	}
	for _, c := range cases {
		if got := Matches(c.path, c.pattern); got != c.want {
			t.Errorf("Matches(%q, %q) = %v", c.path, c.pattern, got)
		}
	}
}

func TestPermittedChecksRuntimeThenOwnListThenRestricted(t *testing.T) {
	cfg := boardroom.Default()
	readOnly := &boardroom.Player{Name: "ranger", Writes: []string{}}
	open := &boardroom.Player{Name: "builder"}
	named := &boardroom.Player{Name: "keeper", Writes: []string{"set_pieces/boardroom/"}}
	if !Permitted("set_pieces/clubhouse/matches/x/torch_pass/a.md", readOnly, cfg) {
		t.Error("the match runtime must always be writable")
	}
	if Permitted("src/a.ts", readOnly, cfg) {
		t.Error("a read-only player wrote to the repo")
	}
	if !Permitted("src/a.ts", open, cfg) || Permitted("set_pieces/boardroom/club.config.yaml", open, cfg) {
		t.Error("an unrestricted player must still stay out of the restricted area")
	}
	if !Permitted("set_pieces/boardroom/club.config.yaml", named, cfg) {
		t.Error("naming a restricted path is what unlocks it")
	}
}

func runGit(t *testing.T, args ...string) {
	t.Helper()
	if out, err := exec.Command("git", args...).CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestEnforceRollsBackOnlyWhatThePlayerIntroduced(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	runGit(t, "init", "-q")
	runGit(t, "config", "user.email", "t@example.invalid")
	runGit(t, "config", "user.name", "t")
	os.WriteFile("tracked.txt", []byte("one\n"), 0o644)
	os.WriteFile("dirty.txt", []byte("one\n"), 0o644)
	runGit(t, "add", "-A")
	runGit(t, "commit", "-q", "-m", "base")
	os.WriteFile("dirty.txt", []byte("the founder's own edit\n"), 0o644)

	before := Snapshot(root)
	// The player edits a tracked file, creates one, and touches the
	// founder's dirty file again.
	os.WriteFile("tracked.txt", []byte("changed\n"), 0o644)
	os.WriteFile("new.txt", []byte("new\n"), 0o644)
	os.WriteFile("dirty.txt", []byte("the founder's own edit\nand the player's\n"), 0o644)

	player := &boardroom.Player{Name: "ranger", Writes: []string{}}
	_, err := Enforce(root, player, boardroom.Default(), before)
	if err == nil {
		t.Fatal("no breach")
	}
	for _, want := range []string{"ranger is read-only but modified 3 path(s)", "tracked.txt — rolled back",
		"new.txt — deleted", "dirty.txt — left as-is (was already modified)"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("missing %q in %v", want, err)
		}
	}
	if data, _ := os.ReadFile("tracked.txt"); string(data) != "one\n" {
		t.Error("the tracked file was not rolled back")
	}
	if _, err := os.Stat("new.txt"); err == nil {
		t.Error("the new file was not deleted")
	}
	if data, _ := os.ReadFile("dirty.txt"); !strings.Contains(string(data), "founder's own edit") {
		t.Error("the founder's uncommitted work was touched")
	}
}
