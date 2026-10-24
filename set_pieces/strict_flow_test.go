package setpieces

// Ported from legacy/adws/tests/test_strict_flow.py: run-mythic's control
// flow, driven by scripted players and scripted checks.
//
// No model is called and no command runs: the players, the qa gate, the
// contract and git are replaced, so what is under test is only the ORDER the
// set piece does things in and what it refuses to do. That order is where
// money goes: a match once paid for four objectives after its planner had
// already found there was nothing to build.
//
// Legacy's three failures here came from the script asking real git for the
// current commit; the Go set piece takes git through Deps, so the fake
// answers and the tests no longer depend on where they run.

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/contract"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/qa"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// fakeRun is just enough of a match: objectives, a scripted player, a verdict.
type fakeRun struct {
	objectives []string
	calls      []call
	reports    []reports.Report
	finished   *finished
}

type call struct {
	objective string
	previous  reports.Report
}

type finished struct {
	accepted bool
	reason   string
}

func (f *fakeRun) ID() string           { return "abcdef123456" }
func (f *fakeRun) Founder() string      { return "tester" }
func (f *fakeRun) TorchPassDir() string { return "/nonexistent/torch_pass" }

func (f *fakeRun) Objective(p match.Params, fn func(h match.Handle) error) error {
	f.objectives = append(f.objectives, p.Name)
	return fn(&fakeHandle{run: f, name: p.Name})
}

func (f *fakeRun) Finish(accepted bool, reason string) int {
	f.finished = &finished{accepted, reason}
	if accepted {
		return 0
	}
	return 1
}

type fakeHandle struct {
	run  *fakeRun
	name string
}

func (h *fakeHandle) Log(...any) {}

func (h *fakeHandle) Call(c match.Call) (reports.Report, error) {
	h.run.calls = append(h.run.calls, call{h.name, c.Previous})
	if len(h.run.reports) == 0 {
		return nil, fmt.Errorf("no scripted report left for %s", h.name)
	}
	next := h.run.reports[0]
	h.run.reports = h.run.reports[1:]
	return next, nil
}

func talk(summary, rulingName, reason string) *reports.TalkReport {
	r := &reports.TalkReport{Ruling: rulingName, RulingReason: reason}
	r.Status, r.Summary = reports.Touchdown, summary
	return r
}

func plan() *reports.TalkReport { return talk("plan it", "implement", "") }

func build() *reports.AttackReport {
	r := &reports.AttackReport{CommitMessage: "Make the onboarding tests lint-clean.\n\nBody stays."}
	r.Status, r.Summary = reports.Touchdown, "Did the work."
	return r
}

var (
	green = qa.Result{Passed: true}
	red   = qa.Result{Passed: false, Failures: []string{"lint: REGRESSED"}}
)

type outcome struct {
	code         int
	run          *fakeRun
	committed    []string
	qualityLeft  int
	contractLeft int
}

func drive(t *testing.T, scripted []reports.Report, contracts [][]string, gates []qa.Result) outcome {
	t.Helper()
	run := &fakeRun{reports: scripted}
	var committed []string
	d := &Deps{
		LoadConfig: func() (*boardroom.Config, error) {
			cfg := boardroom.Default()
			cfg.Defaults.DataDir = "x"
			return cfg, nil
		},
		Validate:       func(*boardroom.Config, []string) error { return nil },
		Ensure:         func(*boardroom.Config, string, string) (match.Runner, error) { return run, nil },
		IsDirty:        func() (bool, error) { return false, nil },
		Rev:            func(string) (string, error) { return "base0000", nil },
		UncommitTo:     func(string) ([]string, error) { return nil, nil },
		CommitAll:      func(m string) (string, error) { committed = append(committed, m); return "abc1234", nil },
		ShouldReverify: func(string, string) bool { return false },
		CaptureLine:    func(match.Runner) (qa.LineOfScrimmage, error) { return qa.LineOfScrimmage{}, nil },
		RunQuality: func(match.Runner, qa.LineOfScrimmage) (qa.Result, error) {
			if len(gates) == 0 {
				t.Fatal("the qa gate ran more often than scripted")
			}
			next := gates[0]
			gates = gates[1:]
			return next, nil
		},
		VerifyContract: func(*contract.QuestContract, match.Runner) ([]string, []string) {
			if len(contracts) == 0 {
				t.Fatal("the scope check ran more often than scripted")
			}
			next := contracts[0]
			contracts = contracts[1:]
			return next, []string{"examined"}
		},
		RestorePlanCopy: func(string, *reports.TalkReport) []string { return nil },
	}
	code, err := runMythic(d, Args{Prompt: "a prompt with no ogsf block"})
	if err != nil {
		t.Fatal(err)
	}
	return outcome{code, run, committed, len(gates), len(contracts)}
}

func TestANoopVerdictStopsBeforeBaselineAndBuilder(t *testing.T) {
	out := drive(t, []reports.Report{talk("already merged", "noop", "PR #675 merged it"), build()},
		[][]string{{}}, []qa.Result{green})
	if !reflect.DeepEqual(out.run.objectives, []string{"ask", "spec"}) {
		t.Fatalf("objectives %v", out.run.objectives)
	}
	if out.code != 1 { // visible, never a quiet success
		t.Fatalf("exit %d", out.code)
	}
	if !strings.Contains(out.run.finished.reason, "PR #675 merged it") {
		t.Fatalf("reason %q", out.run.finished.reason)
	}
	if len(out.committed) != 0 || out.qualityLeft != 1 { // the slow gate never ran
		t.Fatalf("committed %v, gate runs left %d", out.committed, out.qualityLeft)
	}
}

func TestABlockedVerdictStopsTheSameWay(t *testing.T) {
	out := drive(t, []reports.Report{talk("target unreachable", "blocked", "the method cannot reach the target")}, nil, nil)
	if !reflect.DeepEqual(out.run.objectives, []string{"ask", "spec"}) || out.code != 1 {
		t.Fatalf("objectives %v, exit %d", out.run.objectives, out.code)
	}
	if !strings.Contains(out.run.finished.reason, "cannot be built as specified") {
		t.Fatalf("reason %q", out.run.finished.reason)
	}
}

func TestTheGreenPathCommitsOnceWithAConventionalHeader(t *testing.T) {
	out := drive(t, []reports.Report{plan(), build()}, [][]string{{}}, []qa.Result{green})
	want := []string{"ask", "spec", "benchmark", "build", "scope_check_1", "qa_1", "ship"}
	if !reflect.DeepEqual(out.run.objectives, want) {
		t.Fatalf("objectives %v, want %v", out.run.objectives, want)
	}
	if out.code != 0 || len(out.committed) != 1 {
		t.Fatalf("exit %d, commits %v", out.code, out.committed)
	}
	head, body, _ := strings.Cut(out.committed[0], "\n")
	if head != "chore(ogsf-abcdef12): make the onboarding tests lint-clean" {
		t.Fatalf("header %q", head)
	}
	if body != "\nBody stays." {
		t.Fatalf("body %q", body)
	}
}

func TestAContractFailureSkipsTheSlowGateAndGoesToTheBuilder(t *testing.T) {
	hook := "pre-commit hook (.husky/pre-commit) exited 1"
	out := drive(t, []reports.Report{plan(), build(), build()}, [][]string{{hook}, {}}, []qa.Result{green})
	want := []string{"ask", "spec", "benchmark", "build",
		"scope_check_1", "iterate_1", // no qa_1: the tree cannot be shipped
		"scope_check_2", "qa_2", "ship"}
	if !reflect.DeepEqual(out.run.objectives, want) {
		t.Fatalf("objectives %v, want %v", out.run.objectives, want)
	}
	var fixInput reports.Report
	for _, c := range out.run.calls {
		if c.objective == "iterate_1" {
			fixInput = c.previous
		}
	}
	qaReport, ok := fixInput.(*reports.QaReport)
	if !ok || !reflect.DeepEqual(qaReport.Failures, []string{hook}) { // verbatim, not summarised
		t.Fatalf("iterate_1 was handed %#v", fixInput)
	}
	if out.code != 0 {
		t.Fatalf("exit %d", out.code)
	}
}

func TestThreeRedLoopsEndWithoutACommit(t *testing.T) {
	out := drive(t, []reports.Report{plan(), build(), build(), build()},
		[][]string{{}, {}, {}}, []qa.Result{red, red, red})
	if len(out.committed) != 0 || out.code != 1 {
		t.Fatalf("committed %v, exit %d", out.committed, out.code)
	}
	count := map[string]int{}
	for _, o := range out.run.objectives {
		count[o]++
	}
	if count["ship"] != 0 {
		t.Fatal("a red quest shipped")
	}
	if count["iterate_1"]+count["iterate_2"] != 2 || count["iterate_3"] != 0 { // bounded: no fourth builder call
		t.Fatalf("objectives %v", out.run.objectives)
	}
}
