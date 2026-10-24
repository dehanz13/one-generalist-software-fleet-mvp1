package demo

import (
	"os"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/club"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// The helpers below build scripted turns. A step that changes a file
// (write, edit, remove, a real bash command) changes it for real in the
// sample repo, so official reviews, the restricted area, qa and git judge
// real work. Read results are taken from the file as it is when the script
// is built, which is just before its match starts.

// spend is a turn's token use: input, output, cache read, cache write,
// reasoning, and the dollar total.
type spend struct {
	in, out, cacheRead, cacheWrite, reasoning int
	cost                                      float64
}

func turn(reply any, s spend, think time.Duration, steps ...club.Step) club.Turn {
	t := club.Turn{Steps: steps, ThinkMS: int(think / time.Millisecond), Reply: replyText(reply)}
	t.Usage.Input, t.Usage.Output = s.in, s.out
	t.Usage.CacheRead, t.Usage.CacheWrite, t.Usage.Reasoning = s.cacheRead, s.cacheWrite, s.reasoning
	t.Usage.Cost = s.cost
	return t
}

// replyText renders a report as the JSON a player sends, fenced the way
// models often fence it, so the extraction path is exercised too.
func replyText(reply any) string {
	switch r := reply.(type) {
	case string:
		return r
	case reports.Report:
		return "Done. Here is my match report:\n\n```json\n" + reports.Pretty(r) + "\n```\n"
	}
	return reports.PrettyJSON(reply)
}

func fileText(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return "(no such file)"
	}
	return string(data)
}

func read(path string, ms int) club.Step {
	return club.Step{Tool: "read", Args: map[string]any{"path": path}, Result: fileText(path), DurationMS: ms}
}

func grep(pattern, path, result string, ms int) club.Step {
	return club.Step{Tool: "grep", Args: map[string]any{"pattern": pattern, "path": path}, Result: result, DurationMS: ms}
}

func ls(path string, ms int) club.Step {
	return club.Step{Tool: "ls", Args: map[string]any{"path": path}, Run: "ls -1 " + path, DurationMS: ms}
}

// bash runs a real command; its output is the step's result.
func bash(command string, ms int) club.Step {
	return club.Step{Tool: "bash", Args: map[string]any{"command": command}, Run: command, DurationMS: ms}
}

func write(path, content string, ms int) club.Step {
	return club.Step{Tool: "write", Args: map[string]any{"path": path, "content": content},
		Write: &club.FileWrite{Path: path, Content: content}, DurationMS: ms}
}

// edit replaces old with new in the file as it is when the step runs.
func edit(path, old, replacement string, ms int) club.Step {
	return club.Step{Tool: "edit", Args: map[string]any{"path": path, "oldText": old, "newText": replacement},
		Edit: &club.FileEdit{Path: path, Old: old, New: replacement}, DurationMS: ms}
}

func remove(path string, ms int) club.Step {
	return club.Step{Tool: "bash", Args: map[string]any{"command": "rm " + path}, Delete: path, DurationMS: ms}
}

// ── report builders ─────────────────────────────────────────────────────────

func base(summary, notes string, artifacts ...string) reports.MatchReport {
	if artifacts == nil {
		artifacts = []string{}
	}
	return reports.MatchReport{Status: reports.Touchdown, Summary: summary, Artifacts: artifacts, NotesForNextPlayer: notes}
}

func talkReport(summary, slug, ruling, reason, commit, notes string) *reports.TalkReport {
	r := &reports.TalkReport{MatchReport: base(summary, notes, "{{torch_pass_dir}}/plan.md", "specs/{{match_id}}_"+slug+".md"),
		CommitMessage: commit, Ruling: ruling, RulingReason: reason}
	return r
}

func attackReport(summary, commit, notes string, changed ...string) *reports.AttackReport {
	return &reports.AttackReport{MatchReport: base(summary, notes), ChangedFiles: changed, CommitMessage: commit}
}

func analystReport(summary string, findings ...reports.AnalystFinding) *reports.AnalystReport {
	return &reports.AnalystReport{MatchReport: base(summary, "", "{{torch_pass_dir}}/ranger_findings.md"), Findings: findings}
}

func finding(file, note string) reports.AnalystFinding {
	return reports.AnalystFinding{File: file, Note: note}
}

func varReport(summary string, approved bool, blocking []string, findings ...reports.VarFinding) *reports.VarReport {
	if blocking == nil {
		blocking = []string{}
	}
	notes := "Approved: verify with sh scripts/test.sh."
	if !approved {
		notes = "Fix every blocking item, then report again."
	}
	return &reports.VarReport{MatchReport: base(summary, notes, "{{torch_pass_dir}}/review.md"),
		Approved: approved, Findings: findings, Blocking: blocking}
}

func met(requirement, evidence string) reports.VarFinding {
	return reports.VarFinding{Requirement: requirement, Met: true, Evidence: evidence}
}

func unmet(requirement, evidence string) reports.VarFinding {
	return reports.VarFinding{Requirement: requirement, Met: false, Evidence: evidence}
}

func bardReport(summary, slug, commit string, documented ...string) *reports.BardReport {
	path := "app_docs/{{match_id}}_" + slug + ".md"
	return &reports.BardReport{MatchReport: base(summary, "", "{{torch_pass_dir}}/document.md", path),
		DocumentPath: path, DocumentedFiles: documented, CommitMessage: commit}
}

// planSteps are the playmaker's usual moves: look around, write the plan,
// copy it under specs/.
func planSteps(slug, plan string, looks ...club.Step) []club.Step {
	steps := append([]club.Step{ls("src", 600), bash("ls specs 2>/dev/null || echo '(no specs yet)'", 400)}, looks...)
	return append(steps,
		write("{{torch_pass_dir}}/plan.md", plan, 2400),
		bash(`mkdir -p specs && cp "{{torch_pass_dir}}/plan.md" "specs/{{match_id}}_`+slug+`.md"`, 300),
	)
}
