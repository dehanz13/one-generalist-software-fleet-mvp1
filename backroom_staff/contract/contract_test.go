package contract

// Ported from legacy/adws/tests/test_contract.py: the quest contract must
// refuse what it cannot read, and never invent a pass.

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

const spec = "# Quest: example\n\nProse the players read.\n\n" +
	"```ogsf\n" +
	"difficulty: run-mythic\n" +
	"precondition: |\n" +
	"  test -n \"work\"\n" +
	"writes:\n" +
	"  - components/contact/*\n" +
	"  - changelog/unreleased/example.md\n" +
	"checks:\n" +
	"  - name: touched files are lint-clean\n" +
	"    run: \"true\"\n" +
	"```\n\n" +
	"More prose, with an ordinary fence the parser must ignore:\n\n" +
	"```bash\nogsf run-mythic specs/example.md\n```\n"

// ── parse ───────────────────────────────────────────────────────────────────

func TestReadsTheDeclaredBlock(t *testing.T) {
	declared, err := Parse(spec)
	if err != nil {
		t.Fatal(err)
	}
	if declared.Difficulty != "run-mythic" {
		t.Fatalf("difficulty %q", declared.Difficulty)
	}
	if strings.TrimSpace(declared.Precondition) != `test -n "work"` {
		t.Fatalf("precondition %q", declared.Precondition)
	}
	if !reflect.DeepEqual(declared.Writes, []string{"components/contact/*", "changelog/unreleased/example.md"}) {
		t.Fatalf("writes %v", declared.Writes)
	}
	if len(declared.Checks) != 1 || declared.Checks[0].Name != "touched files are lint-clean" {
		t.Fatalf("checks %v", declared.Checks)
	}
}

func TestSpecWithoutABlockIsNoneNotAnEmptyContract(t *testing.T) {
	// nil and "declared nothing" must stay distinguishable: the kickoff
	// checklist reports the first as NOT examined rather than as a pass.
	for _, text := range []string{"# Quest\n\n```bash\nls\n```\n", ""} {
		declared, err := Parse(text)
		if err != nil || declared != nil {
			t.Fatalf("Parse(%q) = %v, %v; want nil, nil", text, declared, err)
		}
	}
}

func TestTwoBlocksAreRefused(t *testing.T) {
	if _, err := Parse(spec + "\n```ogsf\ndifficulty: run-heroic\n```\n"); err == nil {
		t.Fatal("two blocks were accepted")
	}
}

func TestMalformedBlockRaisesInsteadOfDegrading(t *testing.T) {
	for _, text := range []string{"```ogsf\n- just\n- a list\n```\n", "```ogsf\nwrites: not-a-list\n```\n"} {
		if _, err := Parse(text); err == nil {
			t.Fatalf("Parse(%q) accepted a malformed block", text)
		}
	}
}

// ── scope ───────────────────────────────────────────────────────────────────

var writes = []string{"components/contact/*", "changelog/unreleased/example.md"}

func TestDeclaredPathsAndThePlanFileAreInScope(t *testing.T) {
	paths := []string{"components/contact/ContactForm.test.tsx",
		"components/contact/nested/deep/Thing.test.tsx", // `*` crosses `/`
		"changelog/unreleased/example.md",
		"specs/ab12cd34_example.md"} // AlwaysWritable
	if got := OutOfScope(paths, writes); len(got) != 0 {
		t.Fatalf("out of scope: %v", got)
	}
}

func TestANeighbouringDirectoryIsOutOfScope(t *testing.T) {
	paths := []string{"components/contact/A.test.tsx", "components/contactless/B.test.tsx",
		"components/room/C.test.tsx", "lib/env.ts", "changelog/unreleased/other.md"}
	want := []string{"components/contactless/B.test.tsx", "components/room/C.test.tsx",
		"lib/env.ts", "changelog/unreleased/other.md"}
	if got := OutOfScope(paths, writes); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestBracketedRouteSegmentsAreLiteralEnough(t *testing.T) {
	// app/api/rooms/[code]/… is a real path shape; fnmatch reads [code] as a
	// character class, so the GLOB must not rely on naming that segment.
	if got := OutOfScope([]string{"app/api/rooms/[code]/route.test.ts"}, []string{"app/api/rooms/*"}); len(got) != 0 {
		t.Fatalf("out of scope: %v", got)
	}
}

// ── shell ───────────────────────────────────────────────────────────────────

func TestExitStatusAndOutputComeBack(t *testing.T) {
	if code, out := Shell("echo examined 3 files", time.Minute); code != 0 || out != "examined 3 files" {
		t.Fatalf("got (%d, %q)", code, out)
	}
	if code, _ := Shell("exit 7", time.Minute); code != 7 {
		t.Fatalf("got exit %d", code)
	}
}

func TestAFailingPipeStageIsNotHiddenByTheLastCommand(t *testing.T) {
	// A pipe reports the PIPE's status: pipefail is on.
	if code, _ := Shell("false | cat", time.Minute); code == 0 {
		t.Fatal("a failing pipe stage passed")
	}
}

// ── what the fixer is told ──────────────────────────────────────────────────

func TestAFailedCheckNamesItselfItsCommandAndItsOutput(t *testing.T) {
	text := CheckFailure("lint-clean", 1, "  npx eslint x  ", "2 errors", false)
	for _, want := range []string{"`lint-clean` failed (exit 1)", "$ npx eslint x\n2 errors"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in %q", want, text)
		}
	}
	if strings.Contains(text, "ALREADY rewritten") {
		t.Fatal("the rewritten note appeared without a hook")
	}
}

func TestTheFixerIsToldWhenTheHookHasRewrittenTheFiles(t *testing.T) {
	// Three attempts were once lost to a suppression Prettier kept moving off
	// its line, because the fixer was never told the file it was shown was
	// not the file it had written.
	text := CheckFailure("lint-clean", 1, "npx eslint x", "2 errors", true)
	if !strings.Contains(text, "ALREADY rewritten") || !strings.Contains(text, "AFTER formatting") {
		t.Fatalf("note missing: %q", text)
	}
	if !strings.HasPrefix(text, "contract check `lint-clean` failed") {
		t.Fatalf("prefix: %q", text)
	}
}

func TestAFirstFailureIsHandedBackAsItIs(t *testing.T) {
	if got := WithRepeatNote([]string{"lint: 2 errors"}, nil); !reflect.DeepEqual(got, []string{"lint: 2 errors"}) {
		t.Fatalf("got %v", got)
	}
}

func TestTheSameFailureTwiceSaysSo(t *testing.T) {
	again := WithRepeatNote([]string{"x.tsx 58:13 error"}, []string{"x.tsx 58:13 error"})
	if again[0] != "x.tsx 58:13 error" || !strings.Contains(again[1], "REPEATED FAILURE") {
		t.Fatalf("got %v", again)
	}
}

func TestAMovedLineNumberIsStillTheSameFailure(t *testing.T) {
	// The error was on line 58, then 57, then 58 again.
	if again := WithRepeatNote([]string{"x.tsx 57:13 error"}, []string{"x.tsx 58:13 error"}); len(again) != 2 {
		t.Fatalf("got %v", again)
	}
}

func TestADifferentFailureIsNotCalledARepeat(t *testing.T) {
	got := WithRepeatNote([]string{"scope: stray file"}, []string{"x.tsx 58:13 error"})
	if !reflect.DeepEqual(got, []string{"scope: stray file"}) {
		t.Fatalf("got %v", got)
	}
}

func TestPassingAfterAFailureAddsNothing(t *testing.T) {
	if got := WithRepeatNote([]string{}, []string{"x.tsx 58:13 error"}); len(got) != 0 {
		t.Fatalf("got %v", got)
	}
}

// ── beyond legacy ───────────────────────────────────────────────────────────

func TestALegacyLaneKeyStillNamesTheDifficulty(t *testing.T) {
	declared, err := Parse("```ogsf\nlane: sdlc-strict\n```\n")
	if err != nil || declared.Difficulty != "run-mythic" {
		t.Fatalf("got %+v, %v", declared, err)
	}
}

func TestFnmatchFollowsPython(t *testing.T) {
	cases := []struct {
		name, pattern string
		want          bool
	}{
		{"a/b/c.txt", "a/*", true},
		{"a/[x]/c", "a/[[]x]/c", true},
		{"a/x/c", "a/[x]/c", true},
		{"a/y/c", "a/[!x]/c", true},
		{"a/[", "a/[", true},
		{"abc", "a?c", true},
		{"ac", "a?c", false},
	}
	for _, c := range cases {
		if got := Fnmatch(c.name, c.pattern); got != c.want {
			t.Errorf("Fnmatch(%q, %q) = %v", c.name, c.pattern, got)
		}
	}
}
