package match

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/club"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/clubrules"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/console"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/officialreview"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/restrictedarea"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/teamtalks"
)

// JSONFixAttempts is how many corrections a malformed reply gets in the same session.
const JSONFixAttempts = 2

// Call is one player call: prompt in, typed report out, official reviews
// verified. (Legacy: AgentCall.)
type Call struct {
	ReportType string // "TalkReport", "AttackReport", …
	Prompt     string
	Previous   reports.Report // nil for none
	Reviews    []officialreview.Review
}

// execute is one player call: render team talks → club → typed parse →
// official reviews → restricted area → report. Parse failures and review
// violations go back into the SAME club session as corrections, context
// intact, bounded. The player proposes; code disposes. (Legacy: agents.execute.)
func (m *Match) execute(o *Objective, call Call) (reports.Report, error) {
	player, err := m.Cfg.Resolve(o.Owner)
	if err != nil {
		return nil, err
	}
	driver, err := club.For(player.Club)
	if err != nil {
		return nil, err
	}
	playerDir := filepath.Join(m.dir, player.Name)
	if err := os.MkdirAll(playerDir, 0o755); err != nil {
		return nil, err
	}
	previous := "(none)"
	if call.Previous != nil {
		previous = reports.Pretty(call.Previous)
	}
	rules, err := clubrules.Text(m.Cfg)
	if err != nil {
		return nil, err
	}
	vars := []teamtalks.Var{
		{Name: "prompt", Value: call.Prompt},
		{Name: "previous_report", Value: previous},
		{Name: "torch_pass_dir", Value: m.torchPass},
		{Name: "club_rules", Value: rules},
	}
	systemText, err := teamtalks.Render(player.TeamTalks.System, vars)
	if err != nil {
		return nil, err
	}
	userText, err := teamtalks.Render(player.TeamTalks.User, vars)
	if err != nil {
		return nil, err
	}
	talks := filepath.Join(playerDir, "team_talks")
	_, _ = teamtalks.Save(talks, "system.md", systemText)
	_, _ = teamtalks.Save(talks, "user.md", userText)
	_ = m.Feed.TeamTalkRow(m.id, player.Name, systemText, userText)

	sessionID := m.clubSessionID(player.Name, player.Model)
	var tools any // nil = all tools
	if player.Tools != nil {
		tools = player.Tools
	}
	m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "raider_start", Name: player.Name,
		Payload: map[string]any{"model": player.Model, "thinking": player.Thinking, "color": player.Color,
			"session_id": sessionID, "club": player.Club, "purpose": player.Purpose,
			"tools": tools, "enchantments": player.Enchantments}})
	m.Console.PlayerStarted(player.Name, player.Model, sessionID)

	// Parse retries and review corrections re-enter the SAME session, so the
	// last send is the one whose context occupancy is current, while spend is
	// the opposite: every send costs, so usage accumulates across all of them.
	var latest club.Result
	var spent club.Usage
	tracker := club.NewToolCallTracker()
	send := func(prompt string) (club.Result, error) {
		req := club.Request{
			Prompt: prompt, SystemPrompt: systemText, Model: player.Model, Thinking: player.Thinking,
			SessionID: sessionID,
			// absolute: the club runs in the repo root, wherever ogsf was started
			SessionDir:    abs(filepath.Join(playerDir, "club_sessions")),
			RawOutputPath: abs(filepath.Join(playerDir, "raw_output.jsonl")),
			Tools:         player.Tools, Enchantments: player.Enchantments, Cwd: m.root, Player: player.Name,
			Vars: map[string]string{"match_id": m.id, "torch_pass_dir": m.torchPass, "repo_root": m.root},
		}
		result, err := driver.Run(m.ctx, req, club.Hooks{
			OnEvent: func(event map[string]any) {
				record := tracker.Observe(event)
				if record == nil {
					return
				}
				payload := record.Payload
				payload["player"] = player.Name
				// The call's span rides the columns; duration_ms stays in the
				// payload as the club's own number.
				m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "ability_cast",
					Name: record.Label, StartedAt: record.StartedAt, EndedAt: record.EndedAt, Payload: payload})
			},
			OnSpawn: func(pid int) {
				m.Feed.ProcessStart(m.id, "player", player.Name, pid,
					fmt.Sprintf("%s %s %s", player.Club, player.Name, player.Model))
			},
			OnExit: func(pid int) { _ = m.Feed.ProcessEnd(m.id, pid) },
		})
		m.AddUsage(result.Tokens, result.Cost)
		spent.Merge(result.Usage)
		latest = result
		return result, err
	}

	// What the tree looked like before this player got its hands on it. Every
	// send in this objective (first prompt, JSON fixes, review corrections) is
	// measured against this one snapshot.
	before := restrictedarea.Snapshot(m.root)

	result, err := send(userText)
	if err != nil {
		return nil, err
	}
	report, attempt, err := m.parseWithRetries(o, call, result, send)
	if err != nil {
		return nil, err
	}

	// Official reviews: violations flow back into the SAME session.
	limit := o.Retries + 1
	if limit < 1 {
		limit = 1
	}
	for reviewAttempt := 1; reviewAttempt <= limit; reviewAttempt++ {
		var violations []string
		for _, review := range call.Reviews {
			res := review.Check(report)
			found := res.Violations()
			checks := make([]matchfeed.ReviewCheck, len(res.Checks))
			lines := make([]console.Check, len(res.Checks))
			for i, c := range res.Checks {
				checks[i] = matchfeed.ReviewCheck{Item: c.Item, OK: c.OK, Note: c.Note}
				lines[i] = console.Check{Item: c.Item, OK: c.OK, Note: c.Note}
			}
			_ = m.Feed.ReviewRow(m.id, o.ObjectiveID, review.Name, res.Passed(), found, checks, reviewAttempt)
			eventType := "gear_check_pass"
			if len(found) > 0 {
				eventType = "gear_check_fail"
			}
			if found == nil {
				found = []string{}
			}
			m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: eventType, Name: review.Name,
				Payload: map[string]any{"attempt": reviewAttempt, "violations": found, "checks": checks}})
			m.Console.ReviewResult(review.Name, lines)
			violations = append(violations, found...)
		}
		if len(violations) == 0 {
			break
		}
		if reviewAttempt > o.Retries {
			return nil, &officialreview.Failure{Message: fmt.Sprintf("%s failed official reviews after %d attempt(s):\n- %s",
				player.Name, reviewAttempt, strings.Join(violations, "\n- "))}
		}
		o.Attempt = reviewAttempt
		m.Console.Retry(player.Name, reviewAttempt, o.Retries, fmt.Sprintf("%d official review violation(s)", len(violations)))
		correction := "Your previous response failed validation:\n- " + strings.Join(violations, "\n- ") +
			"\n\nFix these problems, then re-emit ONLY your match report JSON."
		if result, err = send(correction); err != nil {
			return nil, err
		}
		if report, attempt, err = m.parseWithRetries(o, call, result, send); err != nil {
			return nil, err
		}
	}

	// Permission is checked after every send is done, and before the report
	// is accepted: a player does not get to report a touchdown on an
	// objective in which it wrote somewhere it was not allowed to.
	touched, err := restrictedarea.Enforce(m.root, player, m.Cfg, before)
	if err != nil {
		var writes any
		if player.Writes != nil {
			writes = player.Writes
		}
		m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "error", Name: "permission_breach",
			Payload: map[string]any{"player": player.Name, "error": err.Error(), "writes": writes,
				"restricted_area": m.Cfg.Defaults.RestrictedArea}})
		return nil, err
	}
	if len(touched) > 0 {
		m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "log", Name: "paths_touched",
			Payload: map[string]any{"player": player.Name, "paths": touched}})
	}

	m.persistReport(o, player.Name, player.Purpose, call.ReportType, report, attempt, "")
	base := report.Base()
	m.Console.ReportSummary(report.TypeName(), base.Status, base.Summary, base.Artifacts)
	_ = m.Feed.ClubSessionRow(matchfeed.ClubSession{MatchID: m.id, Player: player.Name, Club: player.Club,
		Model: player.Model, Color: player.Color, SessionID: sessionID,
		ContextTokens: latest.ContextTokens, ContextWindow: latest.ContextWindow})
	m.saveClubMap(player.Name, clubEntry{SessionID: sessionID, Model: player.Model, Club: player.Club})
	m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "trade", Name: player.Name,
		Payload: map[string]any{"artifacts": base.Artifacts, "summary": base.Summary}})
	tokens := spent.TotalTokens
	// The objective's totals, not the last send's: a retried objective paid for every attempt.
	m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "raider_end", Name: player.Name,
		Tokens: &tokens, Payload: map[string]any{"cost": spent.TotalCost, "usage": spent,
			"context_tokens": latest.ContextTokens, "context_window": latest.ContextWindow}})
	m.Console.PlayerFinished(player.Name, spent.TotalTokens, spent.TotalCost)
	if base.Status != reports.Touchdown {
		return nil, fmt.Errorf("%s reported status=%q: %s", player.Name, base.Status, base.Summary)
	}
	return report, nil
}

func abs(p string) string {
	if a, err := filepath.Abs(p); err == nil {
		return a
	}
	return p
}

// clubSessionID rejoins the player's existing context window when its model
// is unchanged, else mints a new session.
func (m *Match) clubSessionID(player, model string) string {
	if entry, ok := m.clubMap[player]; ok && entry.Model == model && entry.SessionID != "" {
		return entry.SessionID
	}
	return fmt.Sprintf("ogsf-%s-%s-%s", m.id, player, kit.NewID(4))
}

// parseWithRetries parses the final reply against the declared report type;
// on failure it continues the SAME session with a correction, bounded.
func (m *Match) parseWithRetries(o *Objective, call Call, result club.Result,
	send func(string) (club.Result, error)) (reports.Report, int, error) {
	for attempt := 1; attempt <= JSONFixAttempts+1; attempt++ {
		payload, err := reports.ExtractJSON(result.Text)
		var report reports.Report
		if err == nil {
			report, err = reports.Parse(call.ReportType, payload)
		}
		if err == nil {
			return report, attempt, nil
		}
		m.persistReport(o, o.Owner, "", call.ReportType, nil, attempt, result.Text)
		if attempt > JSONFixAttempts {
			return nil, attempt, fmt.Errorf("%s never produced valid %s JSON: %w", o.Owner, call.ReportType, err)
		}
		m.Console.Retry(o.Owner, attempt, JSONFixAttempts, fmt.Sprintf("invalid %s JSON: %v", call.ReportType, err))
		result, err = send(fmt.Sprintf("Your response was not valid JSON for the required structure (%v). "+
			"Respond again with ONLY a JSON object with these fields: %s. No prose, no code fences.",
			err, strings.Join(reports.FieldNames(call.ReportType), ", ")))
		if err != nil {
			return nil, attempt, err
		}
	}
	return nil, 0, errors.New("unreachable")
}

// persistReport records a report row; a valid one also lands as
// match_report.json beside the player's other files.
func (m *Match) persistReport(o *Objective, player, purpose, reportType string, report reports.Report, attempt int, raw string) {
	if report == nil {
		payload := reports.CompactJSON(map[string]any{"raw": kit.Tail(raw, 2000)})
		_ = m.Feed.ReportRow(m.id, o.ObjectiveID, player, reportType, payload, false, attempt)
		return
	}
	_ = m.Feed.ReportRow(m.id, o.ObjectiveID, player, reportType, reports.Pretty(report), true, attempt)
	record := map[string]any{"player": player, "purpose": purpose, "report_type": reportType, "attempt": attempt}
	for k, v := range reports.AsMap(report) {
		record[k] = v
	}
	_ = os.WriteFile(filepath.Join(m.dir, player, "match_report.json"), []byte(reports.PrettyJSON(record)), 0o644)
}
