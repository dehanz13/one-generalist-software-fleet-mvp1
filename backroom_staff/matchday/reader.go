// Package matchday serves Matchday Live from this Mac: the API of
// wiki/DATA-CONTRACT.md over the local match log, live updates pushed as
// server-sent events, and the page itself, built into the binary. It is what
// `ogsf var` runs. (Legacy: the Bun server and polling Vue page of the
// visualizer.)
package matchday

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

// Row is one database row as column → value.
type Row = map[string]any

// Reader answers the API's questions from one match log.
type Reader struct {
	DB   *sql.DB
	Path string
}

// MaxLimit and DefaultLimit bound a page of rows.
const (
	MaxLimit     = 1000
	DefaultLimit = 500
)

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func (r *Reader) rows(query string, args ...any) ([]Row, error) {
	rows, err := r.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out, err := matchfeed.ScanRows(rows)
	if out == nil {
		out = []Row{}
	}
	return out, err
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

// Count is how many matches the log holds.
func (r *Reader) Count() int {
	var n int
	_ = r.DB.QueryRow("SELECT COUNT(*) FROM matches").Scan(&n)
	return n
}

// Matches lists matches, most recent first, each with its objectives and
// players, so a card draws its progress without another request. archived
// is "0" (the default: matches still to review), "1", or "all".
func (r *Reader) Matches(limit int, archived string) ([]Row, error) {
	where := "WHERE COALESCE(archived, 0) = 0"
	switch archived {
	case "1":
		where = "WHERE COALESCE(archived, 0) = 1"
	case "all":
		where = ""
	}
	matches, err := r.rows(`SELECT * FROM matches `+where+`
		ORDER BY started_at DESC, rowid DESC LIMIT ?`, clamp(limit, 1, MaxLimit))
	if err != nil || len(matches) == 0 {
		return matches, err
	}
	ids := make([]any, len(matches))
	for i, m := range matches {
		ids[i] = m["match_id"]
	}
	objectives, err := r.rows("SELECT * FROM objectives WHERE match_id IN ("+placeholders(len(ids))+") ORDER BY seq, rowid", ids...)
	if err != nil {
		return nil, err
	}
	byMatch := map[any][]Row{}
	for _, o := range objectives {
		byMatch[o["match_id"]] = append(byMatch[o["match_id"]], o)
	}
	players, err := r.playersFor(ids)
	if err != nil {
		return nil, err
	}
	for _, m := range matches {
		list := byMatch[m["match_id"]]
		if list == nil {
			list = []Row{}
		}
		m["objectives"] = list
		m["objective_count"] = len(list)
		p := players[m["match_id"]]
		if p == nil {
			p = []Row{}
		}
		m["players"] = p
	}
	return matches, nil
}

// playersFor merges club_sessions with players that have started but not
// finished: a club_sessions row is written only after the report persists,
// so a running player has none yet, and that is the case a live view exists
// for. Its model, colour and session id are on its raider_start event.
func (r *Reader) playersFor(ids []any) (map[any][]Row, error) {
	out := map[any][]Row{}
	if len(ids) == 0 {
		return out, nil
	}
	done, err := r.rows("SELECT * FROM club_sessions WHERE match_id IN ("+placeholders(len(ids))+") ORDER BY created_at, player", ids...)
	if err != nil {
		return nil, err
	}
	for _, row := range done {
		out[row["match_id"]] = append(out[row["match_id"]], row)
	}
	started, err := r.rows(`SELECT e.match_id, o.owner AS player, e.payload_json, e.started_at
		FROM events e JOIN objectives o ON o.objective_id = e.objective_id
		WHERE e.match_id IN (`+placeholders(len(ids))+`) AND e.type = 'raider_start' ORDER BY e.rowid`, ids...)
	if err != nil {
		return nil, err
	}
	for _, row := range started {
		player, _ := row["player"].(string)
		if player == "" {
			continue
		}
		known := false
		for _, p := range out[row["match_id"]] {
			if p["player"] == player {
				known = true
			}
		}
		if known {
			continue
		}
		var payload map[string]any
		text, _ := row["payload_json"].(string)
		_ = json.Unmarshal([]byte(text), &payload) // a malformed payload just means no label
		out[row["match_id"]] = append(out[row["match_id"]], Row{
			"match_id": row["match_id"], "player": player, "club": payload["club"],
			"model": payload["model"], "session_id": payload["session_id"], "color": payload["color"],
			// Occupancy is only known once the player's turn closes.
			"context_tokens": nil, "context_window": nil,
			"created_at": row["started_at"], "last_used_at": row["started_at"],
		})
	}
	return out, nil
}

// Match is one match row, or nil.
func (r *Reader) Match(id string) (Row, error) {
	rows, err := r.rows("SELECT * FROM matches WHERE match_id = ?", id)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// Detail is a match with its usage, objectives and players: what a lane
// view needs to draw.
func (r *Reader) Detail(id string) (Row, error) {
	match, err := r.Match(id)
	if err != nil || match == nil {
		return nil, err
	}
	objectives, err := r.rows("SELECT * FROM objectives WHERE match_id = ? ORDER BY seq, rowid", id)
	if err != nil {
		return nil, err
	}
	players, err := r.playersFor([]any{id})
	if err != nil {
		return nil, err
	}
	p := players[id]
	if p == nil {
		p = []Row{}
	}
	usage, err := r.Usage(id)
	if err != nil {
		return nil, err
	}
	return Row{"match": match, "usage": usage, "objectives": objectives, "players": p}, nil
}

// Usage is raw tokens read and written, beside the billed headline: derived
// from raider_end payloads, so every match already logged gets the split.
// total_tokens is a SPEND number (every turn re-sends the conversation);
// read and written say what actually moved.
func (r *Reader) Usage(id string) (Row, error) {
	rows, err := r.rows("SELECT payload_json FROM events WHERE match_id = ? AND type = 'raider_end'", id)
	if err != nil {
		return nil, err
	}
	read, written := 0.0, 0.0
	for _, row := range rows {
		text, _ := row["payload_json"].(string)
		var payload struct {
			Usage map[string]float64 `json:"usage"`
		}
		if json.Unmarshal([]byte(text), &payload) != nil || payload.Usage == nil {
			continue
		}
		// RAW reads only: new input plus cache writes. Cache reads are the same
		// tokens served again on later turns.
		read += payload.Usage["input_tokens"] + payload.Usage["cache_write_tokens"]
		written += payload.Usage["output_tokens"]
	}
	return Row{"read": int(read), "written": int(written)}, nil
}

// Events is a page of a match's events after a cursor, in insertion order.
func (r *Reader) Events(id string, after, limit int) (Row, error) {
	limit = clamp(limit, 1, MaxLimit)
	if after < 0 {
		after = 0
	}
	events, err := r.rows("SELECT rowid AS cursor, * FROM events WHERE match_id = ? AND rowid > ? ORDER BY rowid LIMIT ?",
		id, after, limit)
	if err != nil {
		return nil, err
	}
	cursor := int64(after)
	if n := len(events); n > 0 {
		cursor, _ = events[n-1]["cursor"].(int64)
	}
	return Row{"events": events, "cursor": cursor, "has_more": len(events) == limit}, nil
}

// Reports are every report the match's players sent, valid or not.
func (r *Reader) Reports(id string) ([]Row, error) {
	return r.rows("SELECT * FROM match_reports WHERE match_id = ? ORDER BY created_at, rowid", id)
}

// Reviews are every official review, with its checks.
func (r *Reader) Reviews(id string) ([]Row, error) {
	return r.rows("SELECT * FROM official_reviews WHERE match_id = ? ORDER BY created_at, rowid", id)
}

// Processes are the match's process rows (ended_at null = believed alive).
func (r *Reader) Processes(id string) ([]Row, error) {
	return r.rows("SELECT * FROM processes WHERE match_id = ? ORDER BY started_at, rowid", id)
}

// TeamTalks are the exact prompts a player was sent; both null when the
// player never ran in this match, which is a normal answer, not an error.
func (r *Reader) TeamTalks(id, player string) (Row, error) {
	rows, err := r.rows("SELECT system, user FROM team_talks WHERE match_id = ? AND player = ?", id, player)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return Row{"system": nil, "user": nil}, nil
	}
	return rows[0], nil
}

// Stamp is a cheap fingerprint of what changed, for the live stream.
func (r *Reader) Stamp(id string) (string, error) {
	var updated sql.NullString
	var lastEvent sql.NullInt64
	if id == "" {
		err := r.DB.QueryRow("SELECT MAX(updated_at) FROM matches").Scan(&updated)
		return updated.String, err
	}
	if err := r.DB.QueryRow("SELECT updated_at FROM matches WHERE match_id = ?", id).Scan(&updated); err != nil && err != sql.ErrNoRows {
		return "", err
	}
	_ = r.DB.QueryRow("SELECT MAX(rowid) FROM events WHERE match_id = ?", id).Scan(&lastEvent)
	return fmt.Sprintf("%s|%d", updated.String, lastEvent.Int64), nil
}
