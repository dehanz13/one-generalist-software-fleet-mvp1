package matchday

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

// ReportFacts is every row a report needs about the matches that started in
// [since, until). The reports themselves are computed on the page, from
// shared/report.ts, so this Mac and the cloud agree to the cent.
func (r *Reader) ReportFacts(since, until string) (Row, error) {
	matches, err := r.rows(`SELECT * FROM matches WHERE started_at >= ? AND started_at < ? ORDER BY started_at`, since, until)
	if err != nil {
		return nil, err
	}
	ids := make([]any, 0, len(matches))
	for _, m := range matches {
		ids = append(ids, m["match_id"])
	}
	facts := Row{"since": since, "until": until, "matches": matches, "objectives": []Row{}, "players": []Row{},
		"raider_ends": []Row{}, "reviews": []Row{}, "reports": []Row{}, "errors": []Row{}, "qa_casts": []Row{}}
	if len(ids) == 0 {
		return facts, nil
	}
	in := "(" + placeholders(len(ids)) + ")"
	queries := map[string]string{
		"objectives":  `SELECT * FROM objectives WHERE match_id IN ` + in + ` ORDER BY match_id, seq`,
		"raider_ends": `SELECT match_id, objective_id, name AS player, tokens, payload_json, started_at FROM events WHERE match_id IN ` + in + ` AND type = 'raider_end' ORDER BY rowid`,
		"reviews":     `SELECT match_id, objective_id, review, passed, attempt, created_at FROM official_reviews WHERE match_id IN ` + in + ` ORDER BY rowid`,
		"reports":     `SELECT match_id, objective_id, player, report_type, valid, attempt, created_at FROM match_reports WHERE match_id IN ` + in + ` ORDER BY rowid`,
		"errors":      `SELECT match_id, objective_id, name, payload_json, started_at FROM events WHERE match_id IN ` + in + ` AND type = 'error' ORDER BY rowid`,
		"qa_casts":    `SELECT match_id, objective_id, name, payload_json, started_at, ended_at FROM events WHERE match_id IN ` + in + ` AND type = 'ability_cast' AND name LIKE 'qa:%' ORDER BY rowid`,
	}
	for key, query := range queries {
		rows, err := r.rows(query, ids...)
		if err != nil {
			return nil, err
		}
		facts[key] = rows
	}
	players, err := r.playersFor(ids)
	if err != nil {
		return nil, err
	}
	all := []Row{}
	for _, id := range ids {
		all = append(all, players[id]...)
	}
	facts["players"] = all
	return facts, nil
}

// Upcoming is the Upcoming Matches board, by due time.
func (r *Reader) Upcoming() ([]Row, error) {
	return r.rows(`SELECT * FROM upcoming_matches ORDER BY due_at, ticket_id`)
}

// isoQuery reads an ISO time from the query, or the fallback.
func isoQuery(r *http.Request, key string, fallback time.Time) (string, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return fallback.UTC().Format("2006-01-02T15:04:05.000-07:00"), nil
	}
	t, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		return "", errors.New(key + " is not an ISO time")
	}
	// The match log stores UTC with an explicit offset; comparing text in the
	// same form keeps the range exact.
	return t.UTC().Format("2006-01-02T15:04:05.000-07:00"), nil
}

func (s *Server) planningRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/report-facts", func(w http.ResponseWriter, r *http.Request) {
		now := time.Now()
		since, err := isoQuery(r, "since", now.AddDate(0, 0, -7))
		if err == nil {
			var until string
			until, err = isoQuery(r, "until", now.Add(time.Minute))
			if err == nil {
				facts, ferr := s.Reader.ReportFacts(since, until)
				s.answer(w, facts, ferr)
				return
			}
		}
		fail(w, 400, err.Error())
	})
	mux.HandleFunc("GET /api/upcoming", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Reader.Upcoming()
		s.answer(w, rows, err)
	})
	mux.HandleFunc("GET /api/requests", func(w http.ResponseWriter, r *http.Request) {
		list, err := s.Feed.Requests(intQuery(r, "limit", 50))
		out := make([]map[string]any, 0, len(list))
		for _, q := range list {
			out = append(out, q.AsMap())
		}
		s.answer(w, out, err)
	})
	mux.HandleFunc("POST /api/requests", s.createRequest)
	mux.HandleFunc("POST /api/requests/{id}/cancel", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !safe(id) {
			fail(w, 400, "invalid request_id")
			return
		}
		current, err := s.Feed.Request(id)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		if current == nil {
			fail(w, 404, "no request "+id)
			return
		}
		row, err := s.Feed.RequestCancel(id)
		if err != nil {
			fail(w, 409, err.Error())
			return
		}
		writeJSON(w, 200, row.AsMap())
	})
}

// newRequest is POST /api/requests' body (NewRequest in shared/types.ts).
type newRequest struct {
	Kind     string `json:"kind"`
	SetPiece string `json:"set_piece"`
	Prompt   string `json:"prompt"`
	Player   string `json:"player"`
	TicketID string `json:"ticket_id"`
	Machine  string `json:"machine"`
}

func (s *Server) createRequest(w http.ResponseWriter, r *http.Request) {
	var body newRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		fail(w, 400, "the body is not a request: "+err.Error())
		return
	}
	row := matchfeed.RequestRow{RequestedBy: "page", Kind: body.Kind, Player: strings.TrimSpace(body.Player),
		Machine: strings.TrimSpace(body.Machine)}
	if row.Player != "" && !safe(row.Player) || row.Machine != "" && len(row.Machine) > 200 {
		fail(w, 400, "invalid player or machine")
		return
	}
	switch body.Kind {
	case "set_piece":
		row.SetPiece, row.Prompt = strings.TrimSpace(body.SetPiece), strings.TrimSpace(body.Prompt)
		if s.IsSetPiece != nil && !s.IsSetPiece(row.SetPiece) {
			fail(w, 400, "no set piece "+row.SetPiece)
			return
		}
		if row.Prompt == "" {
			fail(w, 400, "a set_piece request needs a prompt")
			return
		}
	case "ticket":
		row.TicketID = strings.TrimSpace(body.TicketID)
		ticket, err := s.ticket(row.TicketID)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		if ticket == nil {
			fail(w, 404, "no ticket "+row.TicketID+" on the Upcoming Matches board")
			return
		}
		switch ticket.Status {
		case "queued", "running", "touchdown", "turnover":
			fail(w, 409, "ticket "+row.TicketID+" is already "+ticket.Status)
			return
		}
	default:
		fail(w, 400, `kind is "set_piece" or "ticket"`)
		return
	}
	created, err := s.Feed.RequestCreate(row)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, created.AsMap())
}

func (s *Server) ticket(id string) (*matchfeed.UpcomingRow, error) {
	rows, err := s.Feed.UpcomingRows()
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].TicketID == id {
			return &rows[i], nil
		}
	}
	return nil, nil
}
