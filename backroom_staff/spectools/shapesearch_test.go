package spectools

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestShapeSearchMatchesThePythonOriginal(t *testing.T) {
	// testdata/shapes.diff touches every shape, plus legacy's quirks: a
	// deleted file's `+++ /dev/null` names no new file, so its hunk is
	// counted under the file before it, exactly as the Python did.
	var out bytes.Buffer
	scanDiff(readFile(t, "testdata/shapes.diff"), "fixture", &out)
	want := readFile(t, "testdata/golden/shapes.txt")
	if out.String() != want {
		t.Fatalf("Go's scan differs from the Python original.\n%s", diffText(want, out.String()))
	}
}

func TestTheReExpressedPatternsJudgeLikeTheOriginals(t *testing.T) {
	var probes []string
	if err := json.Unmarshal([]byte(readFile(t, "testdata/shape_probes.json")), &probes); err != nil {
		t.Fatal(err)
	}
	var python map[string][]bool
	if err := json.Unmarshal([]byte(readFile(t, "testdata/golden/shape_probes.json")), &python); err != nil {
		t.Fatal(err)
	}
	ours := map[string]func(string) bool{
		"aria":          shapeAria.MatchString,
		"alternatives":  shapeAlternatives.MatchString,
		"data_not_hook": dataAttributeNotHook,
	}
	for name, judge := range ours {
		verdicts := python[name]
		if len(verdicts) != len(probes) {
			t.Fatalf("%s: %d verdicts for %d probes", name, len(verdicts), len(probes))
		}
		matched := 0
		for i, line := range probes {
			if got := judge(line); got != verdicts[i] {
				t.Errorf("%s(%s) = %v, Python said %v", name, line, got, verdicts[i])
			}
			if verdicts[i] {
				matched++
			}
		}
		if matched == 0 || matched == len(probes) {
			t.Errorf("%s: the probes must hold lines it finds and lines it does not (found %d of %d)", name, matched, len(probes))
		}
	}
}

func TestEachReExpressedPatternOnLinesItMustAndMustNotFind(t *testing.T) {
	cases := []struct {
		name   string
		judge  func(string) bool
		find   []string
		ignore []string
	}{
		{"aria", shapeAria.MatchString,
			[]string{"x.querySelector(`[aria-label]`)", `x.querySelector("nav [aria-current]")`, `x.querySelector("[a='1'] [aria-x]")`},
			[]string{`x.querySelector("div") + '[aria-label]'`, `x.querySelector('[role="tab"]')`}},
		{"alternatives", shapeAlternatives.MatchString,
			[]string{`x.querySelector('a, b')`, `x.querySelector("a,b")`, "x.querySelector(`li, dt`)"},
			[]string{`x.querySelector("a"), other`, `x.querySelector('a'); y = 'x, z'`}},
		{"data_not_hook", dataAttributeNotHook,
			[]string{`x.querySelector('[data-id="1"]')`, `x.querySelector('[data-hp="a"]') ?? x.querySelector('[data-k="b"]')`, `x.querySelector("[data-hp-row='1']")`},
			[]string{`x.querySelector('[data-hp="a"]')`, `x.querySelector('[aria-x]')`}},
	}
	for _, c := range cases {
		for _, line := range c.find {
			if !c.judge(line) {
				t.Errorf("%s misses %s", c.name, line)
			}
		}
		for _, line := range c.ignore {
			if c.judge(line) {
				t.Errorf("%s wrongly finds %s", c.name, line)
			}
		}
	}
}

func TestShapeSearchReadsARangeFromGit(t *testing.T) {
	repo := newRepo(t, map[string]string{"a.test.tsx": "const x = el.querySelector('[data-hp=\"x\"]');\n"})
	writeFile(t, repo+"/a.test.tsx", "const x = screen.getByRole(\"region\");\n")
	gitIn(t, repo, "commit", "-qam", "rewrite")
	t.Chdir(repo)
	var stdout, stderr bytes.Buffer
	if code := ShapeSearch([]string{"rewrite=HEAD~1..HEAD"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	out := stdout.String()
	if !strings.HasPrefix(out, "== rewrite: 2 candidates in 1 files\n") ||
		!strings.Contains(out, "[a hook lookup with no test id in its place] a.test.tsx") ||
		!strings.Contains(out, "[role query where a tag/attribute read was] a.test.tsx") {
		t.Fatalf("output:\n%s", out)
	}
	if code := ShapeSearch([]string{"no-equals-sign"}, &stdout, &stderr); code != 2 {
		t.Fatalf("an argument without = must be refused, exit %d", code)
	}
}

func TestSplitLinesIsPythonsSplitlines(t *testing.T) {
	got := splitLines("a\nb\r\nc\rd\n")
	want := []string{"a", "b", "c", "d"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("splitLines = %q", got)
	}
	if len(splitLines("")) != 0 {
		t.Fatalf("empty text has no lines")
	}
}
