package relay

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTheFleetClientClaimsAndUpdatesWithItsToken(t *testing.T) {
	var seen []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			http.Error(w, "no", 401)
			return
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		seen = append(seen, r.Method+" "+r.URL.Path)
		switch r.URL.Path {
		case "/api/fleet/claim":
			if body["machine"] != "mac" || len(body["accepts"].([]any)) != 1 {
				http.Error(w, "bad body", 400)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"request": map[string]any{"request_id": "req_1", "kind": "set_piece",
				"set_piece": "ask", "prompt": "hi", "requested_by": "connector"}})
		case "/api/fleet/requests/req_1":
			if body["status"] != "running" || body["match_id"] != "m1" {
				http.Error(w, "bad body", 400)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{"ok": true})
		}
	}))
	defer ts.Close()
	c := &Client{URL: ts.URL, Token: "tok", Machine: "mac", HTTP: ts.Client()}
	r, err := c.Claim(context.Background(), "mac", []string{"ask"})
	if err != nil || r == nil || r.RequestID != "req_1" || r.RequestedBy != "connector" {
		t.Fatalf("claim: %+v %v", r, err)
	}
	if err := c.Update(context.Background(), "req_1", "running", "m1", ""); err != nil {
		t.Fatal(err)
	}
	bad := &Client{URL: ts.URL, Token: "wrong", HTTP: ts.Client()}
	if _, err := bad.Claim(context.Background(), "mac", nil); err == nil {
		t.Fatal("a refused token is an error")
	}
	if len(seen) != 2 {
		t.Fatalf("calls: %v", seen)
	}
}
