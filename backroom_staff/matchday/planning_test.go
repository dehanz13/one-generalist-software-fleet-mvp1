package matchday

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

func post(t *testing.T, url string, body any, out any) *http.Response {
	t.Helper()
	data, _ := json.Marshal(body)
	resp, err := http.Post(url, "application/json", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		json.NewDecoder(resp.Body).Decode(out)
	}
	return resp
}

func TestReportFactsAreTheRawRowsOfTheMatchesInRange(t *testing.T) {
	ts, _ := serve(t)
	var facts map[string]any
	get(t, ts.URL+"/api/report-facts", &facts)
	if n := len(facts["matches"].([]any)); n != 1 {
		t.Fatalf("matches in the last week: %d", n)
	}
	ends := facts["raider_ends"].([]any)
	if len(ends) != 1 || ends[0].(map[string]any)["player"] != "playmaker" || ends[0].(map[string]any)["tokens"].(float64) != 1200 {
		t.Fatalf("raider_ends: %v", ends)
	}
	if len(facts["objectives"].([]any)) != 1 || len(facts["players"].([]any)) != 1 {
		t.Fatalf("objectives and players: %v", facts)
	}
	for _, key := range []string{"reviews", "reports", "errors", "qa_casts"} {
		if _, ok := facts[key].([]any); !ok {
			t.Fatalf("%s should be a list, even empty: %v", key, facts[key])
		}
	}
	old := time.Now().AddDate(0, 0, -30).UTC().Format(time.RFC3339)
	older := time.Now().AddDate(0, 0, -20).UTC().Format(time.RFC3339)
	get(t, ts.URL+"/api/report-facts?since="+url.QueryEscape(old)+"&until="+url.QueryEscape(older), &facts)
	if len(facts["matches"].([]any)) != 0 {
		t.Fatalf("a range without matches: %v", facts["matches"])
	}
	if resp := get(t, ts.URL+"/api/report-facts?since=yesterday", nil); resp.StatusCode != 400 {
		t.Fatalf("a bad time answered %d", resp.StatusCode)
	}
}

func TestRequestsAreQueuedValidatedAndCancelled(t *testing.T) {
	ts, s := serve(t)
	s.IsSetPiece = func(n string) bool { return n == "ask" }
	s.Feed.UpcomingUpsert(matchfeed.UpcomingRow{TicketID: "KICK-7", Title: "Toggle", Date: "2026-10-12",
		SetPiece: "ask", Mode: "manual", Prompt: "p", Status: "due"})

	var created map[string]any
	if resp := post(t, ts.URL+"/api/requests", map[string]any{"kind": "set_piece", "set_piece": "ask", "prompt": "Why?"}, &created); resp.StatusCode != 201 {
		t.Fatalf("create answered %d: %v", resp.StatusCode, created)
	}
	if created["status"] != "queued" || created["requested_by"] != "page" || created["ticket_id"] != nil {
		t.Fatalf("created: %v", created)
	}
	for _, bad := range []map[string]any{
		{"kind": "set_piece", "set_piece": "juggle", "prompt": "x"},
		{"kind": "set_piece", "set_piece": "ask", "prompt": "  "},
		{"kind": "launch"},
	} {
		if resp := post(t, ts.URL+"/api/requests", bad, nil); resp.StatusCode != 400 {
			t.Fatalf("%v answered %d", bad, resp.StatusCode)
		}
	}
	if resp := post(t, ts.URL+"/api/requests", map[string]any{"kind": "ticket", "ticket_id": "KICK-0"}, nil); resp.StatusCode != 404 {
		t.Fatalf("an unknown ticket answered %d", resp.StatusCode)
	}

	var ticket map[string]any
	post(t, ts.URL+"/api/requests", map[string]any{"kind": "ticket", "ticket_id": "KICK-7"}, &ticket)
	var board []map[string]any
	get(t, ts.URL+"/api/upcoming", &board)
	if len(board) != 1 || board[0]["status"] != "queued" {
		t.Fatalf("a requested ticket shows as queued: %v", board)
	}
	if resp := post(t, ts.URL+"/api/requests", map[string]any{"kind": "ticket", "ticket_id": "KICK-7"}, nil); resp.StatusCode != 409 {
		t.Fatalf("asking twice answered %d", resp.StatusCode)
	}

	var cancelled map[string]any
	post(t, ts.URL+"/api/requests/"+ticket["request_id"].(string)+"/cancel", nil, &cancelled)
	if cancelled["status"] != "cancelled" {
		t.Fatalf("cancel: %v", cancelled)
	}
	get(t, ts.URL+"/api/upcoming", &board)
	if board[0]["status"] != "scheduled" {
		t.Fatalf("a cancelled request puts the ticket back: %v", board)
	}
	if resp := post(t, ts.URL+"/api/requests/"+ticket["request_id"].(string)+"/cancel", nil, nil); resp.StatusCode != 409 {
		t.Fatalf("cancelling twice answered %d", resp.StatusCode)
	}

	var list []map[string]any
	get(t, ts.URL+"/api/requests", &list)
	if len(list) != 2 {
		t.Fatalf("requests: %v", list)
	}
}

func TestOnlyLoopbackHostsAreAnswered(t *testing.T) {
	ts, _ := serve(t)
	req, _ := http.NewRequest("GET", ts.URL+"/api/health", nil)
	req.Host = "rebound.example:4600"
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusMisdirectedRequest {
		t.Fatalf("a rebound host answered %d", resp.StatusCode)
	}
	req.Host = "localhost:4600"
	resp, _ = http.DefaultClient.Do(req)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("localhost answered %d", resp.StatusCode)
	}
}
