package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/highlights"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchday"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/relay"
	setpieces "github.com/dehanz13/one-generalist-software-fleet-mvp1/set_pieces"
)

// logPaths finds the match log and the data dir from the config, falling
// back to the defaults when there is no config yet.
func logPaths(config string) (dbPath, dataDir string) {
	cfg, err := boardroom.Load(configPath(config))
	if err != nil {
		cfg = boardroom.Default()
	}
	return match.MatchLogPath(cfg), cfg.Defaults.DataDir
}

func openLog(config string) (*sql.DB, string, error) {
	dbPath, dataDir := logPaths(config)
	if _, err := os.Stat(dbPath); err != nil {
		return nil, "", fmt.Errorf("no match log at %s yet — run a set piece first (ogsf demo shows them all)", dbPath)
	}
	db, err := matchfeed.OpenDB(dbPath)
	return db, dataDir, err
}

func table(db *sql.DB, headers []string, query string, args ...any) error {
	rows, err := db.Query(query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	all, err := matchfeed.ScanRows(rows)
	if err != nil {
		return err
	}
	w := tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
	fmt.Fprintln(w, strings.Join(headers, "\t"))
	for _, row := range all {
		var cells []string
		for _, h := range headers {
			v := row[h]
			if v == nil {
				cells = append(cells, "")
				continue
			}
			cells = append(cells, fmt.Sprint(v))
		}
		fmt.Fprintln(w, strings.Join(cells, "\t"))
	}
	return w.Flush()
}

func watchCommands() []*cobra.Command {
	var config string
	withConfig := func(c *cobra.Command) *cobra.Command {
		c.Flags().StringVar(&config, "config", "", "the club config (default $CLUB_CONFIG or "+boardroom.DefaultPath+")")
		c.GroupID = "watch"
		return c
	}
	matches := withConfig(&cobra.Command{
		Use: "matches", Short: "the last 10 matches",
		RunE: func(cmd *cobra.Command, args []string) error {
			db, _, err := openLog(config)
			if err != nil {
				return err
			}
			defer db.Close()
			return table(db, []string{"match_id", "status", "setpiece_name", "ask", "total_tokens", "total_cost"},
				`SELECT match_id, status, setpiece_name, substr(replace(ask, char(10), ' '), 1, 50) AS ask,
				 total_tokens, round(total_cost, 4) AS total_cost FROM matches ORDER BY started_at DESC LIMIT 10`)
		},
	})
	passages := withConfig(&cobra.Command{
		Use: "passages <match_id>", Short: "a match's objectives, in order", Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			db, _, err := openLog(config)
			if err != nil {
				return err
			}
			defer db.Close()
			return table(db, []string{"seq", "name", "kind", "owner", "status", "attempt"},
				"SELECT seq, name, kind, owner, status, attempt FROM objectives WHERE match_id = ? ORDER BY seq", args[0])
		},
	})
	liveFeed := withConfig(&cobra.Command{
		Use: "live-feed <match_id>", Short: "the latest 25 events of a match", Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			db, _, err := openLog(config)
			if err != nil {
				return err
			}
			defer db.Close()
			return table(db, []string{"cursor", "type", "name", "started_at"},
				"SELECT rowid AS cursor, type, name, started_at FROM events WHERE match_id = ? ORDER BY rowid DESC LIMIT 25", args[0])
		},
	})
	onPitch := withConfig(&cobra.Command{
		Use: "on-pitch <match_id>", Short: "what a match has alive right now, with pids", Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			db, _, err := openLog(config)
			if err != nil {
				return err
			}
			defer db.Close()
			return table(db, []string{"kind", "name", "pid", "command", "started_at"},
				"SELECT kind, name, pid, command, started_at FROM processes WHERE match_id = ? AND ended_at IS NULL ORDER BY rowid", args[0])
		},
	})
	highlightsCmd := withConfig(&cobra.Command{
		Use:   "highlights-match <match_id>",
		Short: "bundle a match's rows, events, qa logs and reports into one text file",
		Long: "Bundle every record of a match into ONE text file a founder (or a diagnostic player) can read\n" +
			"end to end: the match row, every objective, every event, every qa command.log in full and every\n" +
			"match report. Enough to answer \"why did this match cost $9.92 and fail?\" without copying logs by hand.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			db, dataDir, err := openLog(config)
			if err != nil {
				return err
			}
			defer db.Close()
			out, lines, err := highlights.Bundle(db, dataDir, args[0])
			if err != nil {
				return err
			}
			fmt.Printf("\nMatch bundled to: %s\n%d lines\n", out, lines)
			return nil
		},
	})
	var matchID string
	postMatch := withConfig(&cobra.Command{
		Use:   "post-match <match_id>",
		Short: "send the ranger to read a match's highlights and recommend changes",
		Long: "Dispatch a ranger to read a bundled match (run highlights-match first) and write a post-mortem\n" +
			"into the new match's torch pass: what the match tried, where the money and time went, which\n" +
			"prompts or calls were wasteful, what the fleet should have done, and the top five fixes.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			path := highlights.Path(args[0])
			if _, err := os.Stat(path); err != nil {
				return fmt.Errorf("no bundle at %s. Run: ogsf highlights-match %s", path, args[0])
			}
			prompt := highlights.PostMortemPrompt(path)
			piece, _ := setpieces.Get("scout-opposition")
			code, err := piece.Run(setpieces.DefaultDeps(configPath(config), ensure), setpieces.Args{Prompt: prompt, MatchID: matchID})
			return finish(code, err)
		},
	})
	postMatch.Flags().StringVar(&matchID, "match-id", "", "pin the post-mortem's own match id")

	var port int
	var origins []string
	var noOpen bool
	varCmd := withConfig(&cobra.Command{
		Use:   "var",
		Short: "Matchday Live on http://127.0.0.1:4600, live from this Mac's match log",
		Long: "Serve Matchday Live from this Mac: the page is built into the binary and reads the local match\n" +
			"log, with every change pushed as it happens. It listens on 127.0.0.1 only. To let the deployed page\n" +
			"use this Mac as a \"Local fleet\" source, allow its origin with --allow-origin (CLUB_RELAY_URL's origin\n" +
			"is allowed already).",
		RunE: func(cmd *cobra.Command, args []string) error {
			dbPath, _ := logPaths(config)
			if c := relay.FromEnv(); c != nil {
				if u, err := url.Parse(c.URL); err == nil {
					origins = append(origins, u.Scheme+"://"+u.Host)
				}
			}
			server, err := matchday.NewServer(dbPath, origins)
			if err != nil {
				return err
			}
			defer server.Close()
			server.IsSetPiece = setpieces.IsSetPiece
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			addr := fmt.Sprintf("127.0.0.1:%d", port)
			page := "http://" + addr
			fmt.Printf("Matchday Live  %s\nmatch log      %s\nCtrl-C to stop.\n", page, dbPath)
			if !noOpen {
				go func() { time.Sleep(400 * time.Millisecond); openBrowser(page) }()
			}
			return server.ListenAndServe(ctx, addr)
		},
	})
	varCmd.Flags().IntVar(&port, "port", 4600, "the port on 127.0.0.1")
	varCmd.Flags().StringSliceVar(&origins, "allow-origin", nil, "an origin that may read this server (your Matchday Live URL)")
	varCmd.Flags().BoolVar(&noOpen, "no-open", false, "do not open a browser")

	relayCmd := &cobra.Command{Use: "relay", Short: "send this Mac's matches to Matchday Live on Vercel", GroupID: "watch"}
	relayCmd.Flags().StringVar(&config, "config", "", "the club config")
	relayStatus := &cobra.Command{
		Use: "status", Short: "is a relay set up, and how many rows wait",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := relay.FromEnv()
			if client == nil {
				fmt.Println("relay: not set up. Set CLUB_RELAY_URL and CLUB_RELAY_TOKEN in .env (mint a fleet token on Matchday Live → Connections).")
				return nil
			}
			fmt.Printf("relay: %s as %q\n", client.URL, client.Machine)
			db, _, err := openLog(config)
			if err != nil {
				return err
			}
			defer db.Close()
			n, err := relay.Pending(db)
			fmt.Printf("queued rows: %d\n", n)
			return err
		},
	}
	var all bool
	relayPush := &cobra.Command{
		Use: "push", Short: "send every queued row now (--all queues the whole log first)",
		RunE: func(cmd *cobra.Command, args []string) error {
			client := relay.FromEnv()
			if client == nil {
				return errors.New("relay not set up: set CLUB_RELAY_URL and CLUB_RELAY_TOKEN")
			}
			db, _, err := openLog(config)
			if err != nil {
				return err
			}
			defer db.Close()
			if all {
				n, err := relay.Backfill(db)
				if err != nil {
					return err
				}
				fmt.Printf("queued %d rows\n", n)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()
			sent, err := client.Drain(ctx, db)
			fmt.Printf("sent %d rows to %s\n", sent, client.URL)
			return err
		},
	}
	relayPush.Flags().BoolVar(&all, "all", false, "queue every match in the log first (a backfill)")
	relayCmd.AddCommand(relayStatus, relayPush)

	return []*cobra.Command{matches, passages, liveFeed, onPitch, highlightsCmd, postMatch, varCmd, relayCmd}
}

func openBrowser(page string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", page)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", page)
	default:
		cmd = exec.Command("xdg-open", page)
	}
	_ = cmd.Start()
}
