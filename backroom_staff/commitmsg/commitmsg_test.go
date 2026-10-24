package commitmsg

// Ported from legacy/adws/tests/test_commit_message.py: every header a set
// piece ships must survive @commitlint/config-conventional.

import (
	"strings"
	"testing"
)

func TestConformingHeaderPassesThrough(t *testing.T) {
	msg := "fix(tests): replace container queries in contact form tests"
	if got := Normalise(msg, "chore", "f25e0286"); got != msg {
		t.Fatalf("got %q", got)
	}
}

func TestBareSentenceGetsATypeAndTraceableScope(t *testing.T) {
	got := Normalise("Add plan for the health endpoint.", "docs", "f25e0286aaaa")
	if want := "docs(ogsf-f25e0286): add plan for the health endpoint"; got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestUnknownTypeIsNotTrusted(t *testing.T) {
	// `ogsf(<id>): …` was the strict difficulty's old fallback. `ogsf` is not in the enum.
	out := Normalise("ogsf(4b06828b): Migrate env reads", "chore", "4b06828b")
	if !strings.HasPrefix(out, "chore(ogsf-4b06828b): ") {
		t.Fatalf("got %q", out)
	}
}

func TestSubjectCaseAndFullStopAreFixedUnderAValidPrefix(t *testing.T) {
	if got := Normalise("feat(env): Add bridge.", "chore", "x"); got != "feat(env): add bridge" {
		t.Fatalf("got %q", got)
	}
}

func TestHeaderIsCappedAndBodyIsUntouched(t *testing.T) {
	body := "Why this exists, in prose.\n\nCo-Authored-By: someone"
	out := Normalise("fix: "+strings.Repeat("a", 200)+"\n"+body, "chore", "x")
	head, rest, _ := strings.Cut(out, "\n")
	if len([]rune(head)) > 100 {
		t.Fatalf("header is %d characters", len([]rune(head)))
	}
	if rest != body {
		t.Fatalf("body changed: %q", rest)
	}
}

func TestEmptyMessageStillYieldsAValidHeader(t *testing.T) {
	if got := Normalise("", "chore", "abcdef123456"); got != "chore(ogsf-abcdef12): ogsf run commit" {
		t.Fatalf("got %q", got)
	}
}

const build = "test(shell): make the shell test files lint-clean\n\nThis slice started at 287 lint errors."

func TestASubjectOnlyFixReportDoesNotReplaceTheSliceMessage(t *testing.T) {
	// A match once committed "fix nav sheet test typecheck regression" and
	// nothing else, for a quest that changed 13 files.
	out := KeepTheFuller(build, "test(shell): fix nav sheet test typecheck regression")
	if !strings.HasPrefix(out, build) {
		t.Fatalf("lost the build message: %q", out)
	}
	if !strings.Contains(out, "After the quality gate reported a failure: test(shell): fix nav sheet test typecheck regression") {
		t.Fatalf("fix subject not appended: %q", out)
	}
}

func TestAFixReportWithABodyIsTheWholeMessageAsTheSpecAsks(t *testing.T) {
	later := "test(shell): make the shell test files lint-clean\n\nAll of it, and the fix."
	if got := KeepTheFuller(build, later); got != later {
		t.Fatalf("got %q", got)
	}
}

func TestAnEmptyFixReportKeepsTheBuildMessage(t *testing.T) {
	if got := KeepTheFuller(build, ""); got != build {
		t.Fatalf("got %q", got)
	}
}

func TestAFirstMessageStandsAlone(t *testing.T) {
	if got := KeepTheFuller("", "docs: add the plan"); got != "docs: add the plan" {
		t.Fatalf("got %q", got)
	}
}

func TestHasBody(t *testing.T) {
	if !HasBody(build) {
		t.Fatal("the build message has a body")
	}
	if HasBody("test(shell): fix one thing") {
		t.Fatal("a subject alone has no body")
	}
	if HasBody("test(shell): fix one thing\n\n   \n") {
		t.Fatal("blank lines are not a body")
	}
}
