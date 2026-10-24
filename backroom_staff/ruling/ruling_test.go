package ruling

// Ported from legacy/adws/tests/test_verdict.py: the playmaker's plan stays
// on record even when another player tidies it away.

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// setup moves into an empty directory (artifact paths are repo-relative) with
// a match's torch pass holding the plan.
func setup(t *testing.T) (string, *reports.TalkReport) {
	t.Helper()
	t.Chdir(t.TempDir())
	torch := filepath.Join("match", "torch_pass")
	if err := os.MkdirAll(torch, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(torch, "plan.md"), []byte("# the plan\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	plan := &reports.TalkReport{Ruling: "implement"}
	plan.Status = reports.Touchdown
	plan.Artifacts = []string{filepath.Join(torch, "plan.md"), "specs/ab12_slug.md"}
	return torch, plan
}

func TestADeletedPlanCopyComesBackByteForByte(t *testing.T) {
	torch, plan := setup(t)
	if got := RestorePlanCopy(torch, plan); !reflect.DeepEqual(got, []string{"specs/ab12_slug.md"}) {
		t.Fatalf("restored %v", got)
	}
	if data, _ := os.ReadFile("specs/ab12_slug.md"); string(data) != "# the plan\n" {
		t.Fatalf("content %q", data)
	}
}

func TestACopyThatIsStillThereIsLeftAlone(t *testing.T) {
	torch, plan := setup(t)
	os.MkdirAll("specs", 0o755)
	os.WriteFile("specs/ab12_slug.md", []byte("edited by a human since\n"), 0o644)
	if got := RestorePlanCopy(torch, plan); len(got) != 0 {
		t.Fatalf("restored %v", got)
	}
	if data, _ := os.ReadFile("specs/ab12_slug.md"); string(data) != "edited by a human since\n" {
		t.Fatalf("content %q", data)
	}
}

func TestNothingIsInventedWhenTheSessionHoldsNoPlan(t *testing.T) {
	torch, plan := setup(t)
	os.Remove(filepath.Join(torch, "plan.md"))
	if got := RestorePlanCopy(torch, plan); len(got) != 0 {
		t.Fatalf("restored %v", got)
	}
	if _, err := os.Stat("specs/ab12_slug.md"); err == nil {
		t.Fatal("a plan was invented")
	}
}

func TestOnlyPathsUnderSpecsAreEverWritten(t *testing.T) {
	torch, _ := setup(t)
	plan := &reports.TalkReport{Ruling: "implement"}
	plan.Status = reports.Touchdown
	plan.Artifacts = []string{"components/x.tsx", "docs/notes.md"}
	if got := RestorePlanCopy(torch, plan); len(got) != 0 {
		t.Fatalf("restored %v", got)
	}
	for _, p := range []string{"components", "docs"} {
		if _, err := os.Stat(p); err == nil {
			t.Fatalf("%s was written", p)
		}
	}
}

func TestTheBuilderIsToldThePlanIsNotStray(t *testing.T) {
	// The harness allowing specs/ is no use if the player holding `rm` is
	// never told: it deleted the plan to "stay in scope".
	data, err := os.ReadFile(filepath.Join("..", "..", "templates", "set_pieces", "clubhouse", "team_talks", "builder", "system.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Never delete, move or edit a file you did not create", "`specs/` is always in scope"} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("the builder's prompt lacks %q", want)
		}
	}
}
