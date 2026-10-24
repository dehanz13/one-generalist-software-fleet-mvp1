package clubrules

// Ported from legacy/adws/tests/test_project.py: a club rule must reach the
// players, and a typo must not pick one. Legacy's tests read the original
// app's real config; these read testdata/club.config.yaml, which carries the same
// project block under the new names.

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/teamtalks"
)

const fixture = "testdata/club.config.yaml"

var templatesDir = filepath.Join("..", "..", "templates", "set_pieces", "clubhouse", "team_talks")

func config(t *testing.T, rules map[string]any) *boardroom.Config {
	t.Helper()
	cfg, err := boardroom.FromProject(map[string]any{"name": "example", "club_rules": rules})
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func text(t *testing.T, cfg *boardroom.Config) string {
	t.Helper()
	out, err := Text(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func load(t *testing.T, path string) *boardroom.Config {
	t.Helper()
	cfg, err := boardroom.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func must(t *testing.T, s string, wants ...string) {
	t.Helper()
	for _, w := range wants {
		if !strings.Contains(s, w) {
			t.Fatalf("missing %q", w)
		}
	}
}

func mustNot(t *testing.T, s string, refused ...string) {
	t.Helper()
	for _, r := range refused {
		if strings.Contains(s, r) {
			t.Fatalf("unexpected %q", r)
		}
	}
}

// ── what each value tells the players ───────────────────────────────────────

func TestManualTellsAgentsToKeepCleanupCalls(t *testing.T) {
	s := text(t, config(t, map[string]any{"rtl_cleanup": "manual"}))
	must(t, s, "rtl_cleanup: manual", "Keep every existing `cleanup()` call")
	mustNot(t, s, "remove the ones in files you touch")
}

func TestGlobalTellsAgentsTheOpposite(t *testing.T) {
	// The two values must not render the same advice: a rule whose values are
	// indistinguishable to the player is not a rule.
	s := text(t, config(t, map[string]any{"rtl_cleanup": "global"}))
	must(t, s, "rtl_cleanup: global", "remove the ones in files you touch")
	mustNot(t, s, "Keep every existing `cleanup()` call")
}

func TestAnUnsetOptionIsStillStated(t *testing.T) {
	// The default is a claim about the project too, and the player must see it.
	must(t, text(t, boardroom.Default()), "rtl_cleanup: manual")
}

func TestEveryAllowedValueHasAnInstruction(t *testing.T) {
	for rule, values := range AllowedValues {
		for _, v := range values {
			if _, ok := Instructions[rule][v]; !ok {
				t.Errorf("%s=%s has no instruction", rule, v)
			}
		}
	}
	var rules []string
	for rule := range Instructions {
		rules = append(rules, rule)
	}
	sort.Strings(rules)
	if strings.Join(rules, ",") != strings.Join(RuleOrder, ",") {
		t.Fatalf("instructions for %v, rendered in order %v", rules, RuleOrder)
	}
}

// ── the selection rule ──────────────────────────────────────────────────────

func TestTheOrderAndTheBanOnPositionReachTheAgent(t *testing.T) {
	s := text(t, config(t, map[string]any{"test_id_attribute": "data-hp", "test_id_import": "@/lib/testing/x"}))
	// In order, and by name: a player told only "prefer roles" once chose
	// `getAllByRole(...)[1]`.
	last := -1
	for _, step := range []string{"(1) its role", "(2) `within(...)`", "(3) the text", "(4) last, `getByTestId`"} {
		i := strings.Index(s, step)
		if i <= last {
			t.Fatalf("%q is out of order", step)
		}
		last = i
	}
	must(t, s, "NEVER select by position", "the `data-hp` attribute", "imports `@/lib/testing/x`")
}

func TestWithoutAnImportTheAgentIsNotToldToWriteOne(t *testing.T) {
	s := text(t, config(t, map[string]any{"test_id_attribute": "data-testid"}))
	must(t, s, "the `data-testid` attribute")
	mustNot(t, s, "first imports")
}

func TestTheDefaultStillStatesTheRule(t *testing.T) {
	// A project that set nothing still gets the order and the ban.
	must(t, text(t, boardroom.Default()), "NEVER select by position", "the `data-testid` attribute")
}

// ── notes ───────────────────────────────────────────────────────────────────

func TestEachNoteIsRenderedAndBlankOnesAreNot(t *testing.T) {
	s := text(t, config(t, map[string]any{"notes": []any{"Write exact text through exactText.", "   ", "Fix one file at a time."}}))
	must(t, s, "- Write exact text through exactText.", "- Fix one file at a time.")
	if n := strings.Count(s, "\n- "); n != 4 { // two rules + two notes
		t.Fatalf("%d entries, want 4", n)
	}
}

func TestThisRepoTellsAgentsAboutExactTextAndTheFixer(t *testing.T) {
	s := text(t, load(t, fixture))
	must(t, s, "...exactText(text)", "Parsing error", "the `data-hp` attribute",
		"imports `@/lib/testing/data-hp-is-the-test-id`")
}

// ── loading ─────────────────────────────────────────────────────────────────

func TestATypoInTheValueFailsTheLoad(t *testing.T) {
	if _, err := boardroom.FromProject(map[string]any{"club_rules": map[string]any{"rtl_cleanup": "globl"}}); err == nil {
		t.Fatal("a misspelt value loaded")
	}
}

func TestAnUnknownOptionFailsTheLoad(t *testing.T) {
	if _, err := boardroom.FromProject(map[string]any{"club_rules": map[string]any{"rtl_clenaup": "manual"}}); err == nil {
		t.Fatal("a misspelt rule loaded")
	}
}

func TestThisRepoDeclaresManual(t *testing.T) {
	cfg := load(t, fixture)
	if cfg.Project.Name != "example-web" || cfg.Project.ClubRules.RTLCleanup != "manual" {
		t.Fatalf("got %q / %q", cfg.Project.Name, cfg.Project.ClubRules.RTLCleanup)
	}
}

// ── the prompts carry it ────────────────────────────────────────────────────

func TestEveryAgentPromptCarriesThePlaceholder(t *testing.T) {
	// A rule rendered into a variable no template uses reaches nobody.
	cfg := load(t, fixture)
	if len(cfg.Players) < 4 {
		t.Fatalf("%d players", len(cfg.Players))
	}
	for _, p := range cfg.Players {
		data, err := os.ReadFile(p.TeamTalks.System)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), "{{club_rules}}") {
			t.Errorf("%s's system prompt has no {{club_rules}}", p.Name)
		}
	}
}

func TestTheRenderedPromptHoldsTheInstructionNotThePlaceholder(t *testing.T) {
	rendered, err := teamtalks.Render(filepath.Join(templatesDir, "builder", "system.md"),
		[]teamtalks.Var{{Name: "club_rules", Value: text(t, load(t, fixture))}})
	if err != nil {
		t.Fatal(err)
	}
	mustNot(t, rendered, "{{club_rules}}")
	must(t, rendered, "Testing Library cleanup is MANUAL")
}

func TestFlippingTheSettingChangesWhatTheBuilderReads(t *testing.T) {
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "club.config.yaml")
	if err := os.WriteFile(path, []byte(strings.Replace(string(data), "rtl_cleanup: manual", "rtl_cleanup: global", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	rendered, err := teamtalks.Render(filepath.Join(templatesDir, "builder", "system.md"),
		[]teamtalks.Var{{Name: "club_rules", Value: text(t, load(t, path))}})
	if err != nil {
		t.Fatal(err)
	}
	must(t, rendered, "Testing Library cleanup is GLOBAL")
}
