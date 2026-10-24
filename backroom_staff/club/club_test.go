package club

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/abandoned"
)

// A recorded pi stream: one tool call announced in a message, executed, then
// the final answer. The fake "pi" is a shell script that prints it.
var stream = []map[string]any{
	{"type": "agent_start"},
	{"type": "message_end", "message": map[string]any{"role": "assistant", "stopReason": "toolUse",
		"content": []any{map[string]any{"type": "toolCall", "id": "c1", "name": "bash", "arguments": map[string]any{"command": "ls -la src"}}},
		"usage":   map[string]any{"input": 100, "output": 20, "cacheRead": 1000, "cacheWrite": 50, "totalTokens": 1170, "cost": map[string]any{"total": 0.01}}}},
	{"type": "tool_execution_start", "toolCallId": "c1", "toolName": "bash", "args": map[string]any{"command": "ls -la src"}},
	{"type": "tool_execution_end", "toolCallId": "c1", "toolName": "bash", "isError": false,
		"result": map[string]any{"content": []any{map[string]any{"type": "text", "text": "a.go\nb.go"}}}},
	{"type": "message_end", "message": map[string]any{"role": "assistant", "stopReason": "stop",
		"content": []any{map[string]any{"type": "text", "text": `{"status": "touchdown"}`}},
		"usage":   map[string]any{"input": 50, "output": 30, "cacheRead": 1200, "cacheWrite": 0, "reasoning": 10, "cost": map[string]any{"total": 0.02}}}},
}

func fakeClub(t *testing.T, events []map[string]any, exit int) string {
	t.Helper()
	dir := t.TempDir()
	var lines []string
	for _, e := range events {
		data, _ := json.Marshal(e)
		lines = append(lines, string(data))
	}
	data := filepath.Join(dir, "stream.jsonl")
	os.WriteFile(data, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
	script := filepath.Join(dir, "club.sh")
	os.WriteFile(script, []byte("#!/bin/sh\ncat "+data+"\necho 'boom' >&2\nexit "+string(rune('0'+exit))+"\n"), 0o755)
	return script
}

func TestTheStreamIsFoldedIntoOneResultAndOneCastPerCall(t *testing.T) {
	raw := filepath.Join(t.TempDir(), "raw_output.jsonl")
	cmd := exec.CommandContext(context.Background(), fakeClub(t, stream, 0))
	tracker := NewToolCallTracker()
	var casts []*CallRecord
	result, err := streamJSONL(cmd, raw, Hooks{OnEvent: func(e map[string]any) {
		if r := tracker.Observe(e); r != nil {
			casts = append(casts, r)
		}
	}}, Result{SessionID: "s"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != `{"status": "touchdown"}` {
		t.Errorf("text %q", result.Text)
	}
	// totalTokens on the first turn, the sum of the parts on the second.
	if result.Tokens != 1170+1280 || result.ContextTokens != 1280 {
		t.Errorf("tokens %d, context %d", result.Tokens, result.ContextTokens)
	}
	if result.Usage.ReasoningTokens != 10 || result.Usage.InputTokens != 150 || result.Cost < 0.0299 {
		t.Errorf("usage %+v cost %v", result.Usage, result.Cost)
	}
	if len(casts) != 1 || casts[0].Label != "bash: ls -la src" || casts[0].Payload["result_snippet"] != "a.go\nb.go" {
		t.Fatalf("casts %+v", casts)
	}
	if data, _ := os.ReadFile(raw); strings.Count(string(data), "\n") != len(stream) {
		t.Error("the raw stream was not kept line for line")
	}
}

func TestAProviderErrorWithNoTextIsAMatchAbandoned(t *testing.T) {
	events := []map[string]any{{"type": "message_end", "message": map[string]any{"role": "assistant",
		"stopReason": "error", "errorMessage": "You have no credits remaining.", "content": []any{}, "usage": map[string]any{}}}}
	cmd := exec.Command(fakeClub(t, events, 1))
	_, err := streamJSONL(cmd, filepath.Join(t.TempDir(), "raw.jsonl"), Hooks{}, Result{})
	if !abandoned.Is(err) || !strings.Contains(err.Error(), "no credits") {
		t.Fatalf("got %v", err)
	}
}

func TestANonZeroExitWithNoTextCarriesStderr(t *testing.T) {
	cmd := exec.Command(fakeClub(t, []map[string]any{{"type": "agent_start"}}, 3))
	_, err := streamJSONL(cmd, filepath.Join(t.TempDir(), "raw.jsonl"), Hooks{}, Result{})
	if err == nil || !strings.Contains(err.Error(), "exited 3") || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("got %v", err)
	}
}

func TestTheScriptedClubPlaysTurnsInOrderAndMakesRealChanges(t *testing.T) {
	dir := t.TempDir()
	s := NewScripted()
	s.Use(&Script{Players: map[string][]Turn{"builder": {
		{Steps: []Step{{Tool: "write", Args: map[string]any{"path": "{{torch_pass_dir}}/x.md"}, Write: &FileWrite{Path: "{{torch_pass_dir}}/x.md", Content: "hi {{match_id}}"}},
			{Tool: "edit", Edit: &FileEdit{Path: "{{torch_pass_dir}}/x.md", Old: "hi", New: "hello"}}},
			Reply: `{"status": "touchdown"}`},
	}}})
	req := Request{Player: "builder", Cwd: dir, RawOutputPath: filepath.Join(dir, "raw.jsonl"),
		Vars: map[string]string{"torch_pass_dir": "tp", "match_id": "m1"}}
	casts := 0
	tracker := NewToolCallTracker()
	result, err := s.Run(context.Background(), req, Hooks{OnEvent: func(e map[string]any) {
		if tracker.Observe(e) != nil {
			casts++
		}
	}})
	if err != nil || result.Text != `{"status": "touchdown"}` {
		t.Fatalf("got %+v, %v", result, err)
	}
	if data, _ := os.ReadFile(filepath.Join(dir, "tp", "x.md")); string(data) != "hello m1" {
		t.Fatalf("file %q", data)
	}
	if casts != 2 {
		t.Fatalf("%d casts", casts)
	}
	if _, err := s.Run(context.Background(), req, Hooks{}); err == nil {
		t.Fatal("a player with no turn left played")
	}
}

func TestPiCountsReadTheCompactForm(t *testing.T) {
	for in, want := range map[string]int{"272K": 272_000, "1.0M": 1_000_000, "8192": 8192} {
		if got, err := parseCount(in); err != nil || got != want {
			t.Errorf("parseCount(%q) = %d, %v", in, got, err)
		}
	}
}
