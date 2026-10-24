package matchfeed

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
)

// MatchTicket records which Upcoming Matches ticket a match plays.
func (f *Feed) MatchTicket(matchID, ticketID string) error {
	return f.updateMatch(matchID, "ticket_id=?", ticketID)
}

// UpcomingRow is an upcoming_matches row. Empty strings are stored as null.
type UpcomingRow struct {
	TicketID, Source, SourceRef, Sprint, Title, Date, Time, Timezone, DueAt string
	SetPiece, Mode, Prompt, Player, Status, MatchID, Machine, Note          string
}

// UpcomingUpsert writes a ticket's row; it is relayed like a match.
func (f *Feed) UpcomingUpsert(r UpcomingRow) error {
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		_, err := tx.Exec(`INSERT INTO upcoming_matches (ticket_id, source, source_ref, sprint, title, date, time, timezone,
			due_at, set_piece, mode, prompt, player, status, match_id, machine, note, updated_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
			ON CONFLICT(ticket_id) DO UPDATE SET source=excluded.source, source_ref=excluded.source_ref,
			sprint=excluded.sprint, title=excluded.title, date=excluded.date, time=excluded.time,
			timezone=excluded.timezone, due_at=excluded.due_at, set_piece=excluded.set_piece, mode=excluded.mode,
			prompt=excluded.prompt, player=excluded.player, status=excluded.status, match_id=excluded.match_id,
			machine=excluded.machine, note=excluded.note, updated_at=excluded.updated_at`,
			r.TicketID, nullable(r.Source), nullable(r.SourceRef), nullable(r.Sprint), nullable(r.Title), nullable(r.Date),
			nullable(r.Time), nullable(r.Timezone), nullable(r.DueAt), nullable(r.SetPiece), nullable(r.Mode),
			nullable(r.Prompt), nullable(r.Player), nullable(r.Status), nullable(r.MatchID), nullable(r.Machine),
			nullable(r.Note), kit.NowISO())
		return []rowRef{{"upcoming_matches", []any{r.TicketID}}}, err
	})
}

// UpcomingRows reads every ticket, by due time.
func (f *Feed) UpcomingRows() ([]UpcomingRow, error) {
	rows, err := f.DB.Query(`SELECT ticket_id, source, source_ref, sprint, title, date, time, timezone, due_at,
		set_piece, mode, prompt, player, status, match_id, machine, note FROM upcoming_matches ORDER BY due_at, ticket_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UpcomingRow
	for rows.Next() {
		var c [17]sql.NullString
		ptrs := make([]any, len(c))
		for i := range c {
			ptrs[i] = &c[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		out = append(out, UpcomingRow{c[0].String, c[1].String, c[2].String, c[3].String, c[4].String, c[5].String,
			c[6].String, c[7].String, c[8].String, c[9].String, c[10].String, c[11].String, c[12].String,
			c[13].String, c[14].String, c[15].String, c[16].String})
	}
	return out, rows.Err()
}

// RequestRow is a requests row: "run this now". Requests stay on the Mac.
type RequestRow struct {
	RequestID, CreatedAt, RequestedBy, Kind, SetPiece, Prompt, Player, TicketID string
	Machine, Status, ClaimedBy, MatchID, Note, UpdatedAt                        string
}

// AsMap is the row as the API answers it: empty strings as null.
func (r RequestRow) AsMap() map[string]any {
	n := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	return map[string]any{"request_id": r.RequestID, "created_at": n(r.CreatedAt), "requested_by": n(r.RequestedBy),
		"kind": n(r.Kind), "set_piece": n(r.SetPiece), "prompt": n(r.Prompt), "player": n(r.Player),
		"ticket_id": n(r.TicketID), "machine": n(r.Machine), "status": n(r.Status), "claimed_by": n(r.ClaimedBy),
		"match_id": n(r.MatchID), "note": n(r.Note), "updated_at": n(r.UpdatedAt)}
}

const requestColumns = `request_id, created_at, requested_by, kind, set_piece, prompt, player, ticket_id, machine,
	status, claimed_by, match_id, note, updated_at`

func scanRequests(rows *sql.Rows) ([]RequestRow, error) {
	defer rows.Close()
	var out []RequestRow
	for rows.Next() {
		var c [14]sql.NullString
		ptrs := make([]any, len(c))
		for i := range c {
			ptrs[i] = &c[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		out = append(out, RequestRow{c[0].String, c[1].String, c[2].String, c[3].String, c[4].String, c[5].String,
			c[6].String, c[7].String, c[8].String, c[9].String, c[10].String, c[11].String, c[12].String, c[13].String})
	}
	return out, rows.Err()
}

// RequestCreate queues a request on this Mac. A ticket request also marks
// its ticket queued on the board, in the same transaction, so the Scheduler
// leaves it for the request instead of starting it twice.
func (f *Feed) RequestCreate(r RequestRow) (RequestRow, error) {
	r.RequestID = "req_" + kit.NewID(12)
	r.CreatedAt, r.UpdatedAt, r.Status = kit.NowISO(), kit.NowISO(), "queued"
	err := f.write(func(tx *sql.Tx) ([]rowRef, error) {
		_, err := tx.Exec(`INSERT INTO requests (`+requestColumns+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			r.RequestID, r.CreatedAt, nullable(r.RequestedBy), r.Kind, nullable(r.SetPiece), nullable(r.Prompt),
			nullable(r.Player), nullable(r.TicketID), nullable(r.Machine), r.Status, nil, nil, nil, r.UpdatedAt)
		if err != nil || r.Kind != "ticket" {
			return nil, err
		}
		return ticketStatus(tx, r.TicketID, "queued", []string{"scheduled", "due", "skipped"})
	})
	return r, err
}

// ticketStatus moves a ticket from one of the given statuses to status, and
// queues the row for the relay when it moved.
func ticketStatus(tx *sql.Tx, ticketID, status string, from []string) ([]rowRef, error) {
	args := []any{status, kit.NowISO(), ticketID}
	for _, s := range from {
		args = append(args, s)
	}
	res, err := tx.Exec(`UPDATE upcoming_matches SET status=?, note=NULL, updated_at=? WHERE ticket_id=? AND status IN (`+
		strings.TrimSuffix(strings.Repeat("?,", len(from)), ",")+`)`, args...)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, nil
	}
	return []rowRef{{"upcoming_matches", []any{ticketID}}}, nil
}

// Requests lists the newest requests first.
func (f *Feed) Requests(limit int) ([]RequestRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := f.DB.Query(`SELECT `+requestColumns+` FROM requests ORDER BY created_at DESC, request_id LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	return scanRequests(rows)
}

// Request reads one request.
func (f *Feed) Request(id string) (*RequestRow, error) {
	rows, err := f.DB.Query(`SELECT `+requestColumns+` FROM requests WHERE request_id = ?`, id)
	if err != nil {
		return nil, err
	}
	list, err := scanRequests(rows)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// RequestClaim takes the oldest queued request this Mac may run, atomically,
// and marks it claimed. It returns nil when there is none.
func (f *Feed) RequestClaim(machine string) (*RequestRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rows, err := f.DB.Query(`UPDATE requests SET status='claimed', claimed_by=?, updated_at=?
		WHERE request_id = (SELECT request_id FROM requests WHERE status='queued' AND (machine IS NULL OR machine=?)
		ORDER BY created_at, request_id LIMIT 1)
		RETURNING `+requestColumns, machine, kit.NowISO(), machine)
	if err != nil {
		return nil, err
	}
	list, err := scanRequests(rows)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// requestOrder is the order a request's status may move in.
var requestOrder = map[string]int{"queued": 0, "claimed": 1, "running": 2, "touchdown": 3, "turnover": 3, "refused": 3, "cancelled": 3}

// RequestUpdate moves a request forward: never back, never out of a final state.
func (f *Feed) RequestUpdate(id, status, matchID, note string) error {
	current, err := f.Request(id)
	if err != nil {
		return err
	}
	if current == nil {
		return fmt.Errorf("no request %s", id)
	}
	next, ok := requestOrder[status]
	if !ok {
		return fmt.Errorf("request status %q is not one of queued, claimed, running, touchdown, turnover, refused, cancelled", status)
	}
	if requestOrder[current.Status] >= 3 || next < requestOrder[current.Status] {
		return fmt.Errorf("request %s is %s; it cannot become %s", id, current.Status, status)
	}
	return f.write(func(tx *sql.Tx) ([]rowRef, error) {
		_, err := tx.Exec(`UPDATE requests SET status=?, match_id=COALESCE(?, match_id), note=COALESCE(?, note), updated_at=?
			WHERE request_id=?`, status, nullable(matchID), nullable(note), kit.NowISO(), id)
		return nil, err
	})
}

// RequestCancel cancels a request that nobody has taken yet. A ticket it
// queued goes back on the board; the next sync makes it due or scheduled.
func (f *Feed) RequestCancel(id string) (*RequestRow, error) {
	current, err := f.Request(id)
	if err != nil || current == nil {
		return nil, err
	}
	if current.Status != "queued" {
		return nil, fmt.Errorf("request %s is %s; only a queued request can be cancelled", id, current.Status)
	}
	if err := f.RequestUpdate(id, "cancelled", "", "cancelled before a Mac took it"); err != nil {
		return nil, err
	}
	if current.Kind == "ticket" {
		if err := f.write(func(tx *sql.Tx) ([]rowRef, error) {
			return ticketStatus(tx, current.TicketID, "scheduled", []string{"queued"})
		}); err != nil {
			return nil, err
		}
	}
	return f.Request(id)
}

// MatchStatus reads a match's status, or "" when there is no such match.
func (f *Feed) MatchStatus(matchID string) string {
	var status sql.NullString
	_ = f.DB.QueryRow("SELECT status FROM matches WHERE match_id = ?", matchID).Scan(&status)
	return strings.TrimSpace(status.String)
}
