package demo

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kickoff"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/scheduler"
	setpieces "github.com/dehanz13/one-generalist-software-fleet-mvp1/set_pieces"
)

// The tour's week: Sprint 14 runs two weeks from its first day. The tickets
// the tour plays come from the scenarios; these are the rest of the board.
const sprintPath = "set_pieces/upcoming/sprint-14.md"

type extraTicket struct {
	id, title, setPiece, mode, player, spec, prompt string
	day                                             int
	at                                              string
}

var extraTickets = []extraTicket{
	{id: "KICK-100", title: "Pick the kit colours", setPiece: "ask", mode: "manual", player: "ranger", day: 0, at: "14:30",
		prompt: "Which two colours would read best on the scoreboard for Reds and Blues?"},
	{id: "KICK-108", title: "Export the score as CSV", setPiece: "run-mythic", mode: "auto", day: 4, at: "16:30",
		spec: "specs/demo-quests/score-csv.md"},
	{id: "KICK-109", title: "Reset the score at full time", setPiece: "run-heroic", mode: "auto", day: 7, at: "14:00",
		prompt: "When the timer stops, reset the score to zero for both teams and keep the final score on /last."},
	{id: "KICK-110", title: "Plan half-time", setPiece: "team-talk", mode: "manual", day: 8, at: "15:00",
		prompt: "Plan a half-time break: the timer pauses and /score says HT."},
	{id: "KICK-111", title: "Which routes have no test?", setPiece: "ask", mode: "manual", player: "ranger", day: 9, at: "14:30",
		prompt: "List every route in src/server.ts that scripts/test.sh does not check."},
	{id: "KICK-112", title: "A penalty shootout, from its spec", setPiece: "run-mythic", mode: "auto", day: 10, at: "14:00",
		spec: "specs/demo-quests/penalties.md"},
	{id: "KICK-113", title: "Write up the sprint", setPiece: "bard", mode: "manual", day: 11, at: "16:00",
		prompt: "Write up what Sprint 14 changed, from the diff since the sprint began."},
}

// sprintFile is the markdown the founder would have written on day one.
func sprintFile(day0 time.Time) string {
	type entry struct {
		id, title, setPiece, mode, player, spec, prompt string
		day                                             int
		at                                              string
	}
	var all []entry
	for _, s := range scenarios() {
		if s.ticket == "" {
			continue
		}
		mode := "manual"
		if s.via == "tick" {
			mode = "auto"
		}
		e := entry{id: s.ticket, title: s.title, setPiece: s.command, mode: mode, player: s.args.Player, day: s.day, at: s.at,
			prompt: s.args.Prompt}
		if strings.HasSuffix(s.raw, ".md") {
			e.spec, e.prompt = s.raw, ""
		}
		all = append(all, e)
	}
	for _, x := range extraTickets {
		all = append(all, entry(x))
	}
	end := day0.AddDate(0, 0, 11)
	var b strings.Builder
	fmt.Fprintf(&b, "---\nsprint: Sprint 14\ntimezone: UTC\n---\n\n# Sprint 14 · %s – %s\n\n", day0.Format("2 Jan"), end.Format("2 Jan"))
	b.WriteString("Two weeks of kickabout: a health check, goals over HTTP, a match timer, and a cleaner scoreboard.\n")
	for _, e := range all {
		fmt.Fprintf(&b, "\n## %s · %s\ndate: %s\ntime: %s\nset piece: %s\nmode: %s\n", e.id, e.title,
			day0.AddDate(0, 0, e.day).Format("2006-01-02"), e.at, e.setPiece, e.mode)
		if e.player != "" {
			fmt.Fprintf(&b, "player: %s\n", e.player)
		}
		if e.spec != "" {
			fmt.Fprintf(&b, "spec: %s\n", e.spec)
		} else {
			fmt.Fprintf(&b, "\n%s\n", e.prompt)
		}
	}
	return b.String()
}

// step is something the founder (or the Scheduler) does between matches.
type step struct {
	day  int
	at   string
	show string // the command, as typed
	do   func(t *tourRun) (string, error)
}

func steps() []step {
	return []step{
		{day: 0, at: "13:55", show: "ogsf upcoming", do: func(t *tourRun) (string, error) {
			tickets, err := t.sched.Sync()
			return fmt.Sprintf("Sprint 14 on the board: %d tickets", len(tickets)), err
		}},
		{day: 1, at: "16:00", show: "(page) request run-heroic", do: func(t *tourRun) (string, error) {
			r, err := t.feed.RequestCreate(matchfeed.RequestRow{RequestedBy: "page", Kind: "set_piece", SetPiece: "run-heroic",
				Prompt: "Ship the match timer straight to main."})
			if err != nil {
				return "", err
			}
			if _, err := t.sched.Tick(context.Background()); err != nil {
				return "", err
			}
			got, _ := t.feed.Request(r.RequestID)
			return "the Scheduler " + got.Status + " it: " + got.Note, nil
		}},
		{day: 3, at: "16:20", show: "ogsf request --set-piece ask", do: func(t *tourRun) (string, error) {
			r, err := t.feed.RequestCreate(matchfeed.RequestRow{RequestedBy: "cli", Kind: "set_piece", SetPiece: "ask",
				Player: "ranger", Prompt: "Which file grew the most this week?"})
			if err != nil {
				return "", err
			}
			kit.Sleep(2 * time.Minute)
			if _, err := t.feed.RequestCancel(r.RequestID); err != nil {
				return "", err
			}
			return "queued, then cancelled before the Scheduler took it", nil
		}},
		{day: 4, at: "16:30", show: "ogsf scheduler", do: func(t *tourRun) (string, error) {
			if _, err := t.sched.Tick(context.Background()); err != nil {
				return "", err
			}
			rows, _ := t.feed.UpcomingRows()
			for _, r := range rows {
				if r.TicketID == "KICK-108" {
					return "KICK-108 is due, but " + r.Status + ": " + r.Note, nil
				}
			}
			return "", fmt.Errorf("KICK-108 is not on the board")
		}},
		{day: 4, at: "18:30", show: "(page) request ask", do: func(t *tourRun) (string, error) {
			_, err := t.feed.RequestCreate(matchfeed.RequestRow{RequestedBy: "page", Kind: "set_piece", SetPiece: "ask",
				Player: "ranger", Prompt: "What should next week's first ticket be?"})
			return "queued for Monday: the Scheduler is off for the weekend", err
		}},
		{day: 4, at: "18:35", show: "ogsf upcoming", do: func(t *tourRun) (string, error) {
			if _, err := t.sched.Sync(); err != nil {
				return "", err
			}
			rows, err := t.feed.UpcomingRows()
			count := map[string]int{}
			for _, r := range rows {
				count[r.Status]++
			}
			return fmt.Sprintf("%d played, %d skipped, %d due, %d scheduled", count["touchdown"]+count["turnover"],
				count["skipped"], count["due"], count["scheduled"]), err
		}},
	}
}

// launcher is the Scheduler's way into the tour: the scenario waiting to be
// started plays, on the match id and with the prompt the Scheduler gives it.
func (t *tourRun) launcher(ctx context.Context, l scheduler.Launch) (int, error) {
	s := t.current
	t.current = nil
	if s == nil {
		// A ticket with no scenario: only its kickoff checklist runs, as it
		// would for real. The tour has none that should pass.
		var failed []kickoff.Check
		for _, c := range kickoff.Run(l.RawPrompt, false, l.SetPiece) {
			if !c.Passed {
				failed = append(failed, c)
			}
		}
		if len(failed) > 0 {
			return kickoff.ExitCode, &setpieces.KickoffRefused{Failed: failed}
		}
		return 1, fmt.Errorf("the tour has no script for %s", l.TicketID)
	}
	s.args.MatchID, s.args.Prompt, s.raw = l.MatchID, l.Prompt, l.RawPrompt
	if l.Player != "" {
		s.args.Player = l.Player
	}
	t.ticket = l.TicketID
	defer func() { t.ticket = "" }()
	return t.launch(*s, l.TicketID)
}
