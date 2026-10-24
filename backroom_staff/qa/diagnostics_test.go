package qa

// Ported from legacy/adws/tests/test_quality_diagnostics.py (the progressive
// gate's complete diagnostic signal) and test_quality_subprocess.py (output
// that is safe to append to a qa artifact).

import "testing"

func TestTypescriptReadsAllErrorsAndRejectsACountNeutralSwap(t *testing.T) {
	before := "a.ts(1,1): error TS4111: old\nb.ts(2,2): error TS4111: existing\n"
	after := "b.ts(2,2): error TS4111: existing\nc.ts(3,3): error TS7006: new\n"
	original, err := ParseDiagnostics("tsc", before, false)
	if err != nil {
		t.Fatal(err)
	}
	current, err := ParseDiagnostics("tsc", after, false)
	if err != nil {
		t.Fatal(err)
	}
	if original.Total() != 2 || current.Total() != 2 {
		t.Fatalf("totals %d and %d", original.Total(), current.Total())
	}
	if n := NewDiagnostics(current, original).Total(); n != 1 {
		t.Fatalf("%d new diagnostics, want 1", n)
	}
}

func TestLintUsesFileAndRuleFromCompleteOutput(t *testing.T) {
	before := "/repo/a.test.ts\n  1:1  error  old issue  jest-dom/prefer-in-document\n"
	after := "/repo/a.test.ts\n  2:1  error  old issue  jest-dom/prefer-in-document\n" +
		"/repo/b.test.ts\n  1:1  error  new issue  testing-library/no-node-access\n"
	original, _ := ParseDiagnostics("eslint", before, false)
	current, _ := ParseDiagnostics("eslint", after, false)
	if n := NewDiagnostics(current, original).Total(); n != 1 {
		t.Fatalf("%d new diagnostics, want 1", n)
	}
}

func TestUnparsedFailureIsNotAcceptedAsOneExistingError(t *testing.T) {
	if _, err := ParseDiagnostics("tsc", "compiler crashed", false); err == nil {
		t.Fatal("an unreadable failure was accepted")
	}
}

func TestBytesFromTimeoutAreDecoded(t *testing.T) {
	if got := CapturedOutputText([]byte("failed\n")); got != "failed\n" {
		t.Fatalf("got %q", got)
	}
}

func TestInvalidBytesArePreservedAsReplacementText(t *testing.T) {
	if got := CapturedOutputText([]byte("bad\xff")); got != "bad�" {
		t.Fatalf("got %q", got)
	}
}

func TestTextAndMissingOutputRemainText(t *testing.T) {
	if got := CapturedOutputText("already text"); got != "already text" {
		t.Fatalf("got %q", got)
	}
	if got := CapturedOutputText(nil); got != "" {
		t.Fatalf("got %q", got)
	}
}
