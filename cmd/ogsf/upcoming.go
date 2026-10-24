package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kickoff"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/relay"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/scheduler"
	setpieces "github.com/dehanz13/one-generalist-software-fleet-mvp1/set_pieces"
)

// launcher starts a match for the Scheduler exactly as the command line
// would: kickoff checklist, then the set piece, with the ticket recorded on
// the match.
func launcher(path string) scheduler.Launcher {
	return func(ctx context.Context, l scheduler.Launch) (int, error) {
		piece, ok := setpieces.Get(l.SetPiece)
		if !ok {
			return 1, fmt.Errorf("no set piece %q", l.SetPiece)
		}
		currentTicket = l.TicketID
		defer func() { currentTicket = "" }()
		code, err := setpieces.Launch(setpieces.DefaultDeps(path, ensure), piece,
			setpieces.Args{Prompt: l.Prompt, MatchID: l.MatchID, Player: l.Player}, l.RawPrompt, false, os.Stdout)
		if signaled := closeOpen(); signaled != nil && err == nil {
			// The match recorded its own turnover; the Scheduler's context
			// sees the same signal and stops after this.
			err = fmt.Errorf("stopped by %v", signaled)
		}
		return code, err
	}
}

// planning opens the config, a feed on the match log (queueing rows for the
// relay when one is set up) and a scheduler over them.
func planning(config string) (*boardroom.Config, *matchfeed.Feed, *scheduler.Scheduler, *relay.Client, error) {
	path := configPath(config)
	cfg, err := boardroom.Load(path)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	client := relay.FromEnv()
	feed, err := matchfeed.Open(match.MatchLogPath(cfg), os.DevNull, matchfeed.Options{Outbox: client != nil})
	if err != nil {
		return nil, nil, nil, nil, err
	}
	opts := scheduler.Options{Config: cfg, Feed: feed, Launch: launcher(path), IsSetPiece: setpieces.IsSetPiece, Out: os.Stdout}
	if client != nil {
		opts.Cloud = client
	}
	return cfg, feed, scheduler.New(opts), client, nil
}

// pushRows sends queued rows (the board) to Matchday Live, briefly.
func pushRows(client *relay.Client, feed *matchfeed.Feed) {
	if client == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := client.Drain(ctx, feed.DB); err != nil {
		fmt.Fprintln(os.Stderr, "relay: "+err.Error()+" — `ogsf relay push` sends the rest")
	}
}

func upcomingCommands() []*cobra.Command {
	var config string
	upcomingCmd := &cobra.Command{
		Use: "upcoming", GroupID: "plan",
		Short: "Upcoming Matches: the planned tickets, read from their sources, with their status",
		Long: "Read every Upcoming Matches source (set_pieces/upcoming/*.md by default), bring the board up to date\n" +
			"and list it. A ticket names the day it is to be worked, the set piece that works it, and whether the\n" +
			"Scheduler starts it when due (mode: auto) or a person does (mode: manual). The format is in\n" +
			"set_pieces/upcoming/README.md.",
		RunE: func(cmd *cobra.Command, args []string) error {
			_, feed, sched, client, err := planning(config)
			if err != nil {
				return err
			}
			defer feed.Close()
			if _, err := sched.Sync(); err != nil {
				return err
			}
			rows, err := feed.UpcomingRows()
			if err != nil {
				return err
			}
			if len(rows) == 0 {
				fmt.Println("no upcoming matches: add tickets to set_pieces/upcoming/*.md (see its README.md)")
			} else {
				w := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
				fmt.Fprintln(w, "ticket\tdue\tset piece\tmode\tstatus\tmatch\ttitle")
				for _, r := range rows {
					due := r.Date
					if r.DueAt != "" {
						if t, err := time.Parse(time.RFC3339, r.DueAt); err == nil {
							due = t.Local().Format("Mon 02 Jan 15:04")
						}
					}
					fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", r.TicketID, due, r.SetPiece, r.Mode, r.Status, r.MatchID, r.Title)
				}
				w.Flush()
			}
			pushRows(client, feed)
			return nil
		},
	}
	upcomingCmd.PersistentFlags().StringVar(&config, "config", "", "the club config (default $CLUB_CONFIG or "+boardroom.DefaultPath+")")
	upcomingCmd.AddCommand(&cobra.Command{
		Use: "run <ticket-id>", Short: "play one ticket now, auto or manual", Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			_, feed, sched, client, err := planning(config)
			if err != nil {
				return err
			}
			defer feed.Close()
			defer pushRows(client, feed)
			matchID, err := sched.RunTicket(context.Background(), args[0])
			var refused *setpieces.KickoffRefused
			switch {
			case errors.Is(err, scheduler.ErrAlreadyPlayed):
				return err
			case errors.As(err, &refused):
				return exitError{kickoff.ExitCode}
			case err != nil:
				return finish(1, err)
			}
			status := feed.MatchStatus(matchID)
			if status != "touchdown" {
				return exitError{1}
			}
			return nil
		},
	})

	var once bool
	schedulerCmd := &cobra.Command{
		Use: "scheduler", GroupID: "plan",
		Short: "start due tickets, and accepted requests, one match at a time, until stopped",
		Long: "Run on the Mac that does the work. Every scheduler.poll_seconds it reads the Upcoming Matches sources,\n" +
			"starts the earliest due auto ticket, and, when scheduler.accept_remote is true, takes requests made on\n" +
			"this Mac (`ogsf request`, the local page) and in the cloud (Matchday Live, the Claude connector). One\n" +
			"match at a time; every match passes its kickoff checklist. A ticket whose spec file does not exist yet\n" +
			"is skipped with a note, never launched. Ctrl-C stops it; a match in progress stops too and is recorded\n" +
			"as a turnover, like any match stopped by a signal.",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, feed, sched, client, err := planning(config)
			if err != nil {
				return err
			}
			defer feed.Close()
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			if client != nil {
				every := time.Duration(cfg.Var.FlushMS) * time.Millisecond
				if every <= 0 {
					every = time.Second
				}
				go client.Run(ctx, feed.DB, every, func(err error) { fmt.Fprintln(os.Stderr, "relay:", err) })
				defer pushRows(client, feed)
			}
			if once {
				_, err := sched.Tick(ctx)
				return err
			}
			return sched.Run(ctx)
		},
	}
	schedulerCmd.Flags().StringVar(&config, "config", "", "the club config")
	schedulerCmd.Flags().BoolVar(&once, "once", false, "one round, then stop")

	var setPiece, player, machine, ticket string
	requestCmd := &cobra.Command{
		Use: "request [\"<prompt>\"]", GroupID: "plan",
		Short: "queue a request for this Mac's scheduler: a set piece with a prompt, or a ticket",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, feed, sched, _, err := planning(config)
			if err != nil {
				return err
			}
			defer feed.Close()
			row := matchfeed.RequestRow{RequestedBy: "cli", Player: player, Machine: machine}
			switch {
			case ticket != "":
				if _, err := sched.Sync(); err != nil {
					return err
				}
				if status, ok := ticketOnBoard(feed, ticket); !ok {
					return fmt.Errorf("no ticket %s on the board (`ogsf upcoming` lists it)", ticket)
				} else if status == "queued" || status == "running" || status == "touchdown" || status == "turnover" {
					return fmt.Errorf("ticket %s is already %s", ticket, status)
				}
				row.Kind, row.TicketID = "ticket", ticket
			case setPiece != "" && len(args) == 1:
				if !setpieces.IsSetPiece(setPiece) {
					return fmt.Errorf("no set piece %q (one of: %s)", setPiece, strings.Join(setpieces.Names(), ", "))
				}
				row.Kind, row.SetPiece, row.Prompt = "set_piece", setPiece, args[0]
			default:
				return errors.New("name a set piece and a prompt (--set-piece ask \"…\"), or a ticket (--ticket KICK-7)")
			}
			created, err := feed.RequestCreate(row)
			if err != nil {
				return err
			}
			fmt.Printf("queued %s\n", created.RequestID)
			if !cfg.Scheduler.AcceptRemote {
				fmt.Println("note: scheduler.accept_remote is false in this config, so `ogsf scheduler` will not take it until you turn it on")
			}
			return nil
		},
	}
	requestCmd.Flags().StringVar(&config, "config", "", "the club config")
	requestCmd.Flags().StringVar(&setPiece, "set-piece", "", "the set piece to run")
	requestCmd.Flags().StringVar(&player, "player", "", "ask only: who answers")
	requestCmd.Flags().StringVar(&machine, "machine", "", "the Mac it is for (default: any)")
	requestCmd.Flags().StringVar(&ticket, "ticket", "", "an Upcoming Matches ticket to play instead")

	requestsCmd := &cobra.Command{
		Use: "requests", GroupID: "plan", Short: "the requests queued on this Mac, newest first",
		RunE: func(cmd *cobra.Command, args []string) error {
			_, feed, _, _, err := planning(config)
			if err != nil {
				return err
			}
			defer feed.Close()
			list, err := feed.Requests(50)
			if err != nil {
				return err
			}
			w := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
			fmt.Fprintln(w, "request\tcreated\tby\twhat\tstatus\tmatch\tnote")
			for _, r := range list {
				what := r.SetPiece
				if r.Kind == "ticket" {
					what = "ticket " + r.TicketID
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", r.RequestID, r.CreatedAt, r.RequestedBy, what, r.Status, r.MatchID, r.Note)
			}
			return w.Flush()
		},
	}
	requestsCmd.Flags().StringVar(&config, "config", "", "the club config")
	return []*cobra.Command{upcomingCmd, schedulerCmd, requestCmd, requestsCmd}
}

func ticketOnBoard(feed *matchfeed.Feed, id string) (string, bool) {
	rows, err := feed.UpcomingRows()
	if err != nil {
		return "", false
	}
	for _, r := range rows {
		if r.TicketID == id {
			return r.Status, true
		}
	}
	return "", false
}
