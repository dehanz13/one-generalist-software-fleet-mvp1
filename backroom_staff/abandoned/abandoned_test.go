package abandoned

// Ported from legacy/adws/tests/test_provider_stop.py: a provider error is
// reported as a stop, not as a verdict on the work.

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestAProviderErrorIsStillARuntimeError(t *testing.T) {
	// Legacy: ProviderError subclassed RuntimeError, so callers catching one
	// kept working. Here: it is an error, and it is still recognised once a
	// caller has wrapped it.
	var err error = &MatchAbandoned{Message: "pi provider error: x"}
	wrapped := fmt.Errorf("objective build: %w", err)
	if !Is(wrapped) {
		t.Fatal("a wrapped match abandoned was not recognised")
	}
	if Is(errors.New("a red official review")) {
		t.Fatal("an ordinary error was taken for a match abandoned")
	}
}

func TestTheExitCodeIsNeitherAcceptedNorARedGate(t *testing.T) {
	if ExitCode == 0 || ExitCode == 1 {
		t.Fatalf("exit code %d collides with a match's own outcome", ExitCode)
	}
}

func TestTheNoteCarriesTheProvidersOwnWords(t *testing.T) {
	said := "pi provider error: You have no credits remaining."
	if !strings.Contains(Note(&MatchAbandoned{Message: said}), said) {
		t.Fatal("the provider's words are missing")
	}
}

func TestTheNoteSaysNoGateWasRedAndNothingWasCommitted(t *testing.T) {
	text := Note(&MatchAbandoned{Message: "pi provider error: rate limited"})
	if !strings.Contains(text, "not by an official review") || !strings.Contains(text, "No commit was made") {
		t.Fatalf("note: %q", text)
	}
}

func TestTheNoteDoesNotTellTheOperatorWhichAccountToUse(t *testing.T) {
	// Switching provider would once have let the night go on, and it was not
	// the difficulty's call.
	if !strings.Contains(Note(&MatchAbandoned{Message: "x"}), "operator's decision") {
		t.Fatal("the note does not leave the account to the operator")
	}
}
