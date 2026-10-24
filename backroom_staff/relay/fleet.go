package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Remote is a request the cloud queued (from the page or the Claude
// connector) as the fleet API hands it over.
type Remote struct {
	RequestID   string `json:"request_id"`
	RequestedBy string `json:"requested_by"`
	Kind        string `json:"kind"`
	SetPiece    string `json:"set_piece"`
	Prompt      string `json:"prompt"`
	Player      string `json:"player"`
	TicketID    string `json:"ticket_id"`
	Machine     string `json:"machine"`
}

func (c *Client) post(ctx context.Context, path string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("Matchday Live answered %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

// Claim takes the oldest request queued in the cloud that this Mac accepts,
// or nil when there is none.
func (c *Client) Claim(ctx context.Context, machine string, accepts []string) (*Remote, error) {
	var answer struct {
		Request *Remote `json:"request"`
	}
	if accepts == nil {
		accepts = []string{}
	}
	err := c.post(ctx, "/api/fleet/claim", map[string]any{"machine": machine, "accepts": accepts}, &answer)
	return answer.Request, err
}

// Update moves a claimed request forward: running, then touchdown, turnover or refused.
func (c *Client) Update(ctx context.Context, requestID, status, matchID, note string) error {
	body := map[string]any{"status": status}
	if matchID != "" {
		body["match_id"] = matchID
	}
	if note != "" {
		body["note"] = note
	}
	return c.post(ctx, "/api/fleet/requests/"+requestID, body, nil)
}
