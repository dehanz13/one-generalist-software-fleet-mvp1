// Package match is the match: config + match id + club sessions + feed +
// console, bound once, and the ONE objective primitive. (Legacy:
// adw_modules/runner.py and session.py.)
//
// Objective(params, fn) works for all three kinds: head_coach, player and
// referee. Success must be earned: an objective is a turnover unless fn
// returns cleanly (and a player objective additionally needs a parsed report
// and green official reviews, enforced inside Handle.Call).
package match

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/console"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/gitops"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/reports"
)

// Kinds of objective: who performs it.
const (
	HeadCoach = "head_coach" // the founder
	Player    = "player"     // a model, through a club
	Referee   = "referee"    // plain code with no model in it
)

// Params is everything an objective needs. (Legacy: PhaseParams.)
type Params struct {
	Name        string // short id, unique within the match: "spec", "build"
	Kind        string // which lane it renders in
	Owner       string // the founder's name, "git", "qa", or a player from the config
	Description string // REQUIRED: what it does and why
	Retries     int    // player objectives: official review corrections via the same session
}

// Validate refuses a missing description, or one that only restates the
// name. The description is the only sentence the record, the console and
// the page ever show about intent; `ship_spec: "Ship the spec"` tells a reader
// nothing they could not already see. It fails before the objective opens.
func (p Params) Validate() error {
	text := strings.Join(strings.Fields(p.Description), " ")
	if text == "" {
		return fmt.Errorf("objective %q: description is required — one sentence on what this "+
			"objective does and why. It is what the record and the page show", p.Name)
	}
	if strings.EqualFold(strings.TrimRight(text, "."), strings.ReplaceAll(p.Name, "_", " ")) {
		return fmt.Errorf("objective %q: description %q only restates the objective name — "+
			"say what it does and why instead", p.Name, text)
	}
	return nil
}

// Handle is what an objective's body can do.
type Handle interface {
	// Log records key/value pairs, in order, as a log event and a console note.
	Log(kv ...any)
	// Call runs a player (only inside a player objective).
	Call(call Call) (reports.Report, error)
}

// Runner is what a set piece needs from a match. *Match implements it; the
// strict set piece's tests implement it with a scripted fake.
type Runner interface {
	ID() string
	Founder() string
	Objective(p Params, fn func(h Handle) error) error
	Finish(accepted bool, reason string) int
	TorchPassDir() string
}

// Objective is one objective's lifecycle.
type Objective struct {
	matchfeed.Objective
	clock time.Time
}

// clubEntry is one player's line in club_sessions.json.
type clubEntry struct {
	SessionID string `json:"session_id"`
	Model     string `json:"model"`
	Club      string `json:"club"`
}

// Match is one execution of one or more set pieces under a match id.
type Match struct {
	Cfg        *boardroom.Config
	id         string
	Feed       *matchfeed.Feed
	Console    *console.Console
	founder    string
	Objectives []*Objective
	Tokens     int
	Cost       float64
	seq        int
	root       string
	dir        string
	torchPass  string
	dbPath     string
	clubMap    map[string]clubEntry
	current    *Objective

	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	signaled os.Signal
	stopSig  func()
	onClose  []func()
}

// Options shape Ensure.
type Options struct {
	// SetPiece is the command name recorded in setpiece_name ("run-mythic").
	SetPiece string
	// Command is the command line recorded for this process.
	Command string
	// Outbox queues every row for the relay to Matchday Live.
	Outbox bool
	// NoSignals leaves SIGINT/SIGTERM alone (tests, the demo).
	NoSignals bool
	// Console, when set, receives the printed half of the console from the
	// first line on (the demo hides it; nothing is lost from the record).
	Console io.Writer
	// TicketID is the Upcoming Matches ticket this match plays, if any.
	TicketID string
}

// MatchLogPath is where the match log lives: CLUB_MATCHLOG, else var.match_log.
func MatchLogPath(cfg *boardroom.Config) string {
	if p := os.Getenv("CLUB_MATCHLOG"); p != "" {
		return p
	}
	return cfg.Var.MatchLog
}

// Ensure joins the match when it exists or creates it under exactly that id
// (pinned ids for repeatable runs); with no id a fresh one is minted and
// printed, so the next set piece can pick it up.
func Ensure(cfg *boardroom.Config, matchID string, opts Options) (*Match, error) {
	if matchID == "" {
		matchID = kit.NewID(8)
	}
	dir := filepath.Join(cfg.Defaults.DataDir, "matches", matchID)
	dbPath := MatchLogPath(cfg)
	feed, err := matchfeed.Open(dbPath, filepath.Join(dir, "match_feed.jsonl"), matchfeed.Options{Outbox: opts.Outbox})
	if err != nil {
		return nil, err
	}
	torch := filepath.Join(dir, "torch_pass")
	if err := os.MkdirAll(torch, 0o755); err != nil {
		feed.Close()
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Match{
		Cfg: cfg, id: matchID, Feed: feed, founder: kit.FounderName(),
		seq: feed.MaxObjectiveSeq(matchID), root: gitops.RepoRoot(),
		dir: dir, torchPass: torch, dbPath: dbPath, clubMap: map[string]clubEntry{},
		ctx: ctx, cancel: cancel,
	}
	m.Console = console.New(feed, matchID)
	if opts.Console != nil {
		m.Console.SetOutput(opts.Console, false)
	}
	if data, err := os.ReadFile(filepath.Join(dir, "club_sessions.json")); err == nil {
		_ = json.Unmarshal(data, &m.clubMap)
	}
	if err := feed.MatchStart(matchID, m.founder, opts.SetPiece, cfg.Project.Name, kit.MachineName()); err != nil {
		feed.Close()
		cancel()
		return nil, err
	}
	if opts.TicketID != "" {
		_ = feed.MatchTicket(matchID, opts.TicketID)
	}
	// This process is the match. Record it before any objective opens, so a
	// match that hangs in its first player call is still findable by id.
	command := opts.Command
	if command == "" {
		command = strings.Join(append([]string{filepath.Base(os.Args[0])}, os.Args[1:]...), " ")
	}
	feed.ProcessStart(matchID, "setpiece", "", os.Getpid(), command)
	if !opts.NoSignals {
		m.finalizeWhenKilled()
	}
	m.Console.MatchStarted(matchID, m.founder)
	return m, nil
}

// finalizeWhenKilled: a killed match still closes its own record. Without
// this, Ctrl-C or `kill <pid>` would leave the match reading `running`
// forever with its process rows open. The signal records the match as a
// turnover, cancels the running club or check (and its children), and the
// open objective fails on the way out; the command exits 128 + signal.
func (m *Match) finalizeWhenKilled() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	done := make(chan struct{})
	go func() {
		select {
		case sig := <-ch:
			m.mu.Lock()
			m.signaled = sig
			m.mu.Unlock()
			_ = m.Feed.MatchFinish(m.id, false)
			m.cancel()
		case <-done:
		}
	}()
	m.stopSig = func() { signal.Stop(ch); close(done) }
}

// Signaled is the signal that stopped the match, or nil.
func (m *Match) Signaled() os.Signal {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.signaled
}

// OnClose registers work for Close (the relay's last send).
func (m *Match) OnClose(fn func()) { m.onClose = append(m.onClose, fn) }

// Close releases the match: the last relay send, the signal handler, the log.
func (m *Match) Close() {
	for _, fn := range m.onClose {
		fn()
	}
	if m.stopSig != nil {
		m.stopSig()
	}
	m.cancel()
	_ = m.Feed.Close()
}

// ── accessors (Runner, qa.Pitch) ────────────────────────────────────────────

// ID is the match id.
func (m *Match) ID() string { return m.id }

// Founder is the human's lane label.
func (m *Match) Founder() string { return m.founder }

// MatchID implements qa.Pitch.
func (m *Match) MatchID() string { return m.id }

// RepoRoot is where every player is spawned to work.
func (m *Match) RepoRoot() string { return m.root }

// Dir is the match's runtime directory.
func (m *Match) Dir() string { return m.dir }

// TorchPassDir is where players hand work to each other.
func (m *Match) TorchPassDir() string { return m.torchPass }

// DBPath is the match log's path.
func (m *Match) DBPath() string { return m.dbPath }

// Context is cancelled when the match is interrupted.
func (m *Match) Context() context.Context { return m.ctx }

// Checks are the config's qa checks.
func (m *Match) Checks() []boardroom.QACheck { return m.Cfg.QA.Checks }

// Note is a console note in the current objective.
func (m *Match) Note(message string) { m.Console.Note(message) }

// Event records an event.
func (m *Match) Event(rec matchfeed.EventRecord) string { return m.Feed.Event(rec) }

// CurrentObjective is the open objective's id and seq (seq 0 when none).
func (m *Match) CurrentObjective() (string, int) {
	if m.current == nil {
		if n := len(m.Objectives); n > 0 {
			last := m.Objectives[n-1]
			return last.ObjectiveID, last.Seq
		}
		return "", 0
	}
	return m.current.ObjectiveID, m.current.Seq
}

// AddUsage adds a club call's spend to the match totals, which mirror what
// the feed accumulates in the log.
func (m *Match) AddUsage(tokens int, cost float64) {
	m.Tokens += tokens
	m.Cost += cost
	_ = m.Feed.MatchAddUsage(m.id, tokens, cost)
}

func (m *Match) saveClubMap(player string, entry clubEntry) {
	m.clubMap[player] = entry
	data, _ := json.MarshalIndent(m.clubMap, "", "  ")
	_ = os.WriteFile(filepath.Join(m.dir, "club_sessions.json"), data, 0o644)
}

// ── the objective primitive ─────────────────────────────────────────────────

// ErrInterrupted is returned for an objective that could not start because
// the match was stopped by a signal.
var ErrInterrupted = errors.New("the match was interrupted")

// Objective runs fn as one objective. A returned error (or a panic) records
// the objective as a turnover, writes `error` then `objective_end`, finishes
// the match as a turnover and is returned; a clean return records a touchdown.
func (m *Match) Objective(p Params, fn func(h Handle) error) (err error) {
	if err := p.Validate(); err != nil {
		return err
	}
	if m.ctx.Err() != nil {
		return ErrInterrupted
	}
	m.seq++
	o := &Objective{Objective: matchfeed.Objective{
		ObjectiveID: fmt.Sprintf("%s_%02d_%s", m.id, m.seq, p.Name), MatchID: m.id, Seq: m.seq,
		Name: p.Name, Kind: p.Kind, Owner: p.Owner, Description: strings.Join(strings.Fields(p.Description), " "),
		Status: "running", Retries: p.Retries, StartedAt: kit.NowISO(),
	}, clock: kit.Now()}
	m.Objectives = append(m.Objectives, o)
	_ = m.Feed.ObjectiveUpsert(o.Objective)
	m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "objective_start", Name: p.Name,
		Payload: map[string]any{"kind": p.Kind, "owner": p.Owner, "description": o.Description}})
	m.Console.ObjectiveStarted(o.ObjectiveID, o.Seq, p.Name, p.Kind, p.Owner, o.Description)
	m.current = o
	defer func() { m.current = nil }()

	defer func() {
		if r := recover(); r != nil {
			m.fail(o, fmt.Errorf("panic: %v", r))
			panic(r)
		}
	}()
	if err := fn(&handle{m: m, o: o}); err != nil {
		if sig := m.Signaled(); sig != nil && m.ctx.Err() != nil {
			err = fmt.Errorf("%w (%v): %v", ErrInterrupted, sig, err)
		}
		m.fail(o, err)
		return err
	}
	o.Status = reports.Touchdown
	o.EndedAt = kit.NowISO()
	m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "objective_end", Name: p.Name,
		Payload: map[string]any{"status": reports.Touchdown}})
	_ = m.Feed.ObjectiveUpsert(o.Objective)
	m.Console.ObjectiveEnded(p.Name, o.Status, "", kit.Since(o.clock).Seconds())
	return nil
}

func (m *Match) fail(o *Objective, err error) {
	o.Status = reports.Turnover // success must be earned
	o.Error = kit.Head(err.Error(), 1000)
	o.EndedAt = kit.NowISO()
	m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "error", Name: o.Name,
		Payload: map[string]any{"error": o.Error}})
	m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: o.ObjectiveID, Type: "objective_end", Name: o.Name,
		Payload: map[string]any{"status": reports.Turnover}})
	_ = m.Feed.ObjectiveUpsert(o.Objective)
	_ = m.Feed.MatchFinish(m.id, false)
	m.Console.ObjectiveEnded(o.Name, o.Status, o.Error, kit.Since(o.clock).Seconds())
	m.Console.MatchFinished(false, m.Tokens, m.Cost, m.dbPath)
}

// Finish settles the match and returns its exit code. Call it exactly once.
//
// Two criteria, not one: every objective must have passed, AND the set
// piece's own acceptance test must hold. They are different questions on
// purpose: a test objective that ran the suite did its job even when the
// suite came back red, so the OBJECTIVE succeeds while the MATCH must not.
// One call settles the log, the banner and the exit code together, so the
// three cannot disagree. (Legacy once recorded a red suite as green in the
// log and the page while exiting 1.)
func (m *Match) Finish(accepted bool, reason string) int {
	objectivesOK := len(m.Objectives) > 0
	for _, o := range m.Objectives {
		if o.Status != reports.Touchdown {
			objectivesOK = false
		}
	}
	ok := objectivesOK && accepted
	if objectivesOK && !accepted {
		note := reason
		if note == "" {
			note = "the match's acceptance criterion was not met"
		}
		last := ""
		if n := len(m.Objectives); n > 0 {
			last = m.Objectives[n-1].ObjectiveID
		}
		m.Feed.Event(matchfeed.EventRecord{MatchID: m.id, ObjectiveID: last, Type: "error", Name: "not_accepted",
			Payload: map[string]any{"reason": note}})
		m.Console.Note("not accepted: " + note)
	}
	_ = m.Feed.MatchFinish(m.id, ok)
	m.Console.MatchFinished(ok, m.Tokens, m.Cost, m.dbPath)
	if ok {
		return 0
	}
	return 1
}

// ── the handle ──────────────────────────────────────────────────────────────

type handle struct {
	m *Match
	o *Objective
}

// Log records key/value pairs in order; on a head coach objective an
// `input` key also becomes the match's ask.
func (h *handle) Log(kv ...any) {
	payload := map[string]any{}
	var parts []string
	for i := 0; i+1 < len(kv); i += 2 {
		key := fmt.Sprint(kv[i])
		payload[key] = kv[i+1]
		parts = append(parts, fmt.Sprintf("%s: %v", key, kv[i+1]))
	}
	h.m.Feed.Event(matchfeed.EventRecord{MatchID: h.m.id, ObjectiveID: h.o.ObjectiveID, Type: "log",
		Name: h.o.Name, Payload: payload})
	h.m.Console.Note(strings.Join(parts, ", "))
	if h.o.Kind == HeadCoach {
		if input, ok := payload["input"]; ok {
			_ = h.m.Feed.MatchAsk(h.m.id, fmt.Sprint(input))
		}
	}
}

// Call runs a player, only inside a player objective.
func (h *handle) Call(call Call) (reports.Report, error) {
	if h.o.Kind != Player {
		return nil, errors.New("Call() is only valid inside a player objective")
	}
	return h.m.execute(h.o, call)
}
