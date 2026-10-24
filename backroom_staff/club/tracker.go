package club

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
)

const (
	// ResultSnippetChars: tool output rides along whole; the clip only guards
	// pathological cases.
	ResultSnippetChars = 20_000
	// ArgValueChars: arguments too. The page scrolls; it must not be handed
	// cut-off data.
	ArgValueChars = 20_000
	// LabelChars: "bash: <command>" shown as the event name.
	LabelChars = 80
)

// PrimaryArgs is the argument that identifies a call at a glance, in the
// order tools tend to use.
var PrimaryArgs = []string{"command", "path", "file_path", "pattern", "query", "url"}

// Label is a tool call's one-line name: `bash: ls -la src`.
func Label(tool string, args map[string]any) string {
	value := ""
	for _, key := range PrimaryArgs {
		if s, ok := args[key].(string); ok && strings.TrimSpace(s) != "" {
			value = s
			break
		}
	}
	if value == "" {
		keys := make([]string, 0, len(args))
		for k := range args {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if s, ok := args[k].(string); ok && strings.TrimSpace(s) != "" {
				value = s
				break
			}
		}
	}
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return tool
	}
	return tool + ": " + kit.Clip(value, LabelChars)
}

type openCall struct {
	tool      string
	args      map[string]any
	startedAt string
	clock     time.Time
}

// ToolCallTracker folds a club's tool stream into ONE record per completed
// call. A call is announced as a `toolCall` content block, then
// tool_execution_start / _update / _end; only the end carries the result, so
// that is where a record is emitted: one ability cast per real tool call, the
// moment it returns. The record carries the call's real span, which the feed
// writes to columns so the page lays calls on a time axis.
type ToolCallTracker struct {
	open map[string]openCall
}

// NewToolCallTracker returns an empty tracker.
func NewToolCallTracker() *ToolCallTracker {
	return &ToolCallTracker{open: map[string]openCall{}}
}

// CallRecord is one finished tool call.
type CallRecord struct {
	Label     string
	StartedAt string
	EndedAt   string
	Payload   map[string]any // tool, tool_call_id, args, ok, result_snippet, duration_ms
}

// Observe returns the record for a finished tool call, else nil.
func (t *ToolCallTracker) Observe(event map[string]any) *CallRecord {
	etype, _ := event["type"].(string)
	switch etype {
	case "message_end":
		message, _ := event["message"].(map[string]any)
		blocks, _ := message["content"].([]any)
		for _, item := range blocks {
			block, ok := item.(map[string]any)
			if ok && block["type"] == "toolCall" {
				args, _ := block["arguments"].(map[string]any)
				t.announce(str(block["id"]), str(block["name"]), args)
			}
		}
		return nil
	case "tool_execution_start":
		args, _ := event["args"].(map[string]any)
		t.announce(str(event["toolCallId"]), str(event["toolName"]), args)
		return nil
	case "tool_execution_end":
	default:
		return nil
	}

	callID := str(event["toolCallId"])
	opened, had := t.open[callID]
	delete(t.open, callID)
	tool := str(event["toolName"])
	if tool == "" {
		tool = opened.tool
	}
	if tool == "" {
		tool = "tool"
	}
	args, _ := event["args"].(map[string]any)
	if len(args) == 0 {
		args = opened.args
	}
	if args == nil {
		args = map[string]any{}
	}
	clipped := make(map[string]any, len(args))
	for k, v := range args {
		if s, ok := v.(string); ok {
			clipped[k] = kit.Clip(s, ArgValueChars)
		} else {
			clipped[k] = v
		}
	}
	isError, _ := event["isError"].(bool)
	payload := map[string]any{"tool": tool, "tool_call_id": callID, "args": clipped, "ok": !isError}
	result, _ := event["result"].(map[string]any)
	if text := TextOf(result); text != "" {
		payload["result_snippet"] = kit.Clip(text, ResultSnippetChars)
	}
	record := &CallRecord{Label: Label(tool, args), EndedAt: kit.NowISO(), Payload: payload}
	if had && !opened.clock.IsZero() {
		payload["duration_ms"] = int(kit.Since(opened.clock) / time.Millisecond)
	}
	if had && opened.startedAt != "" {
		record.StartedAt = opened.startedAt
	}
	return record
}

// announce starts the clock on the first sighting; a later one fills gaps only.
func (t *ToolCallTracker) announce(callID, tool string, args map[string]any) {
	if callID == "" {
		return
	}
	known := t.open[callID]
	next := openCall{tool: tool, args: args, startedAt: known.startedAt, clock: known.clock}
	if next.tool == "" {
		next.tool = known.tool
	}
	if len(next.args) == 0 {
		next.args = known.args
	}
	if next.startedAt == "" {
		next.startedAt = kit.NowISO()
		next.clock = kit.Now()
	}
	t.open[callID] = next
}

// str is Python's str() for the values a JSON id can hold.
func str(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case float64:
		return strconv.FormatFloat(s, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(s)
	}
	return ""
}
