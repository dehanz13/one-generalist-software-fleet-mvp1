// Package scheduler is `ogsf scheduler`: the long-running process on a Mac
// that starts Upcoming Matches tickets when they are due and, when the
// founder allows it, runs the requests made on Matchday Live, through the
// Claude connector or with `ogsf request`. (New in version 2.)
//
// One match at a time, always: a Mac's working tree belongs to one match. A
// request runs only with `scheduler.accept_remote: true`; a request by set
// piece name only for the set pieces in `scheduler.allowed_set_pieces`. Every
// match still passes its kickoff checklist.
package scheduler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kickoff"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/relay"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/upcoming"
)

// Launch is one match to start.
type Launch struct {
	SetPiece  string
	Prompt    string // resolved text
	RawPrompt string // as written: a quest spec stays a path, for the kickoff checklist
	Player    string
	MatchID   string // minted here, so the ticket or request can name it before it starts
	TicketID  string
}

// Launcher starts a match and returns its exit code. The command line wires
// the real one (set_pieces.Launch); tests and the demo wire their own.
type Launcher func(ctx context.Context, l Launch) (int, error)

// Cloud is the fleet API: requests queued on the cloud page or by the connector.
type Cloud interface {
	Claim(ctx context.Context, machine string, accepts []string) (*relay.Remote, error)
	Update(ctx context.Context, requestID, status, matchID, note string) error
}

// Options shape a scheduler.
type Options struct {
	Config     *boardroom.Config
	Feed       *matchfeed.Feed
	Machine    string
	Launch     Launcher
	IsSetPiece func(string) bool
	Cloud      Cloud // nil without a relay
	Out        io.Writer
}

// Scheduler starts due tickets and accepted requests, one at a time.
type Scheduler struct {
	opts Options
}

// New returns a scheduler.
func New(opts Options) *Scheduler {
	if opts.Out == nil {
		opts.Out = io.Discard
	}
	if opts.Machine == "" {
		opts.Machine = kit.MachineName()
	}
	return &Scheduler{opts: opts}
}

func (s *Scheduler) say(format string, args ...any) {
	fmt.Fprintf(s.opts.Out, "%s  %s\n", kit.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
}

// Sync reads every source into upcoming_matches and reports skipped tickets.
func (s *Scheduler) Sync() ([]upcoming.Ticket, error) {
	tickets, problems := upcoming.Load(s.opts.Config, s.opts.IsSetPiece)
	for _, p := range problems {
		s.say("skipped a ticket: %v", p)
	}
	return tickets, upcoming.Sync(s.opts.Feed, tickets, s.opts.Machine, kit.Now())
}

func (s *Scheduler) row(ticketID string) (*matchfeed.UpcomingRow, error) {
	rows, err := s.opts.Feed.UpcomingRows()
	if err != nil {
		return nil, err
	}
	for i := range rows {
		if rows[i].TicketID == ticketID {
			return &rows[i], nil
		}
	}
	return nil, nil
}

// ErrAlreadyPlayed is a ticket that has run, or is running.
var ErrAlreadyPlayed = errors.New("already played")

// RunTicket plays one ticket now: auto when it is due, manual when a person
// (or an accepted request) asks. It returns the match id, and the match's
// error when it did not end well.
func (s *Scheduler) RunTicket(ctx context.Context, ticketID string) (string, error) {
	if _, err := s.Sync(); err != nil {
		return "", err
	}
	row, err := s.row(ticketID)
	if err != nil {
		return "", err
	}
	if row == nil {
		return "", fmt.Errorf("no ticket %s in the Upcoming Matches sources", ticketID)
	}
	switch row.Status {
	case "running", "touchdown", "turnover":
		return row.MatchID, fmt.Errorf("ticket %s is %s (match %s): %w", ticketID, row.Status, row.MatchID, ErrAlreadyPlayed)
	}
	matchID, launchErr, err := s.play(ctx, row)
	if err != nil {
		return matchID, err
	}
	return matchID, launchErr
}

// play starts a ticket's match and records how it ended on the ticket. A
// match that ended badly is launchErr, already on the board; err is the
// board itself failing.
func (s *Scheduler) play(ctx context.Context, row *matchfeed.UpcomingRow) (matchID string, launchErr, err error) {
	if spec := upcoming.SpecPath(row.Prompt); spec != "" {
		if _, statErr := os.Stat(spec); statErr != nil {
			// Read as a prompt, a missing path would start a match on the
			// words "specs/…md". The ticket said it was a file; wait for it.
			row.Status, row.MatchID, row.Note = "skipped", "", "its spec "+spec+" does not exist yet: write and commit it, then `ogsf upcoming run "+row.TicketID+"`"
			s.say("%s skipped: %s", row.TicketID, row.Note)
			return "", errors.New(row.Note), s.opts.Feed.UpcomingUpsert(*row)
		}
	}
	matchID = kit.NewID(8)
	row.Status, row.MatchID, row.Machine, row.Note = "running", matchID, s.opts.Machine, ""
	if err := s.opts.Feed.UpcomingUpsert(*row); err != nil {
		return "", nil, err
	}
	s.say("%s %q → %s (match %s)", row.TicketID, row.Title, row.SetPiece, matchID)
	code, launchErr := s.opts.Launch(ctx, Launch{SetPiece: row.SetPiece, Prompt: kit.ResolvePrompt(row.Prompt),
		RawPrompt: row.Prompt, Player: row.Player, MatchID: matchID, TicketID: row.TicketID})
	status := s.opts.Feed.MatchStatus(matchID)
	switch {
	case code == kickoff.ExitCode:
		row.Status, row.MatchID, row.Note = "skipped", "", "the kickoff checklist refused it: "+errText(launchErr)
	case status == "touchdown" || status == "turnover":
		row.Status, row.Note = status, errText(launchErr)
	default:
		row.Status, row.Note = "turnover", errText(launchErr)
		if status == "" {
			row.MatchID = ""
		}
	}
	if err := s.opts.Feed.UpcomingUpsert(*row); err != nil {
		return row.MatchID, launchErr, err
	}
	if row.Note != "" {
		s.say("%s %s: %s", row.TicketID, row.Status, row.Note)
	} else {
		s.say("%s %s", row.TicketID, row.Status)
	}
	return row.MatchID, launchErr, nil
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return kit.Head(strings.TrimSpace(err.Error()), 500)
}

// request is one request, wherever it came from.
type request struct {
	id, kind, setPiece, prompt, player, ticketID, by string
	update                                           func(status, matchID, note string) error
}

func (s *Scheduler) allowed(setPiece string) bool {
	for _, a := range s.opts.Config.Scheduler.AllowedSetPieces {
		if a == setPiece {
			return true
		}
	}
	return false
}

// handle runs one claimed request and settles it.
func (s *Scheduler) handle(ctx context.Context, r request) error {
	switch r.kind {
	case "ticket":
		matchID, err := s.RunTicket(ctx, r.ticketID)
		if errors.Is(err, ErrAlreadyPlayed) {
			// The Scheduler started the ticket itself (it was due) before this
			// request was claimed. The request asked for exactly that match,
			// so it takes its result; a match still running is refused, with
			// its id in the note, because nothing would settle the request.
			if status := s.opts.Feed.MatchStatus(matchID); status == "touchdown" || status == "turnover" {
				return r.update(status, matchID, "already played: the Scheduler started it when it was due (match "+matchID+")")
			}
			return r.update("refused", "", errText(err))
		}
		if matchID == "" {
			return r.update("refused", "", errText(err))
		}
		return r.update(statusOr(s.opts.Feed.MatchStatus(matchID), "turnover"), matchID, errText(err))
	case "set_piece":
		if !s.allowed(r.setPiece) {
			return r.update("refused", "", fmt.Sprintf("%s is not in this Mac's scheduler.allowed_set_pieces", r.setPiece))
		}
		if strings.TrimSpace(r.prompt) == "" {
			return r.update("refused", "", "the request has no prompt")
		}
		matchID := kit.NewID(8)
		if err := r.update("running", matchID, ""); err != nil {
			return err
		}
		s.say("request %s from %s → %s (match %s)", r.id, r.by, r.setPiece, matchID)
		code, err := s.opts.Launch(ctx, Launch{SetPiece: r.setPiece, Prompt: r.prompt, RawPrompt: r.prompt,
			Player: r.player, MatchID: matchID})
		if code == kickoff.ExitCode {
			return r.update("refused", "", "the kickoff checklist refused it: "+errText(err))
		}
		return r.update(statusOr(s.opts.Feed.MatchStatus(matchID), "turnover"), matchID, errText(err))
	}
	return r.update("refused", "", fmt.Sprintf("unknown request kind %q", r.kind))
}

func statusOr(status, fallback string) string {
	if status == "touchdown" || status == "turnover" {
		return status
	}
	return fallback
}

// Tick does one round: sync the sources, then start at most one match, in
// this order: the earliest due auto ticket, a request queued on this Mac, a
// request queued in the cloud. It reports whether it started one.
func (s *Scheduler) Tick(ctx context.Context) (bool, error) {
	if _, err := s.Sync(); err != nil {
		return false, err
	}
	rows, err := s.opts.Feed.UpcomingRows()
	if err != nil {
		return false, err
	}
	for i := range rows {
		if rows[i].Mode == "auto" && rows[i].Status == "due" {
			_, _, err := s.play(ctx, &rows[i])
			return true, err
		}
	}
	if !s.opts.Config.Scheduler.AcceptRemote {
		return false, nil
	}
	local, err := s.opts.Feed.RequestClaim(s.opts.Machine)
	if err != nil {
		return false, err
	}
	if local != nil {
		feed := s.opts.Feed
		return true, s.handle(ctx, request{id: local.RequestID, kind: local.Kind, setPiece: local.SetPiece,
			prompt: local.Prompt, player: local.Player, ticketID: local.TicketID, by: local.RequestedBy,
			update: func(status, matchID, note string) error {
				return feed.RequestUpdate(local.RequestID, status, matchID, note)
			}})
	}
	if s.opts.Cloud == nil {
		return false, nil
	}
	remote, err := s.opts.Cloud.Claim(ctx, s.opts.Machine, s.opts.Config.Scheduler.AllowedSetPieces)
	if err != nil || remote == nil {
		return false, err
	}
	cloud := s.opts.Cloud
	return true, s.handle(ctx, request{id: remote.RequestID, kind: remote.Kind, setPiece: remote.SetPiece,
		prompt: remote.Prompt, player: remote.Player, ticketID: remote.TicketID, by: remote.RequestedBy,
		update: func(status, matchID, note string) error {
			return cloud.Update(context.Background(), remote.RequestID, status, matchID, note)
		}})
}

// Run ticks until ctx ends: straight away after a match, otherwise every
// poll_seconds. A failed round is reported and the loop goes on.
func (s *Scheduler) Run(ctx context.Context) error {
	release, err := kit.LockFile(s.opts.Config.Defaults.DataDir + string(os.PathSeparator) + "scheduler.lock")
	if err != nil {
		return fmt.Errorf("another scheduler is running on this Mac (%v)", err)
	}
	defer release()
	every := time.Duration(s.opts.Config.Scheduler.PollSeconds) * time.Second
	remote := "off (scheduler.accept_remote is false)"
	if s.opts.Config.Scheduler.AcceptRemote {
		remote = "on, for " + strings.Join(s.opts.Config.Scheduler.AllowedSetPieces, ", ") + " and any ticket"
		if s.opts.Cloud != nil {
			remote += ", local and cloud"
		} else {
			remote += ", local only (no relay)"
		}
	}
	s.say("scheduler on %s: every %s; requests %s", s.opts.Machine, every, remote)
	for {
		ran, err := s.Tick(ctx)
		if err != nil && ctx.Err() == nil {
			s.say("round failed: %v", err)
		}
		if ctx.Err() != nil {
			return nil
		}
		if ran {
			continue
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(every):
		}
	}
}
