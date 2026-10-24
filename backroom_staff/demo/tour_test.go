package demo

// The tour is the end-to-end test of the engine: every set piece runs for
// real (config, match feed, team talks, the scripted club's pi-shaped stream,
// official reviews and their corrections, the restricted area, qa with the
// progressive gate, the contract, the kickoff checklist, git) against a
// throwaway repository, and each must end the way its story says.

import (
	"bytes"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

func TestTheTourPlaysEverySetPieceToItsStory(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is required")
	}
	var out bytes.Buffer
	start := time.Date(2026, 10, 12, 13, 50, 0, 0, time.UTC) // a Monday
	result, err := Tour(Options{Dir: t.TempDir(), Out: &out, Start: start})
	if err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}
	want := []struct {
		command, status string
		code            int
	}{
		{"ask", "touchdown", 0},
		{"scout-opposition", "touchdown", 0},
		{"scout-opposition", "turnover", 1}, // restricted area breach
		{"team-talk", "touchdown", 0},
		{"qa", "turnover", 1},
		{"attack", "touchdown", 0},
		{"talk-attack", "touchdown", 0},
		{"bard", "touchdown", 0},
		{"attack-var", "touchdown", 0},
		{"attack-review", "touchdown", 0},
		{"play", "touchdown", 0},
		{"run-normal", "touchdown", 0},
		{"ask", "turnover", 75}, // match abandoned
		{"post-match", "touchdown", 0},
		{"run-heroic", "touchdown", 0},
		{"run-mythic", "touchdown", 0},
		{"run-mythic", "turnover", 1},  // ruled noop
		{"run-mythic", "touchdown", 0}, // re-verified
	}
	if len(result.Outcomes) != len(want) {
		t.Fatalf("%d outcomes, want %d\n%s", len(result.Outcomes), len(want), out.String())
	}
	for i, w := range want {
		got := result.Outcomes[i]
		if got.Command != w.command || got.Status != w.status || got.Code != w.code {
			t.Errorf("#%d %s: got %s/%s exit %d (%v), want %s exit %d", i, w.command, got.Command, got.Status,
				got.Code, got.Err, w.status, w.code)
		}
	}
	if t.Failed() {
		t.Log(out.String())
		return
	}
	if result.Outcomes[17].MatchID != result.Outcomes[16].MatchID {
		t.Fatal("the re-verification did not rejoin the ruled match")
	}

	db, err := matchfeed.OpenDB(result.DBPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	count := func(query string, args ...any) int {
		var n int
		if err := db.QueryRow(query, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	// What the stories promise, checked in the record itself.
	breach := result.Outcomes[2].MatchID
	if count("SELECT COUNT(*) FROM events WHERE match_id = ? AND name = 'permission_breach'", breach) != 1 {
		t.Error("the breach is not recorded")
	}
	attack := result.Outcomes[5].MatchID
	if count("SELECT COUNT(*) FROM events WHERE match_id = ? AND type = 'gear_check_fail'", attack) != 1 ||
		count("SELECT COUNT(*) FROM official_reviews WHERE match_id = ? AND passed = 1", attack) != 1 {
		t.Error("the review correction is not recorded")
	}
	mythic := result.Outcomes[15].MatchID
	var names []string
	rows, _ := db.Query("SELECT name FROM objectives WHERE match_id = ? ORDER BY seq", mythic)
	for rows.Next() {
		var n string
		rows.Scan(&n)
		names = append(names, n)
	}
	rows.Close()
	if got := strings.Join(names, " "); got != "ask spec benchmark build scope_check_1 iterate_1 scope_check_2 qa_2 ship" {
		t.Errorf("run-mythic objectives: %s", got)
	}
	if count("SELECT COUNT(*) FROM events WHERE type = 'ability_cast'") < 60 {
		t.Error("too few ability casts for a full tour")
	}
	if count("SELECT COUNT(*) FROM team_talks") < 15 {
		t.Error("team talks were not recorded")
	}
	log, _ := exec.Command("git", "-C", result.Repo, "log", "--format=%s").Output()
	for _, subject := range []string{"feat(server): answer /health with ok", "docs(ogsf-", "feat(timer): show minutes played on /timer",
		"refactor(scoreboard): drop debug logging and type render"} {
		if !strings.Contains(string(log), subject) {
			t.Errorf("no commit %q in:\n%s", subject, log)
		}
	}

	// The week: five working days, each match on its day.
	if n := count("SELECT COUNT(DISTINCT substr(started_at, 1, 10)) FROM matches"); n != 5 {
		t.Errorf("matches on %d days, want Monday to Friday", n)
	}
	if first := result.Outcomes[0].MatchID; count("SELECT COUNT(*) FROM matches WHERE match_id = ? AND started_at LIKE '2026-10-12T14:00%'", first) != 1 {
		t.Error("the first match does not start on Monday at 14:00")
	}
	// The board: what each ticket became, and which match played it.
	board := map[string]string{}
	rows, _ = db.Query("SELECT ticket_id, status FROM upcoming_matches")
	for rows.Next() {
		var id, status string
		rows.Scan(&id, &status)
		board[id] = status
	}
	rows.Close()
	wantBoard := map[string]string{"KICK-100": "due", "KICK-101": "touchdown", "KICK-102": "touchdown", "KICK-103": "touchdown",
		"KICK-104": "touchdown", "KICK-105": "touchdown", "KICK-106": "touchdown", "KICK-107": "touchdown", "KICK-108": "skipped",
		"KICK-109": "scheduled", "KICK-110": "scheduled", "KICK-111": "scheduled", "KICK-112": "scheduled", "KICK-113": "scheduled"}
	for id, status := range wantBoard {
		if board[id] != status {
			t.Errorf("%s is %q, want %q", id, board[id], status)
		}
	}
	for i, o := range result.Outcomes {
		if o.Ticket != "" && count("SELECT COUNT(*) FROM matches m JOIN upcoming_matches u ON u.match_id = m.match_id "+
			"WHERE m.match_id = ? AND m.ticket_id = ? AND u.ticket_id = ?", o.MatchID, o.Ticket, o.Ticket) != 1 {
			t.Errorf("#%d %s: the match and its ticket %s do not name each other", i, o.Command, o.Ticket)
		}
	}
	requests := map[string]int{}
	rows, _ = db.Query("SELECT status FROM requests")
	for rows.Next() {
		var status string
		rows.Scan(&status)
		requests[status]++
	}
	rows.Close()
	if requests["touchdown"] != 2 || requests["refused"] != 1 || requests["cancelled"] != 1 || requests["queued"] != 1 {
		t.Errorf("requests: %v", requests)
	}

	data, err := Export(result.DBPath, "", "test")
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Matches) != 17 { // the re-verification rejoined a match
		t.Fatalf("%d matches exported", len(data.Matches))
	}
	for _, m := range data.Matches {
		if len(m.Events) == 0 {
			t.Fatalf("match %v exported without events", m.Match["match_id"])
		}
	}
	if data.Version != 2 || len(data.Upcoming) != 14 || len(data.Requests) != 5 {
		t.Fatalf("version %d, %d tickets, %d requests", data.Version, len(data.Upcoming), len(data.Requests))
	}
}
