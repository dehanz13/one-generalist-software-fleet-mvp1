// Package reports holds the match reports: the typed JSON every player hands
// back, and the two that code builds so a player can be handed a diff or a
// failing check through the same door. (Legacy: the envelope types in
// adw_modules/data_types.py.)
//
// Every player call declares the report type it must answer with. There are
// no untyped hand-overs.
package reports

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
)

// The two ways a report, an objective or a match can end.
const (
	Touchdown = "touchdown"
	Turnover  = "turnover"
)

// Report is any match report.
type Report interface {
	// Base is the part every report shares.
	Base() *MatchReport
	// TypeName is the name the player is told to answer with, e.g. "TalkReport".
	TypeName() string
}

// MatchReport is the base of every report. (Legacy: EnvelopeBase.)
type MatchReport struct {
	Status             string   `json:"status"`
	Summary            string   `json:"summary"`
	Artifacts          []string `json:"artifacts"`
	NotesForNextPlayer string   `json:"notes_for_next_player"`
}

// Base returns the shared part of a report.
func (m *MatchReport) Base() *MatchReport { return m }

// GenericReport is a report with nothing beyond the base.
type GenericReport struct {
	MatchReport
}

// TypeName implements Report.
func (*GenericReport) TypeName() string { return "GenericReport" }

// TalkReport is the playmaker's plan. (Legacy: PlanOutput.)
type TalkReport struct {
	MatchReport
	// The subject for committing the PLAN, the spec file the playmaker wrote,
	// not the implementation it describes.
	CommitMessage string `json:"commit_message"`
	// Whether the request leaves code to write: "noop" when the work is
	// already done, "blocked" when it cannot be done as asked. Either ends the
	// match before the builder spends a token.
	Ruling       string `json:"ruling"`
	RulingReason string `json:"ruling_reason"`
}

// TypeName implements Report.
func (*TalkReport) TypeName() string { return "TalkReport" }

// AttackReport is the builder's report. (Legacy: BuildOutput.)
type AttackReport struct {
	MatchReport
	ChangedFiles  []string `json:"changed_files"`
	CommitMessage string   `json:"commit_message"`
}

// TypeName implements Report.
func (*AttackReport) TypeName() string { return "AttackReport" }

// AnalystFinding is one place the ranger found. (Legacy: ScoutFinding.)
type AnalystFinding struct {
	File string `json:"file"`
	Note string `json:"note"`
}

// AnalystReport is the ranger's report. (Legacy: ScoutOutput.)
type AnalystReport struct {
	MatchReport
	Findings []AnalystFinding `json:"findings"`
}

// TypeName implements Report.
func (*AnalystReport) TypeName() string { return "AnalystReport" }

// VarFinding is one thing the request asked for, and whether it is there.
// (Legacy: ReviewFinding.)
type VarFinding struct {
	Requirement string `json:"requirement"`
	Met         bool   `json:"met"`
	Evidence    string `json:"evidence"`
}

// VarReport confirms that what was built is what was asked for. It is not a
// test run. (Legacy: ReviewOutput.)
type VarReport struct {
	MatchReport
	Approved bool         `json:"approved"`
	Findings []VarFinding `json:"findings"`
	Blocking []string     `json:"blocking"`
}

// TypeName implements Report.
func (*VarReport) TypeName() string { return "VarReport" }

// BardReport says where the write-up of a finished change landed.
// (Legacy: DocumentOutput.)
type BardReport struct {
	MatchReport
	DocumentPath    string   `json:"document_path"`
	DocumentedFiles []string `json:"documented_files"`
	CommitMessage   string   `json:"commit_message"`
}

// TypeName implements Report.
func (*BardReport) TypeName() string { return "BardReport" }

// ChangesReport is a captured diff shaped as a report, so the bard can be
// handed it directly. Built by code. (Legacy: ChangesOutput.)
type ChangesReport struct {
	MatchReport
	BaseRef      string   `json:"base"`
	ChangedFiles []string `json:"changed_files"`
	Insertions   int      `json:"insertions"`
	Deletions    int      `json:"deletions"`
	Stat         string   `json:"stat"`
	DiffPath     string   `json:"diff_path"`
}

// TypeName implements Report.
func (*ChangesReport) TypeName() string { return "ChangesReport" }

// QaReport is a deterministic result shaped as a report, so a failing check
// flows back into the builder through the same door a player's report does.
// Built by code. (Legacy: VerifyOutput.)
type QaReport struct {
	MatchReport
	Passed   bool     `json:"passed"`
	Failures []string `json:"failures"`
}

// TypeName implements Report.
func (*QaReport) TypeName() string { return "QaReport" }

// New returns an empty report of the named type, or an error for a name no
// type has.
func New(typeName string) (Report, error) {
	switch typeName {
	case "GenericReport":
		return &GenericReport{}, nil
	case "TalkReport":
		return &TalkReport{Ruling: "implement"}, nil
	case "AttackReport":
		return &AttackReport{}, nil
	case "AnalystReport":
		return &AnalystReport{}, nil
	case "VarReport":
		return &VarReport{}, nil
	case "BardReport":
		return &BardReport{}, nil
	case "ChangesReport":
		return &ChangesReport{}, nil
	case "QaReport":
		return &QaReport{}, nil
	}
	return nil, fmt.Errorf("no report type %q", typeName)
}

// FieldNames lists a report type's JSON fields in declaration order, the
// shared ones first: what a player is told to send when its JSON did not fit.
func FieldNames(typeName string) []string {
	report, err := New(typeName)
	if err != nil {
		return nil
	}
	var names []string
	var walk func(t reflect.Type)
	walk = func(t reflect.Type) {
		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			if field.Anonymous {
				walk(field.Type)
				continue
			}
			names = append(names, strings.Split(field.Tag.Get("json"), ",")[0])
		}
	}
	walk(reflect.TypeOf(report).Elem())
	return names
}

// ExtractJSON finds the JSON object in a player's final reply: the first
// fenced block that starts with `{`, else the outermost braces. Ported
// line for line from legacy's _extract_json.
func ExtractJSON(text string) (map[string]any, error) {
	candidate := text
	if strings.Contains(text, "```") {
		parts := strings.Split(text, "```")
		for i := 1; i < len(parts); i += 2 {
			block := strings.TrimSpace(strings.TrimPrefix(parts[i], "json"))
			if strings.HasPrefix(block, "{") {
				candidate = block
				break
			}
		}
	}
	start, end := strings.Index(candidate, "{"), strings.LastIndex(candidate, "}")
	if start == -1 || end <= start {
		return nil, errors.New("no JSON object found in the response")
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(candidate[start:end+1]), &out); err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("the JSON is not an object")
	}
	return out, nil
}

// Parse validates a decoded JSON object against a report type: types must
// match, `status` is required and must be touchdown or turnover, enumerated
// fields must hold one of their values, and a finding must carry its key
// field. Unknown fields are ignored, as pydantic ignored them.
func Parse(typeName string, payload map[string]any) (Report, error) {
	report, err := New(typeName)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, report); err != nil {
		return nil, fmt.Errorf("%s: %w", typeName, err)
	}
	if _, ok := payload["status"]; !ok {
		return nil, fmt.Errorf("%s: field `status` is required", typeName)
	}
	if err := Validate(report); err != nil {
		return nil, err
	}
	if typeName == "VarReport" {
		if err := requireEach(payload["findings"], "requirement", "met"); err != nil {
			return nil, fmt.Errorf("%s: %w", typeName, err)
		}
	}
	if typeName == "AnalystReport" {
		if err := requireEach(payload["findings"], "file"); err != nil {
			return nil, fmt.Errorf("%s: %w", typeName, err)
		}
	}
	Normalize(report)
	return report, nil
}

// Validate checks the enumerated fields of a report.
func Validate(report Report) error {
	base := report.Base()
	if base.Status != Touchdown && base.Status != Turnover {
		return fmt.Errorf("%s: `status` must be %q or %q, got %q",
			report.TypeName(), Touchdown, Turnover, base.Status)
	}
	if talk, ok := report.(*TalkReport); ok {
		switch talk.Ruling {
		case "implement", "noop", "blocked":
		default:
			return fmt.Errorf("TalkReport: `ruling` must be implement, noop or blocked, got %q", talk.Ruling)
		}
	}
	return nil
}

func requireEach(list any, keys ...string) error {
	items, _ := list.([]any)
	for i, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return fmt.Errorf("findings[%d] is not an object", i)
		}
		for _, key := range keys {
			if _, ok := object[key]; !ok {
				return fmt.Errorf("findings[%d]: field `%s` is required", i, key)
			}
		}
	}
	return nil
}

// Normalize turns every nil list into an empty one, so a report always
// serializes `[]` and never `null`, as pydantic's defaults did.
func Normalize(report Report) {
	value := reflect.ValueOf(report).Elem()
	var walk func(v reflect.Value)
	walk = func(v reflect.Value) {
		for i := 0; i < v.NumField(); i++ {
			field := v.Field(i)
			switch {
			case field.Kind() == reflect.Struct:
				walk(field)
			case field.Kind() == reflect.Slice && field.IsNil():
				field.Set(reflect.MakeSlice(field.Type(), 0, 0))
			}
		}
	}
	walk(value)
}

// Pretty is the report as indented JSON: what the next player reads as
// `previous_report`, and what match_report.json holds.
func Pretty(report Report) string {
	Normalize(report)
	return PrettyJSON(report)
}

// PrettyJSON indents any value two spaces, without escaping <, > and & the
// way encoding/json does by default: a player reads this text.
func PrettyJSON(value any) string {
	var out strings.Builder
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return "{}"
	}
	return strings.TrimRight(out.String(), "\n")
}

// CompactJSON is a value as one line of JSON, without HTML escaping: how
// payloads are stored.
func CompactJSON(value any) string {
	var out strings.Builder
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "{}"
	}
	return strings.TrimRight(out.String(), "\n")
}

// AsMap is the report's JSON fields as a map, for merging into a record.
func AsMap(report Report) map[string]any {
	Normalize(report)
	data, _ := json.Marshal(report)
	var out map[string]any
	_ = json.Unmarshal(data, &out)
	return out
}

// CommitMessageOf returns a report's commit message, for the types that have one.
func CommitMessageOf(report Report) string {
	switch r := report.(type) {
	case *TalkReport:
		return r.CommitMessage
	case *AttackReport:
		return r.CommitMessage
	case *BardReport:
		return r.CommitMessage
	}
	return ""
}

// ChangedFilesOf returns a report's changed files, for the types that have them.
func ChangedFilesOf(report Report) []string {
	switch r := report.(type) {
	case *AttackReport:
		return r.ChangedFiles
	case *ChangesReport:
		return r.ChangedFiles
	}
	return nil
}
