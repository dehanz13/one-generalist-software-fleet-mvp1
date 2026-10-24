package boardroom

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const roster = `
defaults:
  model: anthropic/claude-sonnet-5-5
  thinking: medium
  tools: [read, bash]
players:
  - name: unrestricted
    team_talks: {system: s.md, user: u.md}
  - name: readonly
    writes: []
    team_talks: {system: s.md, user: u.md}
  - name: limited
    writes: [specs/]
    tools: [read]
    thinking: high
    team_talks: {system: s.md, user: u.md}
`

// The difference between no `writes` and `writes: []` is the difference
// between unrestricted and read-only. It must survive the defaults merge.
func TestWritesNilAndEmptyStayDistinct(t *testing.T) {
	cfg, err := Parse([]byte(roster))
	if err != nil {
		t.Fatal(err)
	}
	un, _ := cfg.Resolve("unrestricted")
	ro, _ := cfg.Resolve("readonly")
	li, _ := cfg.Resolve("limited")
	if un.Writes != nil {
		t.Fatalf("no writes key became %#v", un.Writes)
	}
	if ro.Writes == nil || len(ro.Writes) != 0 {
		t.Fatalf("writes: [] became %#v", ro.Writes)
	}
	if len(li.Writes) != 1 || li.Writes[0] != "specs/" {
		t.Fatalf("writes: [specs/] became %#v", li.Writes)
	}
}

func TestDefaultsFillOnlyWhatAPlayerLeftOut(t *testing.T) {
	cfg, err := Parse([]byte(roster))
	if err != nil {
		t.Fatal(err)
	}
	un, _ := cfg.Resolve("unrestricted")
	li, _ := cfg.Resolve("limited")
	if un.Thinking != "medium" || strings.Join(un.Tools, ",") != "read,bash" {
		t.Fatalf("defaults not applied: %+v", un)
	}
	if li.Thinking != "high" || strings.Join(li.Tools, ",") != "read" {
		t.Fatalf("a player's own value was overwritten: %+v", li)
	}
	if un.Club != "pi" || un.Enchantments == nil {
		t.Fatalf("built-in defaults missing: %+v", un)
	}
}

func TestAnUnknownClubFailsTheLoad(t *testing.T) {
	if _, err := Parse([]byte("players:\n  - name: x\n    club: copilot\n")); err == nil {
		t.Fatal("an unknown club loaded")
	}
}

func TestAQACheckMustNameAKnownOperation(t *testing.T) {
	bad := "qa:\n  checks:\n    - {name: x, area: frontend, operation: deploy, argv: [true]}\n"
	if _, err := Parse([]byte(bad)); err == nil {
		t.Fatal("an unknown qa operation loaded")
	}
}

func TestValidateNamesEveryProblemAtOnce(t *testing.T) {
	dir := t.TempDir()
	system := filepath.Join(dir, "s.md")
	os.WriteFile(system, []byte("x"), 0o644)
	cfg, _ := Parse([]byte(roster))
	err := Validate(cfg, []string{"missing", "readonly"}, func(club, model string) error { return nil })
	if err == nil {
		t.Fatal("validation passed")
	}
	for _, want := range []string{`player "missing" is not defined`, "system team talk not found", "user team talk not found"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("missing %q in %v", want, err)
		}
	}
}

func TestTheShippedTemplateLoads(t *testing.T) {
	cfg, err := Load(filepath.Join("..", "..", "templates", "set_pieces", "boardroom", "club.config.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Players) != 5 || len(cfg.QA.Checks) != 4 {
		t.Fatalf("%d players, %d checks", len(cfg.Players), len(cfg.QA.Checks))
	}
	ranger, _ := cfg.Resolve("ranger")
	if ranger.Writes == nil || len(ranger.Writes) != 0 {
		t.Fatal("the ranger must be read-only")
	}
	builder, _ := cfg.Resolve("builder")
	if builder.Writes != nil {
		t.Fatal("the builder must be unrestricted")
	}
	if cfg.Scheduler.AcceptRemote || cfg.Upcoming.Sources[0].Path != "set_pieces/upcoming/*.md" {
		t.Fatal("a new install reads markdown tickets and accepts no requests until the founder says so")
	}
}

func TestUpcomingAndSchedulerSettingsAreChecked(t *testing.T) {
	_, err := Parse([]byte(`upcoming:
  sources: [{kind: jira, path: x}, {kind: markdown}]
  default_time: "9am"
  timezone: Mars/Olympus
scheduler:
  poll_seconds: 1
`))
	if err == nil {
		t.Fatal("bad settings loaded")
	}
	for _, want := range []string{`"jira": kind is not markdown or linear`, "path is empty", `"9am" is not HH:MM`,
		"upcoming.timezone", "poll_seconds: at least 5"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("missing %q in %v", want, err)
		}
	}
	cfg, err := Parse([]byte("scheduler:\n  accept_remote: true\n"))
	if err != nil || !cfg.Scheduler.AcceptRemote || cfg.Scheduler.PollSeconds != 30 || cfg.Upcoming.DefaultTime != "09:00" {
		t.Fatalf("a partial section keeps the other defaults: %+v %v", cfg, err)
	}
}
