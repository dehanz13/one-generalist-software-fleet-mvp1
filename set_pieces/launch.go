package setpieces

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kickoff"
)

// KickoffRefused is a dispatch the kickoff checklist refused: nothing ran.
type KickoffRefused struct {
	Failed []kickoff.Check
}

func (e *KickoffRefused) Error() string {
	var names []string
	for _, c := range e.Failed {
		names = append(names, c.Name+": "+c.Detail)
	}
	return "the kickoff checklist refused the dispatch: " + strings.Join(names, "; ")
}

// Names lists every set piece's command.
func Names() []string {
	var out []string
	for _, p := range All() {
		out = append(out, p.Command)
	}
	return out
}

// IsSetPiece reports whether a command names a set piece.
func IsSetPiece(name string) bool {
	_, ok := Get(name)
	return ok
}

// Launch runs a set piece the way the command line does: its kickoff
// checklist first when it has one (unless skipped), printed to out, then the
// set piece. rawPrompt is the prompt as given (a spec path stays a path, so
// the checklist can read it); a.Prompt is the resolved text. A refusal is a
// *KickoffRefused and exit code 2, with nothing run.
func Launch(d *Deps, piece SetPiece, a Args, rawPrompt string, skipKickoff bool, out io.Writer) (int, error) {
	if piece.Kickoff && !skipKickoff {
		resuming := false
		if a.MatchID != "" {
			if cfg, err := d.LoadConfig(); err == nil {
				_, statErr := os.Stat(filepath.Join(cfg.Defaults.DataDir, "matches", a.MatchID, "match_feed.jsonl"))
				resuming = statErr == nil
			}
		}
		checks := kickoff.Run(rawPrompt, resuming, piece.Command)
		var failed []kickoff.Check
		for _, c := range checks {
			mark := "✓"
			if !c.Passed {
				mark = "✗"
				failed = append(failed, c)
			}
			if out != nil {
				fmt.Fprintf(out, "  %s kickoff checklist · %s: %s\n", mark, c.Name, c.Detail)
			}
		}
		if len(failed) > 0 {
			if out != nil {
				fmt.Fprintf(out, "\nthe kickoff checklist refused the dispatch (%d check(s)). Nothing ran, no tokens spent. "+
					"Pass --skip-kickoff only if you know why each check is wrong.\n", len(failed))
			}
			return kickoff.ExitCode, &KickoffRefused{Failed: failed}
		}
	}
	return piece.Run(d, a)
}
