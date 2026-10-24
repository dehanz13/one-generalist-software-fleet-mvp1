// Package officialreview holds the official reviews: code that verifies a
// match report's CLAIMS, never guesses. (Legacy: adw_modules/gates.py; the
// picked name for a gate is an official review.)
//
// A review returns the checks it ran, one per item it looked at. Violations
// are derived from the failed checks and sent back to the SAME club session
// as a correction. Every check is recorded either way, so a green review says
// WHAT it verified instead of only that it passed. Reviews check what is
// mechanically checkable; plan quality is the safety officer's job.
package officialreview

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// TailChars is how much of a failing command's output is kept as evidence.
const TailChars = 1000

// ReviewCheck is one thing a review looked at, and what it found. Note is the
// evidence ("exists, 2.1KB", "exit 0"); on a failed check it doubles as the
// reason, so it is what the player is told. (Legacy: GateCheck.)
type ReviewCheck struct {
	Item string `json:"item"`
	OK   bool   `json:"ok"`
	Note string `json:"note"`
}

// Result is what every review returns: the checks it ran. (Legacy: GateReport.)
type Result struct {
	Checks []ReviewCheck
}

// Check appends one check and returns the result, so a review is a loop and a return.
func (r *Result) Check(item string, ok bool, note string) *Result {
	r.Checks = append(r.Checks, ReviewCheck{Item: item, OK: ok, Note: note})
	return r
}

// Violations are the failed checks, as "<item>: <note or 'failed'>".
func (r *Result) Violations() []string {
	var out []string
	for _, c := range r.Checks {
		if !c.OK {
			note := c.Note
			if note == "" {
				note = "failed"
			}
			out = append(out, c.Item+": "+note)
		}
	}
	return out
}

// Passed is true when no check failed.
func (r *Result) Passed() bool { return len(r.Violations()) == 0 }

// Review is a named check of a report.
type Review struct {
	Name  string
	Check func(report reports.Report) *Result
}

// Failure is a player that never satisfied its reviews. (Legacy: GateFailure.)
type Failure struct {
	Message string
}

func (e *Failure) Error() string { return e.Message }

func size(path string) string {
	info, err := os.Stat(path)
	if err != nil {
		return "?"
	}
	n := info.Size()
	if n < 1024 {
		return fmt.Sprintf("%dB", n)
	}
	return fmt.Sprintf("%.1fKB", float64(n)/1024)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// BallInPlay: every declared artifact exists. (Legacy: artifacts_exist.)
var BallInPlay = Review{Name: "ball_in_play", Check: func(report reports.Report) *Result {
	r := &Result{}
	for _, a := range report.Base().Artifacts {
		if exists(a) {
			r.Check(a, true, "exists, "+size(a))
		} else {
			r.Check(a, false, "declared artifact does not exist")
		}
	}
	return r
}}

// BallNotFlat: every declared artifact that is a file has content.
// Existence is BallInPlay's job. (Legacy: files_non_empty.)
var BallNotFlat = Review{Name: "ball_not_flat", Check: func(report reports.Report) *Result {
	r := &Result{}
	for _, a := range report.Base().Artifacts {
		info, err := os.Stat(a)
		if err != nil || info.IsDir() {
			continue
		}
		if info.Size() == 0 {
			r.Check(a, false, "declared artifact is empty")
		} else {
			r.Check(a, true, size(a))
		}
	}
	return r
}}

// JSONParses: every declared .json artifact parses.
var JSONParses = Review{Name: "json_parses", Check: func(report reports.Report) *Result {
	r := &Result{}
	for _, a := range report.Base().Artifacts {
		if !strings.HasSuffix(a, ".json") || !exists(a) {
			continue
		}
		data, _ := os.ReadFile(a)
		var parsed any
		if err := json.Unmarshal(data, &parsed); err != nil {
			r.Check(a, false, "declared JSON artifact does not parse: "+err.Error())
			continue
		}
		r.Check(a, true, "parses, "+pyTypeName(parsed))
	}
	return r
}}

func pyTypeName(v any) string {
	switch v.(type) {
	case map[string]any:
		return "dict"
	case []any:
		return "list"
	case string:
		return "str"
	case float64:
		return "float"
	case bool:
		return "bool"
	}
	return "NoneType"
}

// ReplayMatchesReport: every file the report claims it changed exists on
// disk. (Legacy: diff_matches_claims.)
var ReplayMatchesReport = Review{Name: "replay_matches_report", Check: func(report reports.Report) *Result {
	r := &Result{}
	for _, f := range reports.ChangedFilesOf(report) {
		if exists(f) {
			r.Check(f, true, "exists, "+size(f))
		} else {
			r.Check(f, false, "claimed changed file does not exist")
		}
	}
	return r
}}

// DecisionStands: a safety officer's ruling must agree with the findings it
// just wrote down. Nothing here judges the code; it checks the report against
// itself. An approval that ships blocking items, or a rejection that names no
// problem, is a claim the harness can refute without reading a line of the
// diff. (Legacy: verdict_consistent.)
var DecisionStands = Review{Name: "decision_stands", Check: func(report reports.Report) *Result {
	r := &Result{}
	v, _ := report.(*reports.VarReport)
	if v == nil {
		v = &reports.VarReport{}
	}
	var unmet []string
	for _, f := range v.Findings {
		if !f.Met {
			unmet = append(unmet, f.Requirement)
		}
	}
	switch {
	case len(v.Blocking) == 0:
		r.Check("approved vs blocking", true, "no blocking items")
	case v.Approved:
		r.Check("approved vs blocking", false, fmt.Sprintf("%d blocking item(s) while approved=true", len(v.Blocking)))
	default:
		r.Check("approved vs blocking", true, fmt.Sprintf("%d blocking item(s), not approved", len(v.Blocking)))
	}
	switch {
	case len(unmet) == 0:
		r.Check("approved vs findings", true, "every requirement met")
	case v.Approved:
		r.Check("approved vs findings", false, fmt.Sprintf("%d unmet requirement(s) while approved=true", len(unmet)))
	default:
		r.Check("approved vs findings", true, fmt.Sprintf("%d unmet requirement(s), not approved", len(unmet)))
	}
	supported := v.Approved || len(v.Blocking) > 0 || len(unmet) > 0
	note := "verdict is supported"
	if !supported {
		note = "approved=false but no blocking item or unmet requirement was given"
	}
	r.Check("rejection names a problem", supported, note)
	return r
}}

// TestsPass builds a review that requires a shell command to exit 0.
func TestsPass(command string) Review {
	return Review{Name: fmt.Sprintf("tests_pass(%s)", command), Check: func(reports.Report) *Result {
		cmd := kit.GroupCommand(context.Background(), "sh", "-c", command)
		cmd.Env = kit.OperatorEnv()
		out, err := cmd.CombinedOutput()
		code := 0
		if err != nil {
			code = 127 // could not start: a missing shell or command
			if cmd.ProcessState != nil {
				code = cmd.ProcessState.ExitCode()
			}
		}
		note := fmt.Sprintf("exit %d", code)
		if code != 0 {
			note += "\n" + kit.Tail(string(out), TailChars)
		}
		return (&Result{}).Check(command, code == 0, note)
	}}
}
