package spectools

// The spec generator's scope: what a path names, for Git and for the
// contract's `writes`. Ported one for one from legacy
// adws/tests/test_area_spec.py (15 tests); see wiki/TEST-MIGRATION.md.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestADirectoryNamesEveryTestFileUnderIt(t *testing.T) {
	want := []string{"components/home/*.test.ts", "components/home/*.test.tsx"}
	if got := Pathspecs([]string{"components/home/"}); !reflect.DeepEqual(got, want) {
		t.Fatalf("Pathspecs = %q, want %q", got, want)
	}
	if got := WriteGlobs([]string{"components/home"}); !reflect.DeepEqual(got, want) {
		t.Fatalf("WriteGlobs = %q, want %q", got, want)
	}
}

func TestATestFileNamesItselfLiterally(t *testing.T) {
	path := "app/r/[code]/page.test.tsx"
	if got := Pathspecs([]string{path}); !reflect.DeepEqual(got, []string{":(literal)" + path}) {
		t.Fatalf("Pathspecs = %q", got)
	}
}

func TestABracketedFileIsWritableAndItsLookalikeIsNot(t *testing.T) {
	// `[code]` is a character class to fnmatch: unescaped, the pattern would
	// allow app/r/c/page.test.tsx and refuse the file the quest is about.
	path := "app/r/[code]/page.test.tsx"
	globs := WriteGlobs([]string{path})
	if len(globs) != 1 {
		t.Fatalf("want one glob, got %q", globs)
	}
	pattern := globs[0]
	if !Fnmatch(path, pattern) {
		t.Errorf("%q does not match its own glob %q", path, pattern)
	}
	if Fnmatch("app/r/c/page.test.tsx", pattern) {
		t.Errorf("the lookalike matches %q", pattern)
	}
	if Fnmatch(path, path) {
		t.Errorf("the premise: the bare path does not match itself")
	}
}

func TestAFileInARouteGroupIsWritable(t *testing.T) {
	path := "app/(platform)/(gated)/home/round/page.test.tsx"
	globs := WriteGlobs([]string{path})
	if len(globs) != 1 || !Fnmatch(path, globs[0]) {
		t.Fatalf("%q is not writable under %q", path, globs)
	}
}

func TestANamedFileDoesNotAdmitItsNeighbours(t *testing.T) {
	globs := WriteGlobs([]string{"lib/pond/pond-engine.test.ts"})
	if len(globs) != 1 {
		t.Fatalf("want one glob, got %q", globs)
	}
	for _, neighbour := range []string{"lib/pond/pond-dock-yield.test.ts", "lib/pond/pond-engine.ts"} {
		if Fnmatch(neighbour, globs[0]) {
			t.Errorf("%q is admitted by %q", neighbour, globs[0])
		}
	}
}

func TestOnlyTestFilesCountAsFiles(t *testing.T) {
	for path, want := range map[string]bool{
		"lib/blog/render.test.ts": true, "app/not-found.test.tsx": true,
		"lib/blog": false, "lib/blog/render.ts": false,
	} {
		if got := IsTestFile(path); got != want {
			t.Errorf("IsTestFile(%q) = %v, want %v", path, got, want)
		}
	}
}

// legacyContract is legacy's _contract(): one jsdom file with one finding.
func legacyContract() string {
	rows := []AreaRow{{File: "components/x/A.test.tsx", Env: "jsdom", Sites: []Site{{1, "no-node-access", "x"}}}}
	return Contract("x", []string{"components/x"}, rows)
}

// legacySpec is legacy's _spec(): the same group, rendered whole.
func legacySpec() string {
	rule := CounterOf(KV{"testing-library/no-node-access", 1})
	rows := []AreaRow{{File: "components/x/A.test.tsx", Env: "jsdom", Errors: 1, Rules: rule, Left: rule,
		Sites: []Site{{1, "no-node-access", "x"}}, Expects: 1, Cases: 1, Cleanup: 1}}
	return Render("x", "slice 9, group 0", []string{"components/x"}, rows, [2]string{"1 file, 1 test", "none"})
}

func mustContain(t *testing.T, text string, parts ...string) {
	t.Helper()
	for _, part := range parts {
		if !strings.Contains(text, part) {
			t.Errorf("missing %q", part)
		}
	}
}

func mustNotContain(t *testing.T, text string, parts ...string) {
	t.Helper()
	for _, part := range parts {
		if strings.Contains(text, part) {
			t.Errorf("unexpected %q", part)
		}
	}
}

func TestTheContractDoesNotCapSuppressions(t *testing.T) {
	// A cap of three made the second group's playmaker budget for three and
	// weaken four tests to stay under it (match fe8b82a0).
	text := legacyContract()
	mustNotContain(t, text, "at most")
	mustContain(t, text, "every lint suppression added carries its reason", `test "$bare" -eq 0`)
}

func TestTheContractRefusesAMarkupSearch(t *testing.T) {
	text := legacyContract()
	mustContain(t, text, "no element lookup became a search of the markup")
	mustContain(t, text, "innerHTML", "outerHTML", "toContainHTML", "selector:")
}

func TestTheSpecSaysToKeepTheSubject(t *testing.T) {
	// The third group passed every check and came back with five tests
	// reading a different element than before (match eac9e0eb).
	text := legacySpec()
	mustContain(t, text, "Change the matcher, keep the subject")
	mustContain(t, text, "the same element", "the same direction", "the same area", "the same property")
	mustContain(t, text, "about the same element", "now reads a different element")
}

func TestTheSpecSaysWhatARoleQueryCannotSeeAndHowStrictAMatcherIs(t *testing.T) {
	// The fifth group kept its subjects and still lost four assertions: a role
	// query that skips hidden options, and two matchers looser than what they
	// replaced (match b36fabde).
	text := legacySpec()
	mustContain(t, text, "everything the original could see", "hidden: true",
		"at least as strict as the comparison it replaces", "{ exact: true }",
		"`fireEvent` already runs inside `act`")
}

func TestTheContractRefusesTheDisguisesTheSixthGroupFound(t *testing.T) {
	// A tag selector and a function matcher got past the first pattern, and an
	// empty camel-case style assertion passes whatever the style is (249f6c5b).
	text := legacyContract()
	// A quoted value only: `function first(root, selector: string)` is a
	// parameter, and matched the first widened pattern on three open branches.
	mustContain(t, text, "selector:[[:space:]]*[")
	mustNotContain(t, text, "selector:[[:space:]]*[^[:space:]]")
	mustContain(t, text, "By(Text|LabelText|Title|AltText)", "toHaveStyle")
	mustContain(t, text, `selector: "time"`, "el?.tagName", `clipPath: ""`)
}

func TestTheSpecSaysWhereASuppressionSitsAndWhichHelpersNeedNone(t *testing.T) {
	text := legacySpec()
	mustContain(t, text, "`function` declaration", "after formatting", "cannot fail", "anywhere inside")
}

func TestTheContractCountsOccurrencesAndFollowsAStoredResult(t *testing.T) {
	// The merge-gate reviewer on #688: the removal check counted matching
	// lines, so one of two `expect(` on a line could go; and a position taken
	// from a stored `getAllBy…` result was not seen.
	text := legacyContract()
	mustContain(t, text, `grep -oE "$what"`)
	mustNotContain(t, text, "grep -cE")
	mustContain(t, text, "(^|[[:space:];{}])(it|test)", "held()", "indexed()", "expect(rows[1])")
}

func TestTheContractRefusesAMatcherHandedToToHaveStyle(t *testing.T) {
	// Match 526ebf58: `toHaveStyle({ clipPath: expect.stringMatching(…) })`
	// passed with no clip-path at all.
	text := legacyContract()
	mustContain(t, text, "[[:space:]]*expect", "a matcher passed to toHaveStyle as a value")
	mustContain(t, legacySpec(), "A matcher as the value is the same trap")
}

func TestTheSpecSaysAComparisonOfTwoLookupsNeedsOneToExist(t *testing.T) {
	// Match 84e783fb: a helper ending `?? null` made null equal null.
	text := legacySpec()
	mustContain(t, text, "A comparison of two lookups asserts that the first one exists", "?? null")
}

// ── the port against the Python original ────────────────────────────────────

// vocabularySubstitutions turns legacy's generated text into the fleet's: the
// Go output must equal the Python output with these applied, in order. The
// same list drives testdata/extract_templates.py (testdata/substitutions.json;
// TestSubstitutionListMatchesTheExtractor keeps the two equal).
var vocabularySubstitutions = [][2]string{
	{"lane: sdlc-strict", "difficulty: run-mythic"},
	{"just sdlc-strict ", "ogsf run-mythic "},
	{"specs/beta-18-slices/", "specs/beta-18-quests/"},
	{"# Slice: ", "# Quest: "},
	{"**Factory slice (ADW).**", "**Fleet quest (set piece).**"},
	{"**Pre-flight reading (REQUIRED):**", "**Kickoff reading (REQUIRED):**"},
	{"## Why this slice exists", "## Why this quest exists"},
	{"each slice leaves", "each quest leaves"},
	{"this slice does it", "this quest does it"},
	{"Before the slice:", "Before the quest:"},
	{"another slice's.", "another quest's."},
	{"**This slice changes types only.**", "**This quest changes types only.**"},
	{"when its file's slice comes", "when its file's quest comes"},
	{"are not in this slice", "are not in this quest"},
	{"every helper outside the slice", "every helper outside the quest"},
	{"the last gate red", "the last official review red"},
	{"(the gate compares error identities)", "(the official review compares error identities)"},
	{"(sessions ", "(matches "},
	{"(session\n", "(match\n"},
	{"session ", "match "},
	{"your Report", "your match report"},
	{"every Report you", "every match report you"},
	{"the last Report", "the last match report"},
}

func substitute(text string) string {
	for _, s := range vocabularySubstitutions {
		text = strings.ReplaceAll(text, s[0], s[1])
	}
	return text
}

func TestSubstitutionListMatchesTheExtractor(t *testing.T) {
	data, err := os.ReadFile("testdata/substitutions.json")
	if err != nil {
		t.Fatal(err)
	}
	var fromFile [][2]string
	if err := json.Unmarshal(data, &fromFile); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(fromFile, vocabularySubstitutions) {
		t.Fatalf("testdata/substitutions.json and vocabularySubstitutions differ:\nfile: %q\ngo:   %q", fromFile, vocabularySubstitutions)
	}
}

// diffText describes where two texts first differ, with a little context.
func diffText(want, got string) string {
	w, g := strings.Split(want, "\n"), strings.Split(got, "\n")
	for i := 0; i < len(w) || i < len(g); i++ {
		var wl, gl string
		if i < len(w) {
			wl = w[i]
		}
		if i < len(g) {
			gl = g[i]
		}
		if wl != gl || i >= len(w) || i >= len(g) {
			var b strings.Builder
			b.WriteString("first difference at line " + strconv.Itoa(i+1) + " (python+substitutions vs go):\n")
			for j := max(0, i-2); j < min(len(w), i+3); j++ {
				b.WriteString("  python | " + w[j] + "\n")
			}
			for j := max(0, i-2); j < min(len(g), i+3); j++ {
				b.WriteString("  go     | " + g[j] + "\n")
			}
			return b.String()
		}
	}
	return "texts are equal"
}

func assertGolden(t *testing.T, goldenPath, got string) {
	t.Helper()
	data, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	want := substitute(string(data))
	if got != want {
		t.Fatalf("%s: Go output differs from the Python original.\n%s", goldenPath, diffText(want, got))
	}
}

type areaCase struct {
	Case     string    `json:"case"`
	Name     string    `json:"name"`
	Label    string    `json:"label"`
	Prefixes []string  `json:"prefixes"`
	Tests    [2]string `json:"tests"`
	Rows     []rawRow  `json:"rows"`
}

type rawRow struct {
	File    string   `json:"file"`
	Env     string   `json:"env"`
	Errors  int      `json:"errors"`
	Rules   [][2]any `json:"rules"`
	Left    [][2]any `json:"left"`
	Broken  string   `json:"broken"`
	Sites   [][3]any `json:"sites"`
	Exact   int      `json:"exact"`
	Hooks   int      `json:"hooks"`
	Expects int      `json:"expects"`
	Cases   int      `json:"cases"`
	Cleanup int      `json:"cleanup"`
}

func counterFromPairs(pairs [][2]any) *Counter {
	c := NewCounter()
	for _, p := range pairs {
		c.Add(p[0].(string), int(p[1].(float64)))
	}
	return c
}

func loadAreaCases(t *testing.T) []areaCase {
	t.Helper()
	data, err := os.ReadFile("testdata/area_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []areaCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	return cases
}

func (c areaCase) rows() []AreaRow {
	var rows []AreaRow
	for _, r := range c.Rows {
		row := AreaRow{File: r.File, Env: r.Env, Errors: r.Errors, Rules: counterFromPairs(r.Rules),
			Left: counterFromPairs(r.Left), Broken: r.Broken, Exact: r.Exact, Hooks: r.Hooks,
			Expects: r.Expects, Cases: r.Cases, Cleanup: r.Cleanup}
		for _, s := range r.Sites {
			row.Sites = append(row.Sites, Site{Line: int(s[0].(float64)), Rule: s[1].(string), Text: s[2].(string)})
		}
		rows = append(rows, row)
	}
	return rows
}

func TestAreaSpecMatchesThePythonOriginal(t *testing.T) {
	for _, c := range loadAreaCases(t) {
		t.Run(c.Case, func(t *testing.T) {
			rows := c.rows()
			assertGolden(t, filepath.Join("testdata", "golden", "area_contract_"+c.Case+".md"),
				Contract(c.Name, c.Prefixes, rows))
			assertGolden(t, filepath.Join("testdata", "golden", "area_render_"+c.Case+".md"),
				Render(c.Name, c.Label, c.Prefixes, rows, c.Tests))
		})
	}
}

func TestTheGeneratedSpecsSpeakTheFleetsVocabulary(t *testing.T) {
	text := legacySpec()
	mustContain(t, text, "difficulty: run-mythic", "ogsf run-mythic specs/beta-18-quests/testing-library-clean-x.md",
		"**Fleet quest (set piece).**", "## Why this quest exists", "your match report")
	mustNotContain(t, text, "lane: sdlc-strict", "just sdlc-strict", "Factory slice", "(ADW)", "beta-18-slices", "(session ")
}
