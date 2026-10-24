// Package relay sends this Mac's match log to Matchday Live on Vercel, so a
// match can be watched from anywhere. (New: legacy's view only ever read the
// file on the same machine.)
//
// Every write the match feed makes is queued in relay_outbox, in the same
// transaction as the write. The relay sends the outbox in order, in batches,
// to POST /api/ingest with a fleet token, and deletes what the cloud
// accepted. Nothing is lost when the network is: rows stay queued until a
// later send (`ogsf relay push`).
//
// The Mac holds only two values: CLUB_RELAY_URL and CLUB_RELAY_TOKEN, a
// fleet token minted on the page and revocable there. The database's own
// credentials live in Vercel's environment and never reach a Mac.
package relay

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// BatchRows is the most rows one request carries (the cloud refuses more).
const BatchRows = 500

// BatchBytes keeps one request under the cloud's 4 MB limit.
const BatchBytes = 3_500_000

// Client sends outbox rows to one Matchday Live deployment.
type Client struct {
	URL     string
	Token   string
	Machine string
	HTTP    *http.Client
}

// FromEnv returns a client from CLUB_RELAY_URL and CLUB_RELAY_TOKEN, or nil
// when either is missing: no relay is set up and nothing is sent.
func FromEnv() *Client {
	url := strings.TrimRight(strings.TrimSpace(os.Getenv("CLUB_RELAY_URL")), "/")
	token := strings.TrimSpace(os.Getenv("CLUB_RELAY_TOKEN"))
	if url == "" || token == "" {
		return nil
	}
	return &Client{URL: url, Token: token, Machine: kit.MachineName(), HTTP: &http.Client{Timeout: 20 * time.Second}}
}

// Configured is true when a relay is set up.
func Configured() bool { return FromEnv() != nil }

type outboxRow struct {
	id    int64
	table string
	row   json.RawMessage
}

// Pending is how many rows wait in the outbox.
func Pending(db *sql.DB) (int, error) {
	var n int
	err := db.QueryRow("SELECT COUNT(*) FROM relay_outbox").Scan(&n)
	return n, err
}

// PushOnce sends one batch and returns how many rows the cloud accepted.
func (c *Client) PushOnce(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, tbl, row_json FROM relay_outbox ORDER BY id LIMIT ?", BatchRows)
	if err != nil {
		return 0, err
	}
	var batch []outboxRow
	size := 0
	for rows.Next() {
		var r outboxRow
		var text string
		if err := rows.Scan(&r.id, &r.table, &text); err != nil {
			rows.Close()
			return 0, err
		}
		if size+len(text) > BatchBytes && len(batch) > 0 {
			break
		}
		size += len(text)
		r.row = json.RawMessage(text)
		batch = append(batch, r)
	}
	rows.Close()
	if len(batch) == 0 {
		return 0, nil
	}
	type item struct {
		Table string          `json:"table"`
		Row   json.RawMessage `json:"row"`
	}
	body := struct {
		Machine string `json:"machine"`
		Rows    []item `json:"rows"`
	}{Machine: c.Machine}
	for _, r := range batch {
		body.Rows = append(body.Rows, item{Table: r.table, Row: r.row})
	}
	payload := []byte(reports.CompactJSON(body))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+"/api/ingest", bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	answer, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode/100 != 2 {
		return 0, fmt.Errorf("Matchday Live answered %s: %s", resp.Status, strings.TrimSpace(string(answer)))
	}
	last := batch[len(batch)-1].id
	if _, err := db.ExecContext(ctx, "DELETE FROM relay_outbox WHERE id <= ?", last); err != nil {
		return 0, err
	}
	return len(batch), nil
}

// Drain sends until the outbox is empty, the context ends, or a send fails.
func (c *Client) Drain(ctx context.Context, db *sql.DB) (int, error) {
	total := 0
	for {
		n, err := c.PushOnce(ctx, db)
		total += n
		if err != nil || n == 0 {
			return total, err
		}
	}
}

// Run sends every `every` until ctx ends. Failures are reported once per
// streak through warn and retried on the next tick: a match never waits on
// the network.
func (c *Client) Run(ctx context.Context, db *sql.DB, every time.Duration, warn func(error)) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	failing := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := c.Drain(ctx, db)
			if err != nil && ctx.Err() == nil {
				if !failing && warn != nil {
					warn(err)
				}
				failing = true
			} else if err == nil {
				failing = false
			}
		}
	}
}

// Backfill queues every row of every table, parents first, so a match made
// before the relay was set up reaches the cloud too. Rows already in the
// cloud are upserted again, which changes nothing.
func Backfill(db *sql.DB) (int, error) {
	queued := 0
	for _, table := range matchfeed.TableOrder {
		rows, err := db.Query("SELECT * FROM " + table)
		if err != nil {
			return queued, err
		}
		all, err := matchfeed.ScanRows(rows)
		rows.Close()
		if err != nil {
			return queued, err
		}
		for _, row := range all {
			if _, err := db.Exec("INSERT INTO relay_outbox (tbl, row_json, created_at) VALUES (?,?,?)",
				table, reports.CompactJSON(row), kit.NowISO()); err != nil {
				return queued, err
			}
			queued++
		}
	}
	return queued, nil
}
