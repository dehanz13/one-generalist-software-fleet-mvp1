package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/demo"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchday"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	setpieces "github.com/dehanz13/one-generalist-software-fleet-mvp1/set_pieces"
)

func demoCommand() *cobra.Command {
	var dir, export, start string
	var serve, verbose, real bool
	var port int
	cmd := &cobra.Command{
		Use:     "demo",
		Short:   "a scripted tour of every set piece and command (no tokens, nothing changed here)",
		GroupID: "setup",
		Long: "Build a small sample repository in a temporary folder and run every set piece in it for real,\n" +
			"with players on the scripted club: no model is called and no token is spent. The tour covers wins,\n" +
			"extra time, a rejected review, a restricted-area rollback, a provider stop, a noop ruling and a\n" +
			"re-verification, then shows the watch commands on the result. Matches play on a virtual clock, so\n" +
			"three hours of work take seconds.\n\n" +
			"  --serve    watch the result in Matchday Live afterwards\n" +
			"  --export   write the replay dataset Matchday Live's demo uses\n" +
			"  --real     instead: legacy's two cheap READ-ONLY real matches in this repo (needs pi and a key)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if real {
				return realDemo()
			}
			fmt.Println("ogsf demo: every set piece, scripted players, a throwaway repository")
			fmt.Printf("\n  %-17s %-9s %-9s %s\n", "command", "match", "result", "what it shows")
			var startAt time.Time
			if start != "" {
				var err error
				if startAt, err = time.Parse(time.RFC3339, start); err != nil {
					return fmt.Errorf("--start: %w", err)
				}
			}
			result, err := demo.Tour(demo.Options{Dir: dir, Out: os.Stdout, Verbose: verbose, Start: startAt})
			if err != nil {
				return err
			}
			db, err := matchfeed.OpenDB(result.DBPath)
			if err != nil {
				return err
			}
			mythic := result.Outcomes[15].MatchID
			fmt.Printf("\n$ ogsf matches\n")
			_ = table(db, []string{"match_id", "status", "setpiece_name", "ask"},
				`SELECT match_id, status, setpiece_name, substr(replace(ask, char(10), ' '), 1, 50) AS ask
				 FROM matches ORDER BY started_at DESC LIMIT 10`)
			fmt.Printf("\n$ ogsf passages %s\n", mythic)
			_ = table(db, []string{"seq", "name", "kind", "owner", "status", "attempt"},
				"SELECT seq, name, kind, owner, status, attempt FROM objectives WHERE match_id = ? ORDER BY seq", mythic)
			fmt.Printf("\n$ ogsf live-feed %s   (latest 8 of the feed)\n", mythic)
			_ = table(db, []string{"cursor", "type", "name", "started_at"},
				"SELECT rowid AS cursor, type, name, started_at FROM events WHERE match_id = ? ORDER BY rowid DESC LIMIT 8", mythic)
			fmt.Printf("\n$ ogsf on-pitch %s   (empty: the match is over, nothing of it is alive)\n", mythic)
			_ = table(db, []string{"kind", "name", "pid", "command", "started_at"},
				"SELECT kind, name, pid, command, started_at FROM processes WHERE match_id = ? AND ended_at IS NULL", mythic)
			fmt.Printf("\n$ ogsf upcoming\n")
			_ = table(db, []string{"ticket", "due", "set_piece", "mode", "status", "match", "title"},
				`SELECT ticket_id AS ticket, replace(substr(due_at, 1, 16), 'T', ' ') AS due, set_piece, mode, status,
				 COALESCE(match_id, '') AS match, title FROM upcoming_matches ORDER BY due_at, ticket_id`)
			fmt.Printf("\n$ ogsf requests\n")
			_ = table(db, []string{"request", "by", "what", "status", "match"},
				`SELECT request_id AS request, requested_by AS by,
				 CASE kind WHEN 'ticket' THEN 'ticket ' || ticket_id ELSE set_piece END AS what,
				 status, COALESCE(match_id, '') AS match FROM requests ORDER BY created_at DESC`)
			db.Close()

			fmt.Printf("\nsample repository: %s\nmatch log:         %s\n", result.Repo, result.DBPath)
			if export != "" {
				data, err := demo.Export(result.DBPath, export, "A tour of every set piece")
				if err != nil {
					return err
				}
				fmt.Printf("exported %d matches to %s\n", len(data.Matches), export)
			}
			if !serve {
				fmt.Printf("\nwatch it:  ogsf var --config %s\n", result.Config)
				return nil
			}
			server, err := matchday.NewServer(result.DBPath, nil)
			if err != nil {
				return err
			}
			defer server.Close()
			server.IsSetPiece = setpieces.IsSetPiece
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			addr := fmt.Sprintf("127.0.0.1:%d", port)
			fmt.Printf("\nMatchday Live  http://%s   (Ctrl-C to stop)\n", addr)
			go func() { time.Sleep(400 * time.Millisecond); openBrowser("http://" + addr) }()
			return server.ListenAndServe(ctx, addr)
		},
	}
	cmd.Flags().StringVar(&dir, "dir", "", "build the sample repository here (default: a new temporary folder)")
	cmd.Flags().StringVar(&export, "export", "", "write the replay dataset (JSON) here")
	cmd.Flags().BoolVar(&serve, "serve", false, "serve Matchday Live on the result when the tour ends")
	cmd.Flags().IntVar(&port, "port", 4600, "the port for --serve")
	cmd.Flags().BoolVar(&verbose, "verbose", false, "print every match's console too")
	cmd.Flags().BoolVar(&real, "real", false, "run legacy's two cheap read-only real matches in this repository instead")
	// A fixed start makes the exported dataset reproducible (make demo-data).
	cmd.Flags().StringVar(&start, "start", "", "start the virtual clock at this RFC 3339 time")
	_ = cmd.Flags().MarkHidden("start")
	return cmd
}

// realDemo is legacy's `just demo`: two cheap read-only runs, end to end,
// proving the whole path works with a real club. It costs a few cents and
// changes nothing in the repository.
func realDemo() error {
	deps := setpieces.DefaultDeps(configPath(""), ensure)
	fmt.Println("1/2  ask: one player, one prompt")
	ask, _ := setpieces.Get("ask")
	code, err := ask.Run(deps, setpieces.Args{Prompt: "reply with a one-line summary of this repo", Player: "ranger"})
	if err := finish(code, err); err != nil {
		return err
	}
	fmt.Println("\n2/2  scout-opposition: read-only recon")
	scout, _ := setpieces.Get("scout-opposition")
	code, err = scout.Run(deps, setpieces.Args{Prompt: kit.ResolvePrompt(
		"list the top-level directories in this repo and what each is for. change nothing.")})
	if err := finish(code, err); err != nil {
		return err
	}
	fmt.Println("\nboth done. now run:  ogsf matches    (or: ogsf var)")
	return nil
}
