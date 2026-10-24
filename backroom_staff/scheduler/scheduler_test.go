package scheduler

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kickoff"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/relay"
)

const board = `---
sprint: Sprint 14
---

## KICK-1 · Due and automatic
date: 2026-10-12
time: 09:00
set piece: team-talk
mode: auto

Plan the toggle.

## KICK-2 · Due but manual
date: 2026-10-12
time: 10:00
set piece: run-heroic

Build the toggle.

## KICK-3 · Not yet
date: 2026-10-20
set piece: team-talk
mode: auto

Later work.

## KICK-4 · Refused at kickoff
date: 2026-10-12
time: 11:00
set piece: run-mythic
mode: auto

The quest, as prose.

## KICK-5 · Its spec is not written yet
date: 2026-10-12
time: 11:30
set piece: run-mythic
mode: auto
spec: specs/demo-quests/not-yet.md
`

// fake plays matches without players: each launch writes a match that ends
// as the outcome says.
type fake struct {
	mu       sync.Mutex
	feed     *matchfeed.Feed
	launches []Launch
	outcome  func(Launch) (ok bool, code int, err error)
}

func (f *fake) launch(ctx context.Context, l Launch) (int, error) {
	f.mu.Lock()
	f.launches = append(f.launches, l)
	f.mu.Unlock()
	ok, code, err := true, 0, error(nil)
	if f.outcome != nil {
		ok, code, err = f.outcome(l)
	}
	if code == kickoff.ExitCode {
		return code, err // nothing ran, so no match
	}
	f.feed.MatchStart(l.MatchID, "Danniel", l.SetPiece, "kickabout", "mac")
	if l.TicketID != "" {
		f.feed.MatchTicket(l.MatchID, l.TicketID)
	}
	f.feed.MatchFinish(l.MatchID, ok)
	return code, err
}

type cloud struct {
	queue   []*relay.Remote
	updates []string
}

func (c *cloud) Claim(ctx context.Context, machine string, accepts []string) (*relay.Remote, error) {
	if len(c.queue) == 0 {
		return nil, nil
	}
	r := c.queue[0]
	c.queue = c.queue[1:]
	return r, nil
}

func (c *cloud) Update(ctx context.Context, id, status, matchID, note string) error {
	c.updates = append(c.updates, id+" "+status)
	return nil
}

func setUp(t *testing.T) (*Scheduler, *fake, *matchfeed.Feed, *boardroom.Config) {
	t.Helper()
	kit.UseVirtualClock(time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC))
	t.Cleanup(kit.UseRealClock)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sprint-14.md"), []byte(board), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := boardroom.Default()
	cfg.Defaults.DataDir = dir
	cfg.Upcoming.Sources = []boardroom.UpcomingSource{{Kind: "markdown", Path: filepath.Join(dir, "*.md")}}
	cfg.Upcoming.Timezone = "UTC"
	feed, err := matchfeed.Open(filepath.Join(dir, "match_log.db"), os.DevNull, matchfeed.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { feed.Close() })
	f := &fake{feed: feed, outcome: func(l Launch) (bool, int, error) {
		if l.SetPiece == "run-mythic" {
			return false, kickoff.ExitCode, errors.New("the kickoff checklist refused the dispatch: spec: no such file")
		}
		return true, 0, nil
	}}
	known := map[string]bool{"ask": true, "team-talk": true, "run-heroic": true, "run-mythic": true, "scout-opposition": true}
	s := New(Options{Config: cfg, Feed: feed, Machine: "mac", Launch: f.launch, IsSetPiece: func(n string) bool { return known[n] }})
	return s, f, feed, cfg
}

// clearDue plays every due auto ticket, so a test can look at requests alone.
func clearDue(s *Scheduler) {
	for i := 0; i < 3; i++ {
		s.Tick(context.Background())
	}
}

func ticketStatus(t *testing.T, feed *matchfeed.Feed, id string) matchfeed.UpcomingRow {
	t.Helper()
	rows, err := feed.UpcomingRows()
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.TicketID == id {
			return r
		}
	}
	t.Fatalf("no ticket %s", id)
	return matchfeed.UpcomingRow{}
}

func TestTickStartsDueAutoTicketsOneAtATimeAndNothingElse(t *testing.T) {
	s, f, feed, _ := setUp(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if _, err := s.Tick(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if len(f.launches) != 2 || f.launches[0].TicketID != "KICK-1" || f.launches[1].TicketID != "KICK-4" {
		t.Fatalf("launches: %+v", f.launches)
	}
	five := ticketStatus(t, feed, "KICK-5")
	if five.Status != "skipped" || !strings.Contains(five.Note, "does not exist yet") {
		t.Fatalf("a missing spec is never launched as a prompt: %+v", five)
	}
	one := ticketStatus(t, feed, "KICK-1")
	if one.Status != "touchdown" || one.MatchID != f.launches[0].MatchID || one.MatchID == "" {
		t.Fatalf("KICK-1: %+v", one)
	}
	if feed.MatchStatus(one.MatchID) != "touchdown" {
		t.Fatal("the match should exist and carry the ticket")
	}
	four := ticketStatus(t, feed, "KICK-4")
	if four.Status != "skipped" || four.MatchID != "" || !strings.Contains(four.Note, "kickoff checklist refused") {
		t.Fatalf("a kickoff refusal leaves the ticket skipped with the reason: %+v", four)
	}
	if got := ticketStatus(t, feed, "KICK-2").Status; got != "due" {
		t.Fatalf("a manual ticket waits for a person: %s", got)
	}
	if got := ticketStatus(t, feed, "KICK-3").Status; got != "scheduled" {
		t.Fatalf("a future ticket waits: %s", got)
	}
}

func TestRunTicketPlaysAManualTicketOnceOnly(t *testing.T) {
	s, f, feed, _ := setUp(t)
	matchID, err := s.RunTicket(context.Background(), "KICK-2")
	if err != nil || matchID == "" {
		t.Fatalf("run: %q %v", matchID, err)
	}
	if f.launches[0].Prompt != "Build the toggle." || f.launches[0].SetPiece != "run-heroic" {
		t.Fatalf("launch: %+v", f.launches[0])
	}
	if got := ticketStatus(t, feed, "KICK-2"); got.Status != "touchdown" || got.MatchID != matchID {
		t.Fatalf("KICK-2: %+v", got)
	}
	if _, err := s.RunTicket(context.Background(), "KICK-2"); !errors.Is(err, ErrAlreadyPlayed) {
		t.Fatalf("a played ticket is not played again: %v", err)
	}
	if _, err := s.RunTicket(context.Background(), "KICK-99"); err == nil {
		t.Fatal("an unknown ticket is an error")
	}
}

func TestRequestsRunOnlyWhenAcceptedAndAllowed(t *testing.T) {
	s, f, feed, cfg := setUp(t)
	ctx := context.Background()
	// Leave the due auto tickets out of the way.
	clearDue(s)
	f.launches = nil

	allowed, _ := feed.RequestCreate(matchfeed.RequestRow{RequestedBy: "page", Kind: "set_piece", SetPiece: "ask", Prompt: "Where is the cookie set?"})
	if ran, _ := s.Tick(ctx); ran || len(f.launches) != 0 {
		t.Fatal("with accept_remote false a request waits")
	}
	cfg.Scheduler.AcceptRemote = true
	if ran, err := s.Tick(ctx); !ran || err != nil {
		t.Fatalf("an accepted request runs: %v", err)
	}
	if got, _ := feed.Request(allowed.RequestID); got.Status != "touchdown" || got.MatchID == "" || got.ClaimedBy != "mac" {
		t.Fatalf("request: %+v", got)
	}

	notAllowed, _ := feed.RequestCreate(matchfeed.RequestRow{RequestedBy: "page", Kind: "set_piece", SetPiece: "run-heroic", Prompt: "Ship it"})
	s.Tick(ctx)
	if got, _ := feed.Request(notAllowed.RequestID); got.Status != "refused" || !strings.Contains(got.Note, "allowed_set_pieces") {
		t.Fatalf("a set piece outside the allowlist is refused: %+v", got)
	}

	ticket, _ := feed.RequestCreate(matchfeed.RequestRow{RequestedBy: "cli", Kind: "ticket", TicketID: "KICK-2"})
	s.Tick(ctx)
	if got, _ := feed.Request(ticket.RequestID); got.Status != "touchdown" {
		t.Fatalf("a ticket request may start any ticket: %+v", got)
	}
	again, _ := feed.RequestCreate(matchfeed.RequestRow{RequestedBy: "cli", Kind: "ticket", TicketID: "KICK-2"})
	s.Tick(ctx)
	played, _ := feed.Request(ticket.RequestID)
	if got, _ := feed.Request(again.RequestID); got.Status != "touchdown" || got.MatchID != played.MatchID ||
		!strings.Contains(got.Note, "already played") {
		t.Fatalf("a request for a ticket that was played meanwhile takes that match: %+v", got)
	}
	never, _ := feed.RequestCreate(matchfeed.RequestRow{RequestedBy: "cli", Kind: "ticket", TicketID: "KICK-99"})
	s.Tick(ctx)
	if got, _ := feed.Request(never.RequestID); got.Status != "refused" || !strings.Contains(got.Note, "no ticket KICK-99") {
		t.Fatalf("an unknown ticket's request is refused: %+v", got)
	}
	if len(f.launches) != 2 {
		t.Fatalf("two matches ran: %+v", f.launches)
	}
}

func TestCloudRequestsAreClaimedAfterLocalOnesAndSettled(t *testing.T) {
	s, f, _, cfg := setUp(t)
	ctx := context.Background()
	clearDue(s)
	f.launches = nil
	cfg.Scheduler.AcceptRemote = true
	c := &cloud{queue: []*relay.Remote{
		{RequestID: "req_a", RequestedBy: "connector", Kind: "set_piece", SetPiece: "team-talk", Prompt: "Plan it"},
		{RequestID: "req_b", RequestedBy: "connector", Kind: "set_piece", SetPiece: "run-mythic", Prompt: "specs/x.md"},
	}}
	s.opts.Cloud = c
	s.Tick(ctx)
	s.Tick(ctx)
	want := "req_a running,req_a touchdown,req_b refused"
	if got := strings.Join(c.updates, ","); got != want {
		t.Fatalf("updates: %s, want %s", got, want)
	}
	if len(f.launches) != 1 || f.launches[0].SetPiece != "team-talk" {
		t.Fatalf("launches: %+v", f.launches)
	}
}

func TestOnlyOneSchedulerRunsPerMac(t *testing.T) {
	s, _, _, cfg := setUp(t)
	cfg.Scheduler.PollSeconds = 3600
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Run(ctx) }()
	time.Sleep(200 * time.Millisecond)
	if err := New(s.opts).Run(context.Background()); err == nil || !strings.Contains(err.Error(), "another scheduler") {
		t.Fatalf("a second scheduler should be refused: %v", err)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
