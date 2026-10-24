package relay

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

type ingest struct {
	mu     sync.Mutex
	rows   []map[string]any
	tables []string
	auth   string
	fail   bool
}

func (in *ingest) handler(w http.ResponseWriter, r *http.Request) {
	in.mu.Lock()
	defer in.mu.Unlock()
	in.auth = r.Header.Get("Authorization")
	if in.fail {
		http.Error(w, `{"error":"down"}`, 503)
		return
	}
	var body struct {
		Machine string `json:"machine"`
		Rows    []struct {
			Table string         `json:"table"`
			Row   map[string]any `json:"row"`
		} `json:"rows"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	for _, row := range body.Rows {
		in.tables = append(in.tables, row.Table)
		in.rows = append(in.rows, row.Row)
	}
	json.NewEncoder(w).Encode(map[string]int{"accepted": len(body.Rows)})
}

func feed(t *testing.T) *matchfeed.Feed {
	t.Helper()
	dir := t.TempDir()
	f, err := matchfeed.Open(filepath.Join(dir, "log.db"), filepath.Join(dir, "feed.jsonl"), matchfeed.Options{Outbox: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}

func TestEveryWriteIsQueuedThenSentInOrderAndCleared(t *testing.T) {
	f := feed(t)
	f.MatchStart("m1", "Danniel", "ask", "p", "mac")
	f.Event(matchfeed.EventRecord{MatchID: "m1", Type: "log", Name: "console", Payload: map[string]any{"message": "hi"}})
	f.MatchFinish("m1", true)
	if n, _ := Pending(f.DB); n != 3 {
		t.Fatalf("%d rows queued, want 3", n)
	}
	in := &ingest{}
	ts := httptest.NewServer(http.HandlerFunc(in.handler))
	defer ts.Close()
	client := &Client{URL: ts.URL, Token: "fleet-token", Machine: "mac", HTTP: ts.Client()}
	sent, err := client.Drain(context.Background(), f.DB)
	if err != nil || sent != 3 {
		t.Fatalf("sent %d, %v", sent, err)
	}
	if in.auth != "Bearer fleet-token" {
		t.Fatalf("auth %q", in.auth)
	}
	if in.tables[0] != "matches" || in.tables[1] != "events" || in.rows[2]["status"] != "touchdown" {
		t.Fatalf("order or content wrong: %v %v", in.tables, in.rows)
	}
	if n, _ := Pending(f.DB); n != 0 {
		t.Fatalf("%d rows left after a good send", n)
	}
}

func TestAFailedSendKeepsTheRowsQueued(t *testing.T) {
	f := feed(t)
	f.MatchStart("m1", "Danniel", "ask", "p", "mac")
	in := &ingest{fail: true}
	ts := httptest.NewServer(http.HandlerFunc(in.handler))
	defer ts.Close()
	client := &Client{URL: ts.URL, Token: "t", HTTP: ts.Client()}
	if _, err := client.Drain(context.Background(), f.DB); err == nil {
		t.Fatal("a 503 was taken as a send")
	}
	if n, _ := Pending(f.DB); n != 1 {
		t.Fatalf("%d rows queued after a failed send, want 1", n)
	}
}

func TestBackfillQueuesEveryRowParentsFirst(t *testing.T) {
	dir := t.TempDir()
	plain, err := matchfeed.Open(filepath.Join(dir, "log.db"), filepath.Join(dir, "f.jsonl"), matchfeed.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer plain.Close()
	plain.MatchStart("m1", "Danniel", "ask", "p", "mac")
	plain.ObjectiveUpsert(matchfeed.Objective{ObjectiveID: "o1", MatchID: "m1", Seq: 1, Name: "ask", Status: "touchdown"})
	if n, _ := Pending(plain.DB); n != 0 {
		t.Fatal("a feed without a relay queued rows")
	}
	queued, err := Backfill(plain.DB)
	if err != nil || queued != 2 {
		t.Fatalf("queued %d, %v", queued, err)
	}
	var first string
	plain.DB.QueryRow("SELECT tbl FROM relay_outbox ORDER BY id LIMIT 1").Scan(&first)
	if first != "matches" {
		t.Fatalf("first queued table %q", first)
	}
}

func TestNoRelayWithoutBothValues(t *testing.T) {
	t.Setenv("CLUB_RELAY_URL", "https://x.example")
	t.Setenv("CLUB_RELAY_TOKEN", "")
	if FromEnv() != nil {
		t.Fatal("a relay without a token was set up")
	}
	t.Setenv("CLUB_RELAY_TOKEN", "t")
	if c := FromEnv(); c == nil || c.URL != "https://x.example" {
		t.Fatalf("got %+v", c)
	}
}
