// Command ogsf is One Generalist Software Fleet: every set piece, the
// inspection commands, Matchday Live and the installer in one binary.
// (Legacy: the justfile's recipes and the adws/*.py scripts.)
//
// The design is IndyDevDan's Super Simple Software Factory (MIT): plain code
// owns the order of work, and players are bounded steps inside it.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/spf13/cobra"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/abandoned"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kickoff"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/match"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/relay"
	setpieces "github.com/dehanz13/one-generalist-software-fleet-mvp1/set_pieces"
)

// version is set at build time with -ldflags "-X main.version=…".
var version = "dev"

// exitError carries an exit code out of a command.
type exitError struct{ code int }

func (e exitError) Error() string { return fmt.Sprintf("exit %d", e.code) }

func main() {
	// `.env` reaches every set piece, so keys work without exporting them;
	// a variable already set in the environment wins.
	_ = godotenv.Load()
	root := rootCommand()
	err := root.Execute()
	var exit exitError
	switch {
	case err == nil:
	case errors.As(err, &exit):
		os.Exit(exit.code)
	default:
		fmt.Fprintln(os.Stderr, "ogsf:", err)
		os.Exit(1)
	}
}

func configPath(flag string) string {
	if flag != "" {
		return flag
	}
	if env := os.Getenv("CLUB_CONFIG"); env != "" {
		return env
	}
	return boardroom.DefaultPath
}

func rootCommand() *cobra.Command {
	root := &cobra.Command{
		Use:   "ogsf",
		Short: "One Generalist Software Fleet: set pieces of players and plain code, recorded end to end",
		Long: "One Generalist Software Fleet (OGSF).\n\n" +
			"A written request goes in; players (models, through a club such as pi) plan and build it,\n" +
			"and plain code decides at every step whether it may continue. Every match is recorded in\n" +
			"set_pieces/clubhouse/match_log.db and can be watched live with `ogsf var`, or from anywhere\n" +
			"on Matchday Live.\n\n" +
			"Built on Super Simple Software Factory by IndyDevDan (MIT).",
		SilenceUsage:  true,
		SilenceErrors: true,
		Version:       version,
	}
	root.AddGroup(&cobra.Group{ID: "setpieces", Title: "Set pieces (each one is a match):"},
		&cobra.Group{ID: "watch", Title: "Watch and diagnose:"},
		&cobra.Group{ID: "plan", Title: "Plan and schedule:"},
		&cobra.Group{ID: "setup", Title: "Set up:"},
		&cobra.Group{ID: "spec", Title: "Spec tools:"})
	for _, piece := range setpieces.All() {
		root.AddCommand(setPieceCommand(piece))
	}
	root.AddCommand(watchCommands()...)
	root.AddCommand(setupCommands()...)
	root.AddCommand(specCommands()...)
	root.AddCommand(upcomingCommands()...)
	root.AddCommand(demoCommand())
	return root
}

// openMatches remembers the match a command opened, so it can be closed and
// its signal read once the set piece returns.
var openMatches []*match.Match

// ensure opens a match, with the relay to Matchday Live when one is set up.
// currentTicket is the Upcoming Matches ticket the next match plays, set by
// the Scheduler and `ogsf upcoming run` around a launch.
var currentTicket string

func ensure(cfg *boardroom.Config, matchID, setPiece string) (match.Runner, error) {
	client := relay.FromEnv()
	m, err := match.Ensure(cfg, matchID, match.Options{SetPiece: setPiece, Outbox: client != nil, TicketID: currentTicket})
	if err != nil {
		return nil, err
	}
	openMatches = append(openMatches, m)
	if client != nil {
		ctx, cancel := context.WithCancel(context.Background())
		every := time.Duration(cfg.Var.FlushMS) * time.Millisecond
		if every <= 0 {
			every = time.Second
		}
		go client.Run(ctx, m.Feed.DB, every, func(err error) {
			fmt.Fprintln(os.Stderr, "relay: "+err.Error()+" (rows stay queued; `ogsf relay push` sends them later)")
		})
		m.OnClose(func() {
			cancel()
			last, stop := context.WithTimeout(context.Background(), 5*time.Second)
			defer stop()
			if _, err := client.Drain(last, m.Feed.DB); err != nil {
				fmt.Fprintln(os.Stderr, "relay: "+err.Error()+" — `ogsf relay push` sends the rest")
			}
		})
	}
	return m, nil
}

// closeOpen closes every match the last launch opened and returns the
// signal that stopped one, if any.
func closeOpen() os.Signal {
	var signaled os.Signal
	for _, m := range openMatches {
		if s := m.Signaled(); s != nil {
			signaled = s
		}
		m.Close()
	}
	openMatches = nil
	return signaled
}

// finish turns a set piece's outcome into the process's exit code.
func finish(code int, err error) error {
	if signaled := closeOpen(); signaled != nil {
		if s, ok := signaled.(syscall.Signal); ok {
			return exitError{128 + int(s)}
		}
		return exitError{130}
	}
	if err != nil {
		if abandoned.Is(err) {
			// The objective is already recorded as a turnover and the summary
			// printed. This adds what the summary cannot say: no review was red.
			fmt.Fprintln(os.Stderr, abandoned.Note(err))
			return exitError{abandoned.ExitCode}
		}
		fmt.Fprintln(os.Stderr, "ogsf:", err)
		return exitError{1}
	}
	if code != 0 {
		return exitError{code}
	}
	return nil
}

func setPieceCommand(piece setpieces.SetPiece) *cobra.Command {
	var config, matchID, player, base string
	var skipKickoff bool
	use := piece.Command + " \"<prompt or path/to/prompt.md>\""
	if piece.Command == "play" {
		use = "play <playbook> \"<prompt or path/to/prompt.md>\""
	}
	cmd := &cobra.Command{
		Use:     use,
		Short:   piece.Summary,
		Long:    piece.Summary + "\n\nObjectives: " + piece.Chain + "\n\nFile: set_pieces/" + piece.File,
		GroupID: "setpieces",
		RunE: func(cmd *cobra.Command, args []string) error {
			playbook := ""
			if piece.Command == "play" {
				if len(args) != 2 {
					return errors.New("usage: ogsf play <playbook> \"<prompt>\"")
				}
				playbook, args = args[0], args[1:]
			}
			if len(args) != 1 {
				return fmt.Errorf("usage: ogsf %s", use)
			}
			rawPrompt := args[0]
			deps := setpieces.DefaultDeps(configPath(config), ensure)
			code, err := setpieces.Launch(deps, piece, setpieces.Args{Prompt: kit.ResolvePrompt(rawPrompt), MatchID: matchID,
				Player: player, Base: base, Playbook: playbook}, rawPrompt, skipKickoff, os.Stdout)
			var refused *setpieces.KickoffRefused
			if errors.As(err, &refused) {
				return exitError{kickoff.ExitCode}
			}
			return finish(code, err)
		},
	}
	cmd.Flags().StringVar(&config, "config", "", "the club config (default $CLUB_CONFIG or "+boardroom.DefaultPath+")")
	cmd.Flags().StringVar(&matchID, "match-id", "", "join or pin a match id")
	if piece.Command == "ask" {
		cmd.Flags().StringVar(&player, "player", "builder", "the player who answers")
	}
	if piece.Command == "bard" {
		cmd.Flags().StringVar(&base, "base", "main", "the ref the change is measured against")
	}
	if piece.Kickoff {
		cmd.Flags().BoolVar(&skipKickoff, "skip-kickoff", false, "dispatch even when the kickoff checklist refuses")
	}
	if piece.Command == "run-mythic" {
		cmd.Flags().Lookup("match-id").Usage = "pin a new id, or strictly reverify an existing failed match"
	}
	return cmd
}

func joinArgs(args []string) string { return strings.Join(args, " ") }
