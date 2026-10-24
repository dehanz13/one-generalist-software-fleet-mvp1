package matchday

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

// seed writes one small match through the real feed.
func seed(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	db := filepath.Join(dir, "match_log.db")
	feed, err := matchfeed.Open(db, filepath.Join(dir, "m1", "match_feed.jsonl"), matchfeed.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer feed.Close()
	feed.MatchStart("m1", "Danniel", "team-talk", "kickabout", "mac")
	feed.MatchAsk("m1", "plan a thing")
	feed.ObjectiveUpsert(matchfeed.Objective{ObjectiveID: "m1_01_spec", MatchID: "m1", Seq: 1, Name: "spec",
		Kind: "player", Owner: "playmaker", Description: "Turn the request into a plan", Status: "running"})
	feed.Event(matchfeed.EventRecord{MatchID: "m1", ObjectiveID: "m1_01_spec", Type: "raider_start", Name: "playmaker",
		Payload: map[string]any{"model": "anthropic/claude-sonnet-5-5", "color": "#a78bfa", "club": "pi"}})
	tokens := 1200
	feed.Event(matchfeed.EventRecord{MatchID: "m1", ObjectiveID: "m1_01_spec", Type: "raider_end", Name: "playmaker",
		Tokens: &tokens, Payload: map[string]any{"usage": map[string]any{"input_tokens": 100, "cache_write_tokens": 20, "output_tokens": 30}}})
	feed.TeamTalkRow("m1", "playmaker", "system text", "user text")
	return db
}

func serve(t *testing.T, origins ...string) (*httptest.Server, *Server) {
	t.Helper()
	s, err := NewServer(seed(t), origins)
	if err != nil {
		t.Fatal(err)
	}
	s.Poll = 20 * time.Millisecond
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(func() { ts.Close(); s.Close() })
	return ts, s
}

func get(t *testing.T, url string, out any) *http.Response {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
	return resp
}

func TestTheAPIAnswersTheContract(t *testing.T) {
	ts, _ := serve(t)
	var health map[string]any
	get(t, ts.URL+"/api/health", &health)
	if health["source"] != "local" || health["matches"].(float64) != 1 {
		t.Fatalf("health %v", health)
	}
	var list []map[string]any
	get(t, ts.URL+"/api/matches", &list)
	if len(list) != 1 || list[0]["objective_count"].(float64) != 1 {
		t.Fatalf("list %v", list)
	}
	players := list[0]["players"].([]any)
	if len(players) != 1 || players[0].(map[string]any)["model"] != "anthropic/claude-sonnet-5-5" {
		t.Fatalf("a running player is not labelled from its raider_start: %v", players)
	}
	var detail map[string]any
	get(t, ts.URL+"/api/matches/m1", &detail)
	usage := detail["usage"].(map[string]any)
	if usage["read"].(float64) != 120 || usage["written"].(float64) != 30 {
		t.Fatalf("usage %v", usage)
	}
	var page map[string]any
	get(t, ts.URL+"/api/matches/m1/events?after=0&limit=1", &page)
	if page["has_more"] != true || len(page["events"].([]any)) != 1 || page["cursor"].(float64) < 1 {
		t.Fatalf("page %v", page)
	}
	var talks map[string]any
	get(t, ts.URL+"/api/matches/m1/players/playmaker/team-talks", &talks)
	if talks["system"] != "system text" {
		t.Fatalf("talks %v", talks)
	}
	if resp := get(t, ts.URL+"/api/matches/nope", nil); resp.StatusCode != 404 {
		t.Fatalf("missing match: %d", resp.StatusCode)
	}
	if resp := get(t, ts.URL+"/api/matches/m1/players/..%2Fx/team-talks", nil); resp.StatusCode != 400 && resp.StatusCode != 404 {
		t.Fatalf("a traversal segment answered %d", resp.StatusCode)
	}
}

func TestArchiveIsTheOneWrite(t *testing.T) {
	ts, _ := serve(t)
	resp, err := http.Post(ts.URL+"/api/matches/m1/archive", "application/json", strings.NewReader(`{"archived": true}`))
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("archive: %v %v", resp, err)
	}
	var list []map[string]any
	get(t, ts.URL+"/api/matches", &list)
	if len(list) != 0 {
		t.Fatal("an archived match is still listed")
	}
	get(t, ts.URL+"/api/matches?archived=all", &list)
	if len(list) != 1 {
		t.Fatal("archived=all lost the match")
	}
}

func TestOnlyAllowedOriginsMayReadAcrossSites(t *testing.T) {
	ts, _ := serve(t, "https://matchday.example")
	pre, _ := http.NewRequest(http.MethodOptions, ts.URL+"/api/matches", nil)
	pre.Header.Set("Origin", "https://matchday.example")
	pre.Header.Set("Access-Control-Request-Private-Network", "true")
	resp, err := http.DefaultClient.Do(pre)
	if err != nil || resp.StatusCode != 204 ||
		resp.Header.Get("Access-Control-Allow-Origin") != "https://matchday.example" ||
		resp.Header.Get("Access-Control-Allow-Private-Network") != "true" {
		t.Fatalf("allowed preflight: %v %v", resp, err)
	}
	evil, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/matches", nil)
	evil.Header.Set("Origin", "https://evil.example")
	resp, err = http.DefaultClient.Do(evil)
	if err != nil || resp.StatusCode != 403 || resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("foreign origin: %v %v", resp, err)
	}
}

func TestTheLiveStreamPushesNewEventsWithTheirCursor(t *testing.T) {
	ts, s := serve(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/live?match=m1&after=0", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("content type %q", resp.Header.Get("Content-Type"))
	}
	reader := bufio.NewReader(resp.Body)
	readUntil := func(want string) string {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				if err == io.EOF || ctx.Err() != nil {
					t.Fatalf("stream ended before %q", want)
				}
				t.Fatal(err)
			}
			if strings.Contains(line, want) {
				return line
			}
		}
	}
	readUntil("event: events")
	// A row written after the stream opened arrives on its own.
	feed, err := matchfeed.Open(s.Reader.Path, os.DevNull, matchfeed.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer feed.Close()
	feed.Event(matchfeed.EventRecord{MatchID: "m1", ObjectiveID: "m1_01_spec", Type: "log", Name: "spec",
		Payload: map[string]any{"message": "a new line"}})
	readUntil("a new line")
}
