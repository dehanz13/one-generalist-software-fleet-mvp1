// Package qa runs the deterministic checks: lint, typecheck, test and build.
// (Legacy: adw_modules/quality.py, quality_diagnostics.py and
// quality_subprocess.py.)
//
// A known command is not a judgement call. Anything whose invocation can be
// written down belongs here as code: it costs nothing and returns the same
// answer every time. Players are for the parts that need reading and deciding.
//
// The commands come from the config's `qa.checks` (legacy hard-wired one
// project's four `npm run` scripts; those four are still the defaults).
package qa

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// Pace, when set, is extra time a check takes on the active clock after its
// command returns. Nil in normal use; the demo sets it so a tour on the
// virtual clock shows checks taking as long as real ones do.
var Pace func(spec boardroom.QACheck) time.Duration

// TailChars is how much of a failing check's output rides back inside the
// report: enough for a builder to act on, bounded so a runaway stack trace
// cannot swamp the next player's context.
const TailChars = 4_000

// Pitch is what qa needs from the running match.
type Pitch interface {
	MatchID() string
	// CurrentObjective is the open objective's id and seq.
	CurrentObjective() (string, int)
	TorchPassDir() string
	RepoRoot() string
	Note(message string)
	Event(rec matchfeed.EventRecord) string
	Checks() []boardroom.QACheck
	// Context is cancelled when the match is interrupted, which stops a
	// running check and its children.
	Context() context.Context
}

// CheckResult is the evidence from one check. (Legacy: QualityCheckResult.)
type CheckResult struct {
	Name            string  `json:"name"`
	Area            string  `json:"area"`
	Operation       string  `json:"operation"`
	Diagnostics     string  `json:"diagnostics"`
	Command         string  `json:"command"`
	ReturnCode      int     `json:"returncode"`
	Passed          bool    `json:"passed"`
	DurationSeconds float64 `json:"duration_seconds"`
	OutputArtifact  string  `json:"output_artifact"`
	// The tail of stdout+stderr, verbatim and unparsed: a failure has to
	// travel back to the builder, which cannot open a log it was never handed.
	OutputTail string `json:"output_tail"`
}

// Result is every check a block ran, and the verdict. (Legacy: QualityResult.)
type Result struct {
	Passed    bool          `json:"passed"`
	Checks    []CheckResult `json:"checks"`
	Failures  []string      `json:"failures"`
	Artifacts []string      `json:"artifacts"`
}

var safeArg = regexp.MustCompile(`^[\w@%+=:,./-]+$`)

// shellJoin is Python's shlex.join: the command as a shell would read it.
func shellJoin(argv []string) string {
	parts := make([]string, len(argv))
	for i, a := range argv {
		switch {
		case a == "":
			parts[i] = "''"
		case safeArg.MatchString(a):
			parts[i] = a
		default:
			parts[i] = "'" + strings.ReplaceAll(a, "'", `'"'"'`) + "'"
		}
	}
	return strings.Join(parts, " ")
}

func checkDir(p Pitch, name string) string {
	_, seq := p.CurrentObjective()
	dir := filepath.Join(p.TorchPassDir(), "qa", fmt.Sprintf("%02d_%s", seq, name))
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

// RunCheck runs one check in the repo root with the founder's environment,
// keeps its full output as command.log, and records an ability cast.
func RunCheck(p Pitch, spec boardroom.QACheck) CheckResult {
	objectiveID, _ := p.CurrentObjective()
	artifact := filepath.Join(checkDir(p, spec.Name), "command.log")
	command := shellJoin(spec.Argv)
	p.Note(fmt.Sprintf("qa %s: %s", spec.Name, command))

	started := kit.NowISO()
	clock := kit.Now()
	timeout := time.Duration(spec.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	parent := p.Context()
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	cmd := kit.GroupCommand(ctx, spec.Argv[0], spec.Argv[1:]...)
	cmd.Dir = p.RepoRoot()
	cmd.Env = kit.OperatorEnv()
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdoutBuf, &stderrBuf
	err := cmd.Run()
	returnCode := 0
	stdout, stderr := CapturedOutputText(stdoutBuf.Bytes()), CapturedOutputText(stderrBuf.Bytes())
	switch {
	case ctx.Err() == context.DeadlineExceeded:
		returnCode = 124
		stderr += fmt.Sprintf("\nTimed out after %ds.", spec.TimeoutSeconds)
	case err != nil && cmd.ProcessState == nil:
		// A missing binary lands here as exit 127 with the real message: no
		// pre-flight probe needed, and none wanted.
		returnCode = 127
		stderr = err.Error()
	case err != nil:
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			returnCode = exit.ExitCode()
		} else {
			returnCode = 1
		}
	}
	if Pace != nil {
		kit.Sleep(Pace(spec))
	}
	duration := kit.Since(clock).Seconds()
	_ = os.WriteFile(artifact, []byte(fmt.Sprintf("$ %s\nexit: %d\nduration_seconds: %.3f\n\n--- stdout ---\n%s\n--- stderr ---\n%s\n",
		command, returnCode, duration, stdout, stderr)), 0o644)
	passed := returnCode == 0
	p.Event(matchfeed.EventRecord{
		MatchID: p.MatchID(), ObjectiveID: objectiveID, Type: "ability_cast", Name: "qa:" + spec.Name,
		Payload: map[string]any{"area": spec.Area, "operation": spec.Operation, "command": command,
			"returncode": returnCode, "passed": passed, "output_artifact": artifact},
		StartedAt: started, EndedAt: kit.NowISO(),
	})
	word := "failed"
	if passed {
		word = "passed"
	}
	p.Note(fmt.Sprintf("qa %s: %s (exit %d, %.1fs)", spec.Name, word, returnCode, duration))
	return CheckResult{Name: spec.Name, Area: spec.Area, Operation: spec.Operation, Diagnostics: spec.Diagnostics,
		Command: command, ReturnCode: returnCode, Passed: passed, DurationSeconds: duration,
		OutputArtifact: artifact, OutputTail: kit.Tail(stdout+stderr, TailChars)}
}

func byOperation(p Pitch, operation string) []boardroom.QACheck {
	var out []boardroom.QACheck
	for _, c := range p.Checks() {
		if c.Operation == operation {
			out = append(out, c)
		}
	}
	return out
}

func failureText(c CheckResult) string {
	return strings.TrimRight(fmt.Sprintf("%s: `%s` exited %d\n%s", c.Name, c.Command, c.ReturnCode, c.OutputTail), " \n\t")
}

// RunTests is the test checks alone: the deterministic test objective. This
// is what replaced a tester agent once the command was written down; the
// repair loop is unchanged, because a failure still reaches the builder
// through AsReport.
func RunTests(p Pitch) Result {
	result := Result{Passed: true, Checks: []CheckResult{}, Failures: []string{}, Artifacts: []string{}}
	for _, spec := range byOperation(p, "test") {
		check := RunCheck(p, spec)
		result.Checks = append(result.Checks, check)
		result.Artifacts = append(result.Artifacts, check.OutputArtifact)
		if !check.Passed {
			result.Passed = false
			result.Failures = append(result.Failures, failureText(check))
		}
	}
	return result
}

// AsReport wraps a deterministic result so a player can be handed it
// directly: a failing check flows back into the builder through exactly the
// door a player's report would.
func AsReport(result Result, what string) *reports.QaReport {
	report := &reports.QaReport{Passed: result.Passed, Failures: result.Failures}
	report.Artifacts = result.Artifacts
	if result.Passed {
		report.Status = reports.Touchdown
		report.Summary = fmt.Sprintf("%s: all %d check(s) passed", what, len(result.Checks))
	} else {
		report.Status = reports.Turnover
		report.Summary = fmt.Sprintf("%s: %d of %d check(s) failed", what, len(result.Failures), len(result.Checks))
		report.NotesForNextPlayer = "Fix every failure below. The output is verbatim from the command — trust it over any summary."
	}
	reports.Normalize(report)
	return report
}

// LineOfScrimmage is the complete diagnostics measured before a quest
// starts, per check. (Legacy: the baseline, BlockBaseline.)
type LineOfScrimmage map[string]Diagnostics

func diagnosticsOf(c CheckResult) (Diagnostics, error) {
	output, err := os.ReadFile(c.OutputArtifact)
	if err != nil {
		return nil, err
	}
	return ParseDiagnostics(c.Diagnostics, string(output), c.Passed)
}

// CaptureLineOfScrimmage measures the complete diagnostics of every check
// that has a parser, BEFORE the builder starts. Tests and build are checked
// after the builder; their failures must never become an accepted baseline.
func CaptureLineOfScrimmage(p Pitch) (LineOfScrimmage, error) {
	p.Note("line of scrimmage: measuring complete lint and TypeScript diagnostics")
	line := LineOfScrimmage{}
	var parts []string
	for _, spec := range p.Checks() {
		if spec.Diagnostics == "" {
			continue
		}
		check := RunCheck(p, spec)
		found, err := diagnosticsOf(check)
		if err != nil {
			return nil, err
		}
		line[spec.Name] = found
		parts = append(parts, fmt.Sprintf("%s=%d", spec.Name, found.Total()))
	}
	p.Note("line of scrimmage captured  " + strings.Join(parts, "  "))
	return line, nil
}

// RunQuality runs every check and judges the result.
//
// STRICT (line == nil): every check must exit 0.
//
// PROGRESSIVE (a line of scrimmage): a check with a parser passes if no NEW
// diagnostic identity appears; the others still need a clean exit. An equal
// total with different diagnostics is red. This is the gate that makes
// quest-by-quest cleanup possible: what is measured is whether the quest
// moved the needle forward or backward.
//
// Checks run in config order (fast first by convention), and a build check
// is deferred while any typecheck check is failing, because a build runs the
// same typecheck and cannot complete in that state.
func RunQuality(p Pitch, line LineOfScrimmage) (Result, error) {
	var checks []CheckResult
	typecheckOK := true
	var builds []boardroom.QACheck
	for _, spec := range p.Checks() {
		if spec.Operation == "build" {
			builds = append(builds, spec)
			continue
		}
		check := RunCheck(p, spec)
		if spec.Operation == "typecheck" && !check.Passed {
			typecheckOK = false
		}
		checks = append(checks, check)
	}
	if typecheckOK {
		for _, spec := range builds {
			checks = append(checks, RunCheck(p, spec))
		}
	} else if len(builds) > 0 {
		p.Note("qa build: deferred until typecheck passes")
	}

	current := map[string]Diagnostics{}
	counts := map[string]int{}
	for _, c := range checks {
		if c.Diagnostics == "" {
			continue
		}
		found, err := diagnosticsOf(c)
		if err != nil {
			return Result{}, err
		}
		current[c.Name] = found
		counts[c.Name] = found.Total()
	}

	failures := []string{}
	if line == nil {
		for _, c := range checks {
			if !c.Passed {
				failures = append(failures, failureText(c))
			}
		}
	} else {
		for _, c := range checks {
			var added Diagnostics
			if found, has := current[c.Name]; has {
				added = NewDiagnostics(found, line[c.Name])
			}
			_, parsed := current[c.Name]
			if len(added) > 0 || (!parsed && !c.Passed) {
				detail := fmt.Sprintf("`%s` exited %d\n%s", c.Command, c.ReturnCode, c.OutputTail)
				if len(added) > 0 {
					elements := added.Elements()
					if len(elements) > 10 {
						elements = elements[:10]
					}
					detail = "new diagnostics: " + pyList(elements)
				}
				failures = append(failures, strings.TrimRight(fmt.Sprintf("%s: REGRESSED — %s\nFull output: %s",
					c.Name, detail, c.OutputArtifact), " \n\t"))
			}
		}
	}
	announce(p, checks, failures, counts, line)
	var artifacts []string
	for _, c := range checks {
		artifacts = append(artifacts, c.OutputArtifact)
	}
	if checks == nil {
		checks = []CheckResult{}
	}
	if artifacts == nil {
		artifacts = []string{}
	}
	return Result{Passed: len(failures) == 0, Checks: checks, Failures: failures, Artifacts: artifacts}, nil
}

func pyList(items []string) string {
	quoted := make([]string, len(items))
	for i, s := range items {
		quoted[i] = "'" + s + "'"
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

// announce prints the loud one-line verdict, with each check's delta in
// progressive mode ("lint: 847→721 (-126)") so progress is visible even when
// the absolute number still looks big.
func announce(p Pitch, checks []CheckResult, failures []string, counts map[string]int, line LineOfScrimmage) {
	passed := 0
	var marks []string
	for _, c := range checks {
		mark := "✗"
		if c.Passed {
			mark = "✓"
			passed++
		}
		marks = append(marks, mark+" "+c.Name)
	}
	delta := ""
	if line != nil {
		var parts []string
		for _, c := range checks {
			current, has := counts[c.Name]
			if !has {
				continue
			}
			base := line[c.Name].Total()
			switch d := current - base; {
			case d == 0:
				parts = append(parts, fmt.Sprintf("%s: %d (±0)", c.Name, current))
			case d < 0:
				parts = append(parts, fmt.Sprintf("%s: %d→%d (%d)", c.Name, base, current, d))
			default:
				parts = append(parts, fmt.Sprintf("%s: %d→%d (+%d)", c.Name, base, current, d))
			}
		}
		delta = "  " + strings.Join(parts, "  ")
	}
	head := fmt.Sprintf("qa: %d/%d passed  %s", passed, len(checks), strings.Join(marks, " "))
	switch {
	case len(failures) == 0 && line == nil:
		p.Note(head + delta + "  — safe to proceed")
	case len(failures) == 0:
		p.Note(head + delta + "  — quest did not regress — safe to proceed")
	case line == nil:
		p.Note(fmt.Sprintf("%s  — %d failing block(s), NEEDS HUMAN REVIEW before commit", head, len(failures)))
	default:
		p.Note(fmt.Sprintf("%s%s  — %d REGRESSION(s), NEEDS HUMAN REVIEW before commit", head, delta, len(failures)))
	}
}
