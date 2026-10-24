// Package abandoned tells "the club was cut off" from "the work is wrong".
// (Legacy: adw_modules/provider_stop.py; the picked name is match abandoned.)
//
// A match once ended "turnover" at its iterate objective because the
// builder's provider answered "You have no credits remaining". The build had
// passed its contract; one type error was left. The summary read exactly as
// it does for a red official review, and the exit code was the same 1. A
// provider error is not a verdict on the work, so a set piece that meets one
// says so in words and exits with a code of its own.
package abandoned

import (
	"errors"
	"strings"
)

// ExitCode is EX_TEMPFAIL in sysexits.h: the request could not be carried
// out now and may succeed later. Neither 0 (accepted) nor 1 (an official
// review or the contract is red).
const ExitCode = 75

// MatchAbandoned is the model provider refusing or failing a request: no
// credits, a rate limit, an outage. (Legacy: ProviderError.)
type MatchAbandoned struct {
	Message string
}

func (e *MatchAbandoned) Error() string { return e.Message }

// Is reports whether err is, or wraps, a match abandoned.
func Is(err error) bool {
	var target *MatchAbandoned
	return errors.As(err, &target)
}

// Note is what to tell the founder when a provider error ends a match.
func Note(err error) string {
	return strings.Join([]string{
		"",
		"STOPPED BY THE PROVIDER, not by an official review.",
		"  " + err.Error(),
		"",
		"Nothing in this match judged the work as wrong. No commit was made, and the",
		"working tree is as the last finished objective left it.",
		"  - `ogsf passages <match_id>` shows which objectives passed before the stop.",
		"  - If the build and its contract passed, the quest may be a fix short of",
		"    done: read the last qa objective's findings before discarding anything.",
		"  - Running again needs the provider to answer: credits, a limit, or an",
		"    outage. Which account pays is the operator's decision, not the difficulty's.",
		"",
	}, "\n")
}
