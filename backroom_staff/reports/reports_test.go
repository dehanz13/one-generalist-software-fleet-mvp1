package reports

import (
	"strings"
	"testing"
)

func TestExtractJSONPrefersTheFirstFencedObject(t *testing.T) {
	text := "Done.\n```bash\nls\n```\n```json\n{\"status\": \"touchdown\", \"summary\": \"a\"}\n```\ntrailing {not json}"
	got, err := ExtractJSON(text)
	if err != nil || got["summary"] != "a" {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestExtractJSONFallsBackToTheOutermostBraces(t *testing.T) {
	got, err := ExtractJSON(`Here: {"status": "touchdown", "nested": {"x": 1}} thanks`)
	if err != nil || got["status"] != "touchdown" {
		t.Fatalf("got %v, %v", got, err)
	}
	if _, err := ExtractJSON("no object at all"); err == nil {
		t.Fatal("prose was accepted")
	}
}

func TestParseRequiresAStatusAndAKnownRuling(t *testing.T) {
	if _, err := Parse("TalkReport", map[string]any{"summary": "x"}); err == nil {
		t.Fatal("a report without status parsed")
	}
	if _, err := Parse("TalkReport", map[string]any{"status": "success"}); err == nil {
		t.Fatal("a legacy status word parsed")
	}
	if _, err := Parse("TalkReport", map[string]any{"status": "touchdown", "ruling": "maybe"}); err == nil {
		t.Fatal("an unknown ruling parsed")
	}
	r, err := Parse("TalkReport", map[string]any{"status": "touchdown", "extra": "ignored"})
	if err != nil || r.(*TalkReport).Ruling != "implement" {
		t.Fatalf("defaults not applied: %v, %v", r, err)
	}
}

func TestParseRefusesAFindingWithoutItsKeyField(t *testing.T) {
	_, err := Parse("VarReport", map[string]any{"status": "touchdown", "findings": []any{map[string]any{"met": true}}})
	if err == nil || !strings.Contains(err.Error(), "requirement") {
		t.Fatalf("got %v", err)
	}
	if _, err := Parse("AttackReport", map[string]any{"status": "touchdown", "changed_files": "a.go"}); err == nil {
		t.Fatal("a string where a list belongs parsed")
	}
}

func TestPrettyNeverWritesNullListsOrEscapedHTML(t *testing.T) {
	text := Pretty(&AttackReport{MatchReport: MatchReport{Status: Touchdown, Summary: "a < b && c"}})
	if strings.Contains(text, "null") || strings.Contains(text, "\\u003c") || !strings.Contains(text, "a < b && c") {
		t.Fatalf("got %s", text)
	}
}

func TestFieldNamesListTheSharedFieldsFirst(t *testing.T) {
	got := strings.Join(FieldNames("TalkReport"), ",")
	if got != "status,summary,artifacts,notes_for_next_player,commit_message,ruling,ruling_reason" {
		t.Fatalf("got %s", got)
	}
}
