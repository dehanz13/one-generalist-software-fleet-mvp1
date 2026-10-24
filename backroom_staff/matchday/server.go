package matchday

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

// The page, built from matchday_live/ by `make ui` and kept here so the
// binary carries it.
//
//go:embed all:dist
var dist embed.FS

// Server is the local Matchday Live.
type Server struct {
	Reader *Reader
	Feed   *matchfeed.Feed // the one write: archive
	// AllowedOrigins may read this server from another origin (the deployed
	// page using "Local fleet" as its source). Everything else is refused:
	// the API has no login, so it only ever answers this machine's browser.
	AllowedOrigins map[string]bool
	// Poll is how often the live stream looks at the file.
	Poll time.Duration
	// IsSetPiece checks a request's set piece; the command line wires it.
	IsSetPiece func(string) bool
}

// NewServer opens a match log for serving.
func NewServer(dbPath string, origins []string) (*Server, error) {
	// The JSONL half of a feed is not needed to serve: archive writes a row only.
	feed, err := matchfeed.Open(dbPath, os.DevNull, matchfeed.Options{})
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	for _, o := range origins {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
			allowed[o] = true
		}
	}
	return &Server{Reader: &Reader{DB: feed.DB, Path: dbPath}, Feed: feed, AllowedOrigins: allowed,
		Poll: 300 * time.Millisecond}, nil
}

// Close closes the match log.
func (s *Server) Close() error { return s.Feed.Close() }

var safeSegment = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// safe refuses anything that is not a plain identifier, rather than trying
// to sanitize it into something that might still escape.
func safe(v string) bool { return safeSegment.MatchString(v) && v != "." && v != ".." }

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func intQuery(r *http.Request, key string, fallback int) int {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

// cors answers cross-origin requests from allowed origins only, including
// Chrome's Private Network Access preflight for a public page reading a
// loopback address.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !loopback(r.Host) {
			// The server listens on 127.0.0.1 only. A request naming any other
			// host reached it by DNS rebinding: a site whose name now points
			// here, which would pass the same-host check below.
			fail(w, http.StatusMisdirectedRequest, "this server answers on 127.0.0.1 and localhost only")
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "" && s.allowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Last-Event-ID")
			w.Header().Set("Access-Control-Max-Age", "600")
			if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
			}
		}
		w.Header().Add("Vary", "Origin")
		if r.Method == http.MethodOptions {
			if origin != "" && !s.allowed(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if origin != "" && !s.allowed(origin) && !sameHost(r, origin) {
			fail(w, http.StatusForbidden, "origin "+origin+" may not read this fleet — start `ogsf var --allow-origin "+origin+"`")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func loopback(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	return host == "localhost" || net.ParseIP(host).IsLoopback()
}

func (s *Server) allowed(origin string) bool { return s.AllowedOrigins[strings.TrimRight(origin, "/")] }

func sameHost(r *http.Request, origin string) bool {
	u, err := url.Parse(origin)
	return err == nil && u.Host == r.Host
}

// Handler is the whole server: the API and the page.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "source": "local", "matches": s.Reader.Count(), "store": s.Reader.Path})
	})
	mux.HandleFunc("GET /api/matches", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Reader.Matches(intQuery(r, "limit", 200), r.URL.Query().Get("archived"))
		s.answer(w, rows, err)
	})
	mux.HandleFunc("GET /api/matches/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		detail, err := s.Reader.Detail(id)
		if err == nil && detail == nil {
			fail(w, 404, "no match "+id)
			return
		}
		s.answer(w, detail, err)
	})
	mux.HandleFunc("POST /api/matches/{id}/archive", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !safe(id) {
			fail(w, 400, "invalid match_id")
			return
		}
		var body struct {
			Archived *bool `json:"archived"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
		archived := body.Archived == nil || *body.Archived
		found, err := s.Feed.MatchArchive(id, archived)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		if !found {
			fail(w, 404, "no match "+id)
			return
		}
		writeJSON(w, 200, map[string]any{"match_id": id, "archived": archived})
	})
	mux.HandleFunc("GET /api/matches/{id}/events", func(w http.ResponseWriter, r *http.Request) {
		page, err := s.Reader.Events(r.PathValue("id"), intQuery(r, "after", 0), intQuery(r, "limit", DefaultLimit))
		s.answer(w, page, err)
	})
	mux.HandleFunc("GET /api/matches/{id}/reports", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Reader.Reports(r.PathValue("id"))
		s.answer(w, rows, err)
	})
	mux.HandleFunc("GET /api/matches/{id}/reviews", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Reader.Reviews(r.PathValue("id"))
		s.answer(w, rows, err)
	})
	mux.HandleFunc("GET /api/matches/{id}/processes", func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.Reader.Processes(r.PathValue("id"))
		s.answer(w, rows, err)
	})
	mux.HandleFunc("GET /api/matches/{id}/players/{player}/team-talks", func(w http.ResponseWriter, r *http.Request) {
		id, player := r.PathValue("id"), r.PathValue("player")
		if !safe(id) || !safe(player) {
			fail(w, 400, "invalid match_id or player")
			return
		}
		row, err := s.Reader.TeamTalks(id, player)
		s.answer(w, row, err)
	})
	mux.HandleFunc("GET /api/live", s.live)
	s.planningRoutes(mux)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "no route "+r.URL.Path) })
	mux.Handle("/", s.page())
	return s.cors(mux)
}

func (s *Server) answer(w http.ResponseWriter, data any, err error) {
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, data)
}

// page serves the built UI, falling back to index.html for client routes.
func (s *Server) page() http.Handler {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return http.NotFoundHandler()
	}
	files := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if info, err := fs.Stat(sub, path); err != nil || info.IsDir() {
			index, err := fs.ReadFile(sub, "index.html")
			if err != nil {
				http.Error(w, "the page is not built into this binary: run `make ui`", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(index)
			return
		}
		if strings.HasPrefix(path, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}

// live pushes changes as server-sent events. With ?match=<id> it sends new
// events (`events`, id = the cursor, so a reconnect resumes without a gap)
// and the match's detail whenever it changes (`match`); without, a `matches`
// note whenever any match changes. One internal reader follows the file by
// rowid, whichever process is writing it; the browser never polls.
func (s *Server) live(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "streaming unsupported")
		return
	}
	matchID := r.URL.Query().Get("match")
	cursor := intQuery(r, "after", 0)
	if last := r.Header.Get("Last-Event-ID"); last != "" {
		if n, err := strconv.Atoi(last); err == nil && n > cursor {
			cursor = n
		}
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(200)
	send := func(event string, id string, data any) {
		payload, _ := json.Marshal(data)
		if id != "" {
			fmt.Fprintf(w, "id: %s\n", id)
		}
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload)
		flusher.Flush()
	}
	fmt.Fprint(w, "retry: 2000\n\n")
	flusher.Flush()

	ctx := r.Context()
	ticker := time.NewTicker(s.Poll)
	defer ticker.Stop()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	lastStamp := ""
	tick := func() {
		stamp, err := s.Reader.Stamp(matchID)
		if err != nil || stamp == lastStamp {
			return
		}
		lastStamp = stamp
		if matchID == "" {
			send("matches", "", map[string]any{"updated_at": stamp})
			return
		}
		for {
			page, err := s.Reader.Events(matchID, cursor, DefaultLimit)
			if err != nil {
				return
			}
			events, _ := page["events"].([]Row)
			if len(events) > 0 {
				next, _ := page["cursor"].(int64)
				cursor = int(next)
				send("events", strconv.Itoa(cursor), map[string]any{"events": events, "cursor": cursor})
			}
			if more, _ := page["has_more"].(bool); !more {
				break
			}
		}
		if detail, err := s.Reader.Detail(matchID); err == nil && detail != nil {
			send("match", "", detail)
		}
	}
	tick()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tick()
		case <-ping.C:
			send("ping", "", map[string]any{"at": time.Now().UTC().Format(time.RFC3339)})
		}
	}
}

// ListenAndServe serves on addr until ctx ends.
func (s *Server) ListenAndServe(ctx context.Context, addr string) error {
	server := &http.Server{Addr: addr, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	err := server.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
