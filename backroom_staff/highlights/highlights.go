// Package highlights bundles one match's whole record into one text file a
// founder (or a diagnostic player) can read end to end, and writes the brief
// the post-match ranger reads it with. (Legacy: the justfile's bundle-session
// and review-session recipes; the picked names are highlights-match and
// post-match.)
package highlights

import (
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/tabwriter"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

// Path is where a match's bundle is written.
func Path(matchID string) string {
	return filepath.Join(os.TempDir(), "ogsf-match-"+matchID+".txt")
}

// Bundle writes the match row, every objective, every event, every qa
// command.log in full and every match report: enough to answer "why did this
// match cost $9.92 and fail?" without copying logs by hand. It returns the
// file's path and its line count.
func Bundle(db *sql.DB, dataDir, matchID string) (string, int, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "# OGSF match bundle for match_id=%s\n# Generated %s\n\n", matchID, kit.NowISO())
	section := func(title, query string, headers []string) error {
		fmt.Fprintf(&b, "## %s\n", title)
		rows, err := db.Query(query, matchID)
		if err != nil {
			return err
		}
		all, err := matchfeed.ScanRows(rows)
		rows.Close()
		if err != nil {
			return err
		}
		w := tabwriter.NewWriter(&b, 0, 2, 2, ' ', 0)
		fmt.Fprintln(w, strings.Join(headers, "\t"))
		for _, row := range all {
			var cells []string
			for _, h := range headers {
				v := row[h]
				if v == nil {
					v = ""
				}
				cells = append(cells, strings.ReplaceAll(fmt.Sprint(v), "\n", " "))
			}
			fmt.Fprintln(w, strings.Join(cells, "\t"))
		}
		w.Flush()
		b.WriteString("\n")
		return nil
	}
	if err := section("Match row", "SELECT * FROM matches WHERE match_id = ?",
		[]string{"match_id", "setpiece_name", "status", "founder", "machine", "started_at", "ended_at", "total_tokens", "total_cost", "ask"}); err != nil {
		return "", 0, err
	}
	if err := section("Objectives", "SELECT * FROM objectives WHERE match_id = ? ORDER BY seq",
		[]string{"seq", "name", "kind", "owner", "status", "attempt", "retries", "started_at", "ended_at", "error"}); err != nil {
		return "", 0, err
	}
	if err := section("Events", "SELECT rowid AS cursor, type, name, tokens, started_at, substr(payload_json, 1, 500) AS payload_preview FROM events WHERE match_id = ? ORDER BY rowid",
		[]string{"cursor", "type", "name", "tokens", "started_at", "payload_preview"}); err != nil {
		return "", 0, err
	}
	dir := filepath.Join(dataDir, "matches", matchID)
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		var files, logs, reportFiles []string
		_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err == nil && !d.IsDir() {
				files = append(files, path)
				switch d.Name() {
				case "command.log":
					logs = append(logs, path)
				case "match_report.json":
					reportFiles = append(reportFiles, path)
				}
			}
			return nil
		})
		sort.Strings(files)
		b.WriteString("## Match directory listing\n" + strings.Join(files, "\n") + "\n\n")
		b.WriteString("## Every qa command.log, in full\n")
		for _, f := range logs {
			data, _ := os.ReadFile(f)
			fmt.Fprintf(&b, "\n### %s\n```\n%s```\n", f, data)
		}
		b.WriteString("\n## Every match report, in full\n")
		for _, f := range reportFiles {
			data, _ := os.ReadFile(f)
			fmt.Fprintf(&b, "\n### %s\n```json\n%s\n```\n", f, data)
		}
	}
	out := Path(matchID)
	if err := os.WriteFile(out, []byte(b.String()), 0o644); err != nil {
		return "", 0, err
	}
	return out, strings.Count(b.String(), "\n"), nil
}

// PostMortemPrompt is the ranger's brief for reading a bundle. The ranger is
// read-only in the repo (legacy asked its scout to write under docs/, which
// the scout's own `writes: []` would have rolled back), so the post-mortem
// goes into the new match's torch pass.
func PostMortemPrompt(bundlePath string) string {
	return fmt.Sprintf("Read the OGSF match bundle at %s. Write a post-mortem to <torch_pass_dir>/post_mortem.md "+
		"(your torch pass; you are read-only in the repo) that answers: (1) what the match was trying to do; "+
		"(2) where the players spent their money and time (by objective); (3) which specific prompts or tool "+
		"calls were wasteful or wrong; (4) what the fleet should have done differently to be cheaper or converge "+
		"faster; (5) concrete adjustments to set_pieces/clubhouse/team_talks/*/system.md, quest specs, or the qa "+
		"checks in club.config.yaml to prevent recurrence. Report the top 5 recommendations ranked by cost impact.", bundlePath)
}
