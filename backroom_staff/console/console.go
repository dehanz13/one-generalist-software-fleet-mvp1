// Package console is the console reporter: one narrative, two destinations.
// (Legacy: adw_modules/console.py.)
//
// Every line a set piece prints ALSO lands in the match feed as a `log`
// event, so Matchday Live reads the same story the terminal does. Both go
// through emit, so the print and the record cannot drift. Plain sequential
// lines only: no spinners, no live displays, so a CI log reads exactly like a
// terminal.
package console

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

// MaxLine is where dynamic text (summaries, violations, errors) is clipped.
const MaxLine = 160

// Feed is the one thing the console needs from the match feed.
type Feed interface {
	Event(rec matchfeed.EventRecord) string
}

// Console is bound to one match's feed.
type Console struct {
	feed          Feed
	matchID       string
	objectiveID   string // the current lane: log events attach to it
	objectiveName string
	results       []string // objective statuses, for the summary
	finished      bool     // the summary panel prints once
	out           io.Writer
	color         bool
}

// New binds a console to a match. Output goes to stdout, in colour when
// stdout is a terminal and NO_COLOR is unset.
func New(feed Feed, matchID string) *Console {
	return &Console{feed: feed, matchID: matchID, out: os.Stdout, color: colorWanted(os.Stdout)}
}

// SetOutput redirects the printed half (tests, the demo).
func (c *Console) SetOutput(w io.Writer, color bool) { c.out, c.color = w, color }

func colorWanted(f *os.File) bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// ── styling ─────────────────────────────────────────────────────────────────

var codes = map[string]string{
	"bold": "1", "dim": "2", "red": "31", "green": "32", "yellow": "33",
	"magenta": "35", "cyan": "36",
}

// style wraps text in ANSI codes when colour is on.
func (c *Console) style(text string, names ...string) string {
	if !c.color || len(names) == 0 {
		return text
	}
	var parts []string
	for _, n := range names {
		parts = append(parts, codes[n])
	}
	return "\x1b[" + strings.Join(parts, ";") + "m" + text + "\x1b[0m"
}

// KindColor is the colour of each objective kind's lane.
var KindColor = map[string]string{"head_coach": "cyan", "player": "magenta", "referee": "yellow"}

// Clip squeezes whitespace and clips to MaxLine characters.
func Clip(text string, limit int) string {
	text = strings.Join(strings.Fields(text), " ")
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit-1]) + "…"
}

// ── the one helper: print AND trace, always together ────────────────────────

// emit prints the styled line and records the plain one.
func (c *Console) emit(styled, plain, level string) {
	fmt.Fprintln(c.out, styled)
	name := c.objectiveName
	if name == "" {
		name = "console"
	}
	c.feed.Event(matchfeed.EventRecord{
		MatchID: c.matchID, ObjectiveID: c.objectiveID, Type: "log", Name: name,
		Payload: map[string]any{"message": plain, "level": level},
	})
}

// ── matches ─────────────────────────────────────────────────────────────────

// MatchStarted prints the match id and the founder.
func (c *Console) MatchStarted(matchID, founder string) {
	c.emit(c.style("match_id:", "bold", "cyan")+" "+c.style(matchID, "bold")+"   "+c.style("founder", "dim")+" "+founder,
		"match_id: "+matchID+"   founder "+founder, "info")
}

// MatchFinished prints the summary panel once. Its plain line, "match <id>
// touchdown · …", is what package resume reads back.
func (c *Console) MatchFinished(ok bool, tokens int, cost float64, dbPath string) {
	if c.finished {
		return
	}
	c.finished = true
	passed := 0
	for _, r := range c.results {
		if r == "touchdown" {
			passed++
		}
	}
	status, word, border := c.style("✗ turnover", "red"), "turnover", "red"
	if ok {
		status, word, border = c.style("✓ touchdown", "green"), "touchdown", "green"
	}
	rows := []string{
		" " + c.style("status", "dim") + "   " + status,
		fmt.Sprintf(" %s   %d/%d passed", c.style("objectives", "dim"), passed, len(c.results)),
		fmt.Sprintf(" %s   %s", c.style("tokens", "dim"), commas(tokens)),
		fmt.Sprintf(" %s     $%.4f", c.style("cost", "dim"), cost),
		" " + c.style("match_id", "dim") + "   " + c.matchID,
		" " + c.style("db", "dim") + "         " + dbPath,
		" " + c.style("next", "dim") + "       " + c.style("ogsf passages "+c.matchID, "bold"),
	}
	panel := box("Set piece complete", rows, func(s string) string { return c.style(s, border) })
	plain := fmt.Sprintf("match %s %s · %d/%d objectives · %s tokens · $%.4f",
		c.matchID, word, passed, len(c.results), commas(tokens), cost)
	level := "info"
	if !ok {
		level = "error"
	}
	c.emit(panel, plain, level)
}

// ── objectives ──────────────────────────────────────────────────────────────

// ObjectiveStarted moves the console into an objective's lane and prints its header.
func (c *Console) ObjectiveStarted(objectiveID string, seq int, name, kind, owner, description string) {
	c.objectiveID, c.objectiveName = objectiveID, name
	color := KindColor[kind]
	line := c.style(fmt.Sprintf("▶ %02d %s", seq, name), "bold", color) + "  " + c.style(kind, color) + " " + c.style("· "+owner, "dim")
	plain := fmt.Sprintf("▶ %02d %s  %s · %s", seq, name, kind, owner)
	if description != "" {
		line += "  " + c.style(Clip(description, MaxLine), "dim")
		plain += "  " + Clip(description, MaxLine)
	}
	c.emit(line, plain, "info")
}

// ObjectiveEnded prints the result line and leaves the lane.
func (c *Console) ObjectiveEnded(name, status, errText string, seconds float64) {
	ok := status == "touchdown"
	c.results = append(c.results, status)
	mark, plainMark, level := c.style("✓", "green"), "✓", "info"
	if !ok {
		mark, plainMark, level = c.style("✗", "red"), "✗", "error"
	}
	line := fmt.Sprintf("  %s %s %s", mark, name, c.style(fmt.Sprintf("%.1fs", seconds), "dim"))
	plain := fmt.Sprintf("  %s %s %.1fs", plainMark, name, seconds)
	if !ok && errText != "" {
		line += "  " + c.style(Clip(errText, MaxLine), "red")
		plain += "  " + Clip(errText, MaxLine)
	}
	c.emit(line, plain, level)
	c.objectiveID, c.objectiveName = "", ""
}

// Note is free-form detail inside the current objective: what Log recorded.
func (c *Console) Note(message string) {
	text := "  · " + Clip(message, MaxLine)
	c.emit(c.style(text, "dim"), text, "info")
}

// ── players ─────────────────────────────────────────────────────────────────

// PlayerStarted prints a player's club session starting.
func (c *Console) PlayerStarted(name, model, sessionID string) {
	c.emit("  "+c.style("▸", "magenta")+" "+name+" "+c.style(model, "dim")+"  "+c.style("session "+sessionID, "dim"),
		"  ▸ "+name+" "+model+"  session "+sessionID, "info")
}

// PlayerFinished prints what a player spent.
func (c *Console) PlayerFinished(name string, tokens int, cost float64) {
	text := fmt.Sprintf("  └ %s used %s tokens · $%.4f", name, commas(tokens), cost)
	c.emit(c.style(text, "dim"), text, "info")
}

// Retry prints a correction going back into the same club session.
func (c *Console) Retry(name string, attempt, limit int, reason string) {
	tail := fmt.Sprintf("— same session · %s", Clip(reason, MaxLine))
	c.emit(fmt.Sprintf("  %s %s retry %d/%d %s", c.style("⟳", "yellow"), name, attempt, limit, c.style(tail, "dim")),
		fmt.Sprintf("  ⟳ %s retry %d/%d %s", name, attempt, limit, tail), "warn")
}

// ── verification ────────────────────────────────────────────────────────────

// Check is one item an official review looked at.
type Check struct {
	Item string
	OK   bool
	Note string
}

// ReviewResult prints an official review: WHAT it checked, not only whether it passed.
func (c *Console) ReviewResult(name string, checks []Check) {
	failed := 0
	for _, ch := range checks {
		if !ch.OK {
			failed++
		}
	}
	ok := failed == 0
	mark, plainMark, level := c.style("✓", "green"), "✓", "info"
	summary := fmt.Sprintf("%d checked", len(checks))
	styledSummary := c.style(summary, "dim")
	if !ok {
		mark, plainMark, level = c.style("✗", "red"), "✗", "error"
		summary = fmt.Sprintf("%d of %d failed", failed, len(checks))
		styledSummary = c.style(summary, "red")
	}
	c.emit(fmt.Sprintf("  %s official review %s %s", mark, c.style(name, "dim"), styledSummary),
		fmt.Sprintf("  %s official review %s %s", plainMark, name, summary), level)
	for _, ch := range checks {
		detail := ""
		if ch.Note != "" {
			detail = " — " + Clip(ch.Note, MaxLine)
		}
		sign, style, lvl := "·", []string{"dim"}, "info"
		if !ch.OK {
			sign, style, lvl = "✗", []string{"dim", "red"}, "error"
		}
		text := fmt.Sprintf("    %s %s%s", sign, Clip(ch.Item, MaxLine), detail)
		c.emit(c.style(text, style...), text, lvl)
	}
}

// ReportSummary prints a parsed match report.
func (c *Console) ReportSummary(typeName, status, summary string, artifacts []string) {
	ok := status == "touchdown"
	mark, plainMark, level := c.style("✓", "green"), "✓", "info"
	if !ok {
		mark, plainMark, level = c.style("✗", "red"), "✗", "error"
	}
	c.emit(fmt.Sprintf("  %s %s %s", mark, typeName, c.style(Clip(summary, MaxLine), "dim")),
		fmt.Sprintf("  %s %s %s", plainMark, typeName, Clip(summary, MaxLine)), level)
	if len(artifacts) > 0 {
		text := "    artifacts: " + Clip(strings.Join(artifacts, ", "), MaxLine)
		c.emit(c.style(text, "dim"), text, "info")
	}
}

// ── helpers ─────────────────────────────────────────────────────────────────

func commas(n int) string {
	s := fmt.Sprintf("%d", n)
	negative := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	var out []string
	for len(s) > 3 {
		out = append([]string{s[len(s)-3:]}, out...)
		s = s[:len(s)-3]
	}
	out = append([]string{s}, out...)
	result := strings.Join(out, ",")
	if negative {
		return "-" + result
	}
	return result
}

// Commas formats an integer with thousands separators.
func Commas(n int) string { return commas(n) }

// box draws a rounded panel around rows, with a title in its top edge.
func box(title string, rows []string, border func(string) string) string {
	width := len([]rune(title)) + 4
	for _, r := range rows {
		if w := visibleLen(r) + 2; w > width {
			width = w
		}
	}
	titled := " " + title + " "
	pad := width - len([]rune(titled))
	left := pad / 2
	top := border("╭"+strings.Repeat("─", left)) + "\x1b[1m" + titled + "\x1b[0m" + border(strings.Repeat("─", pad-left)+"╮")
	if !strings.Contains(border("x"), "\x1b") {
		top = "╭" + strings.Repeat("─", left) + titled + strings.Repeat("─", pad-left) + "╮"
	}
	lines := []string{top}
	for _, r := range rows {
		lines = append(lines, border("│")+r+strings.Repeat(" ", width-visibleLen(r))+border("│"))
	}
	lines = append(lines, border("╰"+strings.Repeat("─", width)+"╯"))
	return strings.Join(lines, "\n")
}

// visibleLen counts characters, skipping ANSI escape sequences.
func visibleLen(s string) int {
	n, inEscape := 0, false
	for _, r := range s {
		switch {
		case r == '\x1b':
			inEscape = true
		case inEscape && r == 'm':
			inEscape = false
		case !inEscape:
			n++
		}
	}
	return n
}
