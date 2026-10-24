// Package matchfeed is the match feed: every event lands in a JSONL file and
// in the match log (SQLite) AS IT HAPPENS. (Legacy: adw_modules/tracer.py.)
//
// The file is the raw record; match_log.db is the queryable mirror that
// `ogsf var` and the inspection commands read. WAL mode, so readers never
// block a running match. When a relay is set up, every write also appends
// the row's new value to relay_outbox, in the same transaction, so a row is
// either written AND queued for Matchday Live, or neither.
package matchfeed

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "modernc.org/sqlite" // registers the "sqlite" driver; pure Go, no cgo

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// DSN is how every connection to a match log is opened: WAL, a 5-second
// busy wait, synchronous NORMAL, and transactions that take the write lock
// up front so two matches writing one file queue instead of failing.
func DSN(path string) string {
	return "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)" +
		"&_pragma=synchronous(NORMAL)&_txlock=immediate"
}

// OpenDB opens (and creates, and migrates) a match log.
func OpenDB(path string) (*sql.DB, error) {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", DSN(path))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // one writer per process; WAL serializes the rest
	if _, err := db.Exec(Schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("match log %s: %w", path, err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	for _, m := range Migrations {
		table, column, decl := m[0], m[1], m[2]
		rows, err := db.Query("PRAGMA table_info(" + table + ")")
		if err != nil {
			return err
		}
		found := false
		for rows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dflt any
			if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
				rows.Close()
				return err
			}
			if name == column {
				found = true
			}
		}
		rows.Close()
		if !found {
			if _, err := db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, decl)); err != nil {
				return err
			}
		}
	}
	return nil
}

// Options shape a feed.
type Options struct {
	// Outbox queues every written row for the relay.
	Outbox bool
	// Warn receives write failures. A feed that cannot write says so and the
	// match goes on: the trace is the record of a match, not its judge.
	Warn func(error)
}

// Feed writes one match's events and rows.
type Feed struct {
	DB    *sql.DB
	Path  string
	jsonl string
	opts  Options
	mu    sync.Mutex
	OnRow func(table string) // called after every committed write; the local server listens
}

// Open opens the match log at dbPath and the JSONL record at jsonlPath.
func Open(dbPath, jsonlPath string, opts Options) (*Feed, error) {
	db, err := OpenDB(dbPath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(jsonlPath), 0o755); err != nil {
		db.Close()
		return nil, err
	}
	if opts.Warn == nil {
		opts.Warn = func(err error) { fmt.Fprintln(os.Stderr, "match feed:", err) }
	}
	return &Feed{DB: db, Path: dbPath, jsonl: jsonlPath, opts: opts}, nil
}

// Close closes the match log.
func (f *Feed) Close() error { return f.DB.Close() }

// EventRecord is one traced event, always logged against a match and an
// objective. (Legacy: EventRecord.)
type EventRecord struct {
	MatchID     string
	ObjectiveID string
	Type        string
	Name        string
	Payload     map[string]any
	ParentID    string
	Tokens      *int
	// Spans: set both when an event covers real elapsed time (an ability
	// cast), so the page lays it out on a time axis without parsing the
	// payload. Left empty, StartedAt is stamped with the moment of recording.
	StartedAt string
	EndedAt   string
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// write runs fn in a transaction and, when the outbox is on, queues the rows
// fn names. It reports failures through Warn and returns them.
func (f *Feed) write(fn func(tx *sql.Tx) ([]rowRef, error)) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	tx, err := f.DB.Begin()
	if err != nil {
		f.opts.Warn(err)
		return err
	}
	refs, err := fn(tx)
	if err == nil && f.opts.Outbox {
		err = queue(tx, refs)
	}
	if err != nil {
		tx.Rollback()
		f.opts.Warn(err)
		return err
	}
	if err := tx.Commit(); err != nil {
		f.opts.Warn(err)
		return err
	}
	if f.OnRow != nil {
		for _, ref := range refs {
			f.OnRow(ref.table)
		}
	}
	return nil
}

// rowRef names one row by table and primary key values.
type rowRef struct {
	table string
	key   []any
}

func queue(tx *sql.Tx, refs []rowRef) error {
	for _, ref := range refs {
		row, err := SnapshotRow(tx, ref.table, ref.key...)
		if err != nil {
			return err
		}
		if row == nil {
			continue
		}
		if _, err := tx.Exec("INSERT INTO relay_outbox (tbl, row_json, created_at) VALUES (?,?,?)",
			ref.table, reports.CompactJSON(row), kit.NowISO()); err != nil {
			return err
		}
	}
	return nil
}

// querier is what SnapshotRow needs: a transaction or the database.
type querier interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

// SnapshotRow reads one row as column → value, or nil when it is not there.
func SnapshotRow(q querier, table string, key ...any) (map[string]any, error) {
	pk, ok := Tables[table]
	if !ok {
		pk = LocalTables[table]
	}
	if len(pk) != len(key) {
		return nil, fmt.Errorf("snapshot %s: want %d key values, got %d", table, len(pk), len(key))
	}
	where := make([]string, len(pk))
	for i, column := range pk {
		where[i] = column + " = ?"
	}
	rows, err := q.Query("SELECT * FROM "+table+" WHERE "+strings.Join(where, " AND "), key...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	all, err := ScanRows(rows)
	if err != nil || len(all) == 0 {
		return nil, err
	}
	return all[0], nil
}

// ScanRows reads every row as column → value. Integers stay int64, reals
// float64, text string, NULL nil.
func ScanRows(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out []map[string]any
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(columns))
		for i, column := range columns {
			if b, ok := values[i].([]byte); ok {
				row[column] = string(b)
			} else {
				row[column] = values[i]
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ── events ──────────────────────────────────────────────────────────────────

// Event records one event in the JSONL file and the match log, and returns its id.
func (f *Feed) Event(rec EventRecord) string {
	eventID := "evt_" + kit.NewID(12)
	ts := kit.NowISO()
	if rec.Payload == nil {
		rec.Payload = map[string]any{}
	}
	line := map[string]any{
		"event_id": eventID, "ts": ts, "match_id": rec.MatchID, "objective_id": rec.ObjectiveID,
		"type": rec.Type, "name": rec.Name, "payload": rec.Payload, "parent_id": rec.ParentID,
		"tokens": rec.Tokens, "started_at": nullable(rec.StartedAt), "ended_at": nullable(rec.EndedAt),
	}
	f.appendJSONL(line)
	started := rec.StartedAt
	if started == "" {
		started = ts
	}
	var tokens any
	if rec.Tokens != nil {
		tokens = *rec.Tokens
	}
	_ = f.write(func(tx *sql.Tx) ([]rowRef, error) {
		_, err := tx.Exec("INSERT INTO events (event_id, match_id, objective_id, parent_id, type, name,"+
			" payload_json, tokens, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
			eventID, rec.MatchID, rec.ObjectiveID, rec.ParentID, rec.Type, rec.Name,
			reports.CompactJSON(rec.Payload), tokens, started, nullable(rec.EndedAt))
		return []rowRef{{"events", []any{eventID}}}, err
	})
	return eventID
}

func (f *Feed) appendJSONL(line map[string]any) {
	file, err := os.OpenFile(f.jsonl, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		f.opts.Warn(err)
		return
	}
	defer file.Close()
	data, _ := json.Marshal(line)
	if _, err := file.Write(append(data, '\n')); err != nil {
		f.opts.Warn(err)
	}
}

// ── matches ─────────────────────────────────────────────────────────────────

// MatchStart opens a match (or re-opens a joined one as running) and adds
// the set piece to its name. A joined match chains set pieces, so each
// distinct one is recorded, in run order: "team-talk + attack-var".
func (f *Feed) MatchStart(matchID, founder, setpieceName, project, machine string) error {
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		now := kit.NowISO()
		if _, err := tx.Exec("INSERT INTO matches (match_id, status, founder, project, machine, started_at, updated_at)"+
			" VALUES (?,?,?,?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET status='running', updated_at=excluded.updated_at",
			matchID, "running", founder, project, machine, now, now); err != nil {
			return nil, err
		}
		if setpieceName != "" {
			var current sql.NullString
			if err := tx.QueryRow("SELECT setpiece_name FROM matches WHERE match_id=?", matchID).Scan(&current); err != nil {
				return nil, err
			}
			var names []string
			if current.Valid && current.String != "" {
				names = strings.Split(current.String, " + ")
			}
			known := false
			for _, n := range names {
				if n == setpieceName {
					known = true
				}
			}
			if !known {
				names = append(names, setpieceName)
				if _, err := tx.Exec("UPDATE matches SET setpiece_name=? WHERE match_id=?",
					strings.Join(names, " + "), matchID); err != nil {
					return nil, err
				}
			}
		}
		return []rowRef{{"matches", []any{matchID}}}, nil
	})
}

// MatchAsk records the founder's request, first 500 characters.
func (f *Feed) MatchAsk(matchID, ask string) error {
	return f.updateMatch(matchID, "ask=?", kit.Head(ask, 500))
}

// MatchFinish closes a match as touchdown or turnover, and closes every
// process row it left open: nothing of this match is alive any more.
func (f *Feed) MatchFinish(matchID string, ok bool) error {
	status := reports.Turnover
	if ok {
		status = reports.Touchdown
	}
	if err := f.updateMatch(matchID, "status=?, ended_at=?", status, kit.NowISO()); err != nil {
		return err
	}
	return f.ProcessesEndAll(matchID)
}

// MatchAddUsage adds tokens and dollars to the match's totals.
func (f *Feed) MatchAddUsage(matchID string, tokens int, cost float64) error {
	return f.updateMatch(matchID, "total_tokens=total_tokens+?, total_cost=total_cost+?", tokens, cost)
}

// MatchArchive sets the review flag. Only the page does this, never a run.
func (f *Feed) MatchArchive(matchID string, archived bool) (bool, error) {
	value := 0
	if archived {
		value = 1
	}
	var found bool
	err := f.write(func(tx *sql.Tx) ([]rowRef, error) {
		res, err := tx.Exec("UPDATE matches SET archived=?, updated_at=? WHERE match_id=?", value, kit.NowISO(), matchID)
		if err != nil {
			return nil, err
		}
		n, _ := res.RowsAffected()
		found = n > 0
		return []rowRef{{"matches", []any{matchID}}}, nil
	})
	return found, err
}

func (f *Feed) updateMatch(matchID, set string, args ...any) error {
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		args = append(args, kit.NowISO(), matchID)
		_, err := tx.Exec("UPDATE matches SET "+set+", updated_at=? WHERE match_id=?", args...)
		return []rowRef{{"matches", []any{matchID}}}, err
	})
}

// ── processes (match_id → pid, so a hung match can be found and stopped) ──

// ProcessStart records a live process for this match. A club that hangs
// produces no events at all, which is exactly when its pid is needed, and
// `ps` cannot say which match it belongs to.
func (f *Feed) ProcessStart(matchID, kind, name string, pid int, command string) string {
	processID := "proc_" + kit.NewID(12)
	_ = f.write(func(tx *sql.Tx) ([]rowRef, error) {
		_, err := tx.Exec("INSERT INTO processes (process_id, match_id, kind, name, pid, command, started_at)"+
			" VALUES (?,?,?,?,?,?,?)", processID, matchID, kind, name, pid, kit.Head(command, 500), kit.NowISO())
		return []rowRef{{"processes", []any{processID}}}, err
	})
	return processID
}

// ProcessEnd marks the newest live row for this pid as finished.
func (f *Feed) ProcessEnd(matchID string, pid int) error {
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		var processID string
		err := tx.QueryRow("SELECT process_id FROM processes WHERE match_id=? AND pid=? AND ended_at IS NULL"+
			" ORDER BY rowid DESC LIMIT 1", matchID, pid).Scan(&processID)
		if err == sql.ErrNoRows {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		_, err = tx.Exec("UPDATE processes SET ended_at=? WHERE process_id=?", kit.NowISO(), processID)
		return []rowRef{{"processes", []any{processID}}}, err
	})
}

// ProcessesEndAll closes every live row of a match.
func (f *Feed) ProcessesEndAll(matchID string) error {
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		rows, err := tx.Query("SELECT process_id FROM processes WHERE match_id=? AND ended_at IS NULL", matchID)
		if err != nil {
			return nil, err
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			ids = append(ids, id)
		}
		rows.Close()
		var refs []rowRef
		now := kit.NowISO()
		for _, id := range ids {
			if _, err := tx.Exec("UPDATE processes SET ended_at=? WHERE process_id=?", now, id); err != nil {
				return nil, err
			}
			refs = append(refs, rowRef{"processes", []any{id}})
		}
		return refs, nil
	})
}

// ── objectives ──────────────────────────────────────────────────────────────

// Objective is the persisted objective row. (Legacy: Phase.)
type Objective struct {
	ObjectiveID string
	MatchID     string
	Seq         int
	Name        string
	Kind        string
	Owner       string
	Description string
	Status      string
	Attempt     int
	Retries     int
	Error       string
	StartedAt   string
	EndedAt     string
}

// MaxObjectiveSeq is the highest seq already recorded for this match; 0 when
// it is new. A joined match continues the sequence instead of restarting at
// 1, which would collide with the first set piece's objectives on both seq
// and objective_id.
func (f *Feed) MaxObjectiveSeq(matchID string) int {
	var seq sql.NullInt64
	if err := f.DB.QueryRow("SELECT MAX(seq) FROM objectives WHERE match_id = ?", matchID).Scan(&seq); err != nil {
		f.opts.Warn(err)
		return 0
	}
	return int(seq.Int64)
}

// ObjectiveUpsert writes an objective; a later write updates its status,
// attempt, error and end.
func (f *Feed) ObjectiveUpsert(o Objective) error {
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		_, err := tx.Exec("INSERT INTO objectives (objective_id, match_id, seq, name, kind, owner, description,"+
			" status, attempt, retries, error, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"+
			" ON CONFLICT(objective_id) DO UPDATE SET status=excluded.status,"+
			" attempt=excluded.attempt, error=excluded.error, ended_at=excluded.ended_at",
			o.ObjectiveID, o.MatchID, o.Seq, o.Name, o.Kind, o.Owner, o.Description, o.Status,
			o.Attempt, o.Retries, nullable(o.Error), nullable(o.StartedAt), nullable(o.EndedAt))
		if err != nil {
			return nil, err
		}
		// The match's updated_at moves too, so a live list sees the progress.
		_, err = tx.Exec("UPDATE matches SET updated_at=? WHERE match_id=?", kit.NowISO(), o.MatchID)
		return []rowRef{{"objectives", []any{o.ObjectiveID}}, {"matches", []any{o.MatchID}}}, err
	})
}

// ── reports, reviews, club sessions, team talks ─────────────────────────────

// ReportRow records one report a player sent, valid or not.
func (f *Feed) ReportRow(matchID, objectiveID, player, reportType, payloadJSON string, valid bool, attempt int) error {
	reportID := "rep_" + kit.NewID(12)
	validInt := 0
	if valid {
		validInt = 1
	}
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		_, err := tx.Exec("INSERT INTO match_reports (report_id, match_id, objective_id, player, report_type,"+
			" payload_json, valid, attempt, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
			reportID, matchID, objectiveID, player, reportType, payloadJSON, validInt, attempt, kit.NowISO())
		return []rowRef{{"match_reports", []any{reportID}}}, err
	})
}

// ReviewCheck mirrors officialreview.ReviewCheck without importing it.
type ReviewCheck struct {
	Item string `json:"item"`
	OK   bool   `json:"ok"`
	Note string `json:"note"`
}

// ReviewRow records one official review: the verdict and the evidence behind it.
func (f *Feed) ReviewRow(matchID, objectiveID, review string, passed bool, violations []string, checks []ReviewCheck, attempt int) error {
	reviewID := "rev_" + kit.NewID(12)
	passedInt := 0
	if passed {
		passedInt = 1
	}
	if violations == nil {
		violations = []string{}
	}
	if checks == nil {
		checks = []ReviewCheck{}
	}
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		_, err := tx.Exec("INSERT INTO official_reviews (review_id, match_id, objective_id, attempt, review, passed,"+
			" violations_json, checks_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
			reviewID, matchID, objectiveID, attempt, review, passedInt,
			reports.CompactJSON(violations), reports.CompactJSON(checks), kit.NowISO())
		return []rowRef{{"official_reviews", []any{reviewID}}}, err
	})
}

// ClubSession is what a club_sessions row needs from a player.
type ClubSession struct {
	MatchID, Player, Club, Model, Color, SessionID string
	ContextTokens, ContextWindow                   int
}

// ClubSessionRow records the player's club session. The config is the source
// of truth for its label and color; context occupancy is the LATEST, so a
// match that runs the same player twice overwrites it.
func (f *Feed) ClubSessionRow(s ClubSession) error {
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		now := kit.NowISO()
		_, err := tx.Exec("INSERT INTO club_sessions (match_id, player, club, model, color, session_id,"+
			" context_tokens, context_window, created_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?,?)"+
			" ON CONFLICT(match_id, player) DO UPDATE SET model=excluded.model, color=excluded.color,"+
			" session_id=excluded.session_id, context_tokens=excluded.context_tokens,"+
			" context_window=excluded.context_window, last_used_at=excluded.last_used_at",
			s.MatchID, s.Player, s.Club, s.Model, s.Color, s.SessionID, s.ContextTokens, s.ContextWindow, now, now)
		return []rowRef{{"club_sessions", []any{s.MatchID, s.Player}}}, err
	})
}

// TeamTalkRow keeps the exact prompts a player was sent, so a page on
// another machine can show them. (New: legacy read them from files.)
func (f *Feed) TeamTalkRow(matchID, player, system, user string) error {
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		_, err := tx.Exec("INSERT INTO team_talks (match_id, player, system, user, updated_at) VALUES (?,?,?,?,?)"+
			" ON CONFLICT(match_id, player) DO UPDATE SET system=excluded.system, user=excluded.user,"+
			" updated_at=excluded.updated_at", matchID, player, system, user, kit.NowISO())
		return []rowRef{{"team_talks", []any{matchID, player}}}, err
	})
}
