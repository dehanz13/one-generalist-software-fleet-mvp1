// Package upcoming reads planned work, Upcoming Matches, from its sources and
// keeps the upcoming_matches table in step with them. (New in version 2.)
//
// A ticket names the day it is to be worked, the set piece that works it and
// whether the Scheduler starts it by itself when it is due (auto) or a person
// does (manual). Markdown files are the source today; Linear is designed for
// and arrives later.
package upcoming

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

// Ticket is one planned piece of work.
type Ticket struct {
	ID        string
	Source    string // markdown | linear
	SourceRef string // the file, or the issue URL
	Sprint    string
	Title     string
	Date      string // YYYY-MM-DD
	Time      string // HH:MM, or "" for the default
	Timezone  string // IANA, or "" for the Mac's
	SetPiece  string
	Mode      string // auto | manual
	Prompt    string // the request; for a quest, the spec file's path
	Player    string // ask only
	Spec      string // a quest spec path, when the ticket names one
	DueAt     time.Time
}

// Problem is a ticket that could not be read, and why.
type Problem struct {
	Where string
	Err   error
}

func (p Problem) Error() string { return p.Where + ": " + p.Err.Error() }

// heading is a ticket's level-2 heading: "## KICK-7 · Title" (· - – — or : between).
var heading = regexp.MustCompile(`^##\s+([A-Za-z][A-Za-z0-9]*-\d+)\s*(?:·|-|–|—|:)\s*(.+?)\s*$`)

var field = regexp.MustCompile(`^([A-Za-z][A-Za-z _-]*):\s*(.*?)\s*$`)

// Defaults complete a ticket that left something out.
type Defaults struct {
	Time     string         // HH:MM
	Location *time.Location // the zone dates are read in when a ticket names none
}

// ParseMarkdown reads the tickets of one markdown file.
//
// The format: optional front matter (`sprint:`, `timezone:` between `---`
// lines); prose that is not under a ticket heading is ignored; each ticket is
// a level-2 heading `## KICK-7 · Title`, then `key: value` lines (`date`
// required; `time`, `set piece` required, `mode` auto or manual (default
// manual), `player`, `spec`), a blank line, and the prompt until the next
// level-2 heading.
func ParseMarkdown(path, text string, d Defaults) ([]Ticket, []Problem) {
	var tickets []Ticket
	var problems []Problem
	sprint, zone := "", ""
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	i := 0
	if len(lines) > 0 && strings.TrimSpace(lines[0]) == "---" {
		for i = 1; i < len(lines) && strings.TrimSpace(lines[i]) != "---"; i++ {
			if m := field.FindStringSubmatch(lines[i]); m != nil {
				switch key(m[1]) {
				case "sprint":
					sprint = m[2]
				case "timezone":
					zone = m[2]
				}
			}
		}
		i++
	}
	var current *Ticket
	var body []string
	inFields := false
	flush := func() {
		if current == nil {
			return
		}
		current.Prompt = strings.TrimSpace(strings.Join(body, "\n"))
		if current.Spec != "" {
			current.Prompt = current.Spec
		}
		if err := complete(current, d); err != nil {
			problems = append(problems, Problem{Where: fmt.Sprintf("%s: %s", path, current.ID), Err: err})
		} else {
			tickets = append(tickets, *current)
		}
		current, body = nil, nil
	}
	for ; i < len(lines); i++ {
		line := lines[i]
		if m := heading.FindStringSubmatch(line); m != nil {
			flush()
			current = &Ticket{ID: m[1], Title: m[2], Source: "markdown", SourceRef: path, Sprint: sprint, Timezone: zone, Mode: "manual"}
			inFields = true
			continue
		}
		if strings.HasPrefix(line, "## ") || strings.HasPrefix(line, "# ") {
			flush()
			continue
		}
		if current == nil {
			continue
		}
		if inFields {
			if strings.TrimSpace(line) == "" {
				inFields = false
				continue
			}
			if m := field.FindStringSubmatch(line); m != nil {
				if err := set(current, key(m[1]), m[2]); err != nil {
					problems = append(problems, Problem{Where: fmt.Sprintf("%s: %s", path, current.ID), Err: err})
				}
				continue
			}
			inFields = false
		}
		body = append(body, line)
	}
	flush()
	return tickets, problems
}

func key(k string) string {
	return strings.ReplaceAll(strings.ReplaceAll(strings.ToLower(strings.TrimSpace(k)), " ", "_"), "-", "_")
}

func set(t *Ticket, k, v string) error {
	switch k {
	case "date":
		t.Date = v
	case "time":
		t.Time = v
	case "set_piece", "setpiece":
		t.SetPiece = v
	case "mode":
		t.Mode = strings.ToLower(v)
	case "player":
		t.Player = v
	case "spec":
		t.Spec = v
	case "timezone":
		t.Timezone = v
	default:
		return fmt.Errorf("unknown field %q (date, time, set piece, mode, player, spec, timezone)", k)
	}
	return nil
}

// complete checks a ticket and works out when it is due.
func complete(t *Ticket, d Defaults) error {
	if _, err := time.Parse("2006-01-02", t.Date); err != nil {
		return fmt.Errorf("date %q is not YYYY-MM-DD", t.Date)
	}
	if t.Time != "" && !boardroom.ValidClock(t.Time) {
		return fmt.Errorf("time %q is not HH:MM", t.Time)
	}
	if t.SetPiece == "" {
		return fmt.Errorf("no set piece: add a `set piece:` line")
	}
	if t.Mode != "auto" && t.Mode != "manual" {
		return fmt.Errorf("mode %q is not auto or manual", t.Mode)
	}
	if t.Prompt == "" {
		return fmt.Errorf("no prompt: write the request under the ticket's fields, or name a `spec:`")
	}
	loc := d.Location
	if t.Timezone != "" {
		l, err := time.LoadLocation(t.Timezone)
		if err != nil {
			return fmt.Errorf("timezone: %v", err)
		}
		loc = l
	}
	if loc == nil {
		loc = time.Local
	}
	clock := t.Time
	if clock == "" {
		clock = d.Time
	}
	if clock == "" {
		clock = "09:00"
	}
	due, err := time.ParseInLocation("2006-01-02 15:04", t.Date+" "+clock, loc)
	if err != nil {
		return err
	}
	t.DueAt = due
	return nil
}

// Load reads every source in the config. Problems name each ticket that was
// skipped; duplicates across files are problems too.
func Load(cfg *boardroom.Config, isSetPiece func(string) bool) ([]Ticket, []Problem) {
	d := Defaults{Time: cfg.Upcoming.DefaultTime}
	if cfg.Upcoming.Timezone != "" {
		if loc, err := time.LoadLocation(cfg.Upcoming.Timezone); err == nil {
			d.Location = loc
		}
	}
	var all []Ticket
	var problems []Problem
	for _, src := range cfg.Upcoming.Sources {
		switch src.Kind {
		case "markdown":
			files, err := filepath.Glob(src.Path)
			if err != nil {
				problems = append(problems, Problem{Where: src.Path, Err: err})
				continue
			}
			sort.Strings(files)
			for _, f := range files {
				if strings.EqualFold(filepath.Base(f), "README.md") {
					continue
				}
				data, err := os.ReadFile(f)
				if err != nil {
					problems = append(problems, Problem{Where: f, Err: err})
					continue
				}
				tickets, ps := ParseMarkdown(f, string(data), d)
				all = append(all, tickets...)
				problems = append(problems, ps...)
			}
		case "linear":
			problems = append(problems, Problem{Where: "linear", Err: fmt.Errorf("the Linear source arrives later; use markdown for now")})
		}
	}
	seen := map[string]string{}
	var kept []Ticket
	for _, t := range all {
		if where, dup := seen[t.ID]; dup {
			problems = append(problems, Problem{Where: t.SourceRef + ": " + t.ID, Err: fmt.Errorf("also defined in %s", where)})
			continue
		}
		if isSetPiece != nil && !isSetPiece(t.SetPiece) {
			problems = append(problems, Problem{Where: t.SourceRef + ": " + t.ID, Err: fmt.Errorf("no set piece %q", t.SetPiece)})
			continue
		}
		seen[t.ID] = t.SourceRef
		kept = append(kept, t)
	}
	sort.Slice(kept, func(i, j int) bool {
		if !kept[i].DueAt.Equal(kept[j].DueAt) {
			return kept[i].DueAt.Before(kept[j].DueAt)
		}
		return kept[i].ID < kept[j].ID
	})
	return kept, problems
}

// SpecPath is the spec file a ticket's prompt names, or "". A ticket with a
// `spec:` field stores the path as its prompt: one line, no spaces, ending
// in .md. (The row has no spec column; the prompt carries it.)
func SpecPath(prompt string) string {
	p := strings.TrimSpace(prompt)
	if p == "" || strings.ContainsAny(p, " \t\n") || !strings.HasSuffix(strings.ToLower(p), ".md") {
		return ""
	}
	return p
}

// Readiness is a ticket's status before it has run: `scheduled` until its
// time, `due` from then on. It is also where a policy on OVERDUE tickets
// belongs, and there is none yet: an auto ticket that came due while its Mac
// was off starts the moment the Scheduler does, however late. To skip a stale
// ticket instead, return "skipped" with the reason as the note; a skipped
// ticket stays skipped (Final) and `ogsf upcoming run <id>` can still play it.
func Readiness(t Ticket, now time.Time) (status, note string) {
	if now.Before(t.DueAt) {
		return "scheduled", ""
	}
	return "due", ""
}

// Final reports whether a status is settled: a ticket in one is never
// started again by the Scheduler.
func Final(status string) bool {
	switch status {
	case "touchdown", "turnover", "skipped", "running", "queued":
		return true
	}
	return false
}

// Sync writes the sources into upcoming_matches. A ticket keeps its status
// once it has been queued, run or skipped; otherwise it is `due` once its time
// has passed and `scheduled` before. A ticket that left its source and never
// ran is marked skipped (rows are never deleted: a relayed row could not be).
func Sync(feed *matchfeed.Feed, tickets []Ticket, machine string, now time.Time) error {
	existing, err := feed.UpcomingRows()
	if err != nil {
		return err
	}
	byID := map[string]matchfeed.UpcomingRow{}
	for _, r := range existing {
		byID[r.TicketID] = r
	}
	inSource := map[string]bool{}
	for _, t := range tickets {
		inSource[t.ID] = true
		row := matchfeed.UpcomingRow{TicketID: t.ID, Source: t.Source, SourceRef: t.SourceRef, Sprint: t.Sprint,
			Title: t.Title, Date: t.Date, Time: t.Time, Timezone: t.Timezone, DueAt: logTime(t.DueAt),
			SetPiece: t.SetPiece, Mode: t.Mode, Prompt: t.Prompt, Player: t.Player, Machine: machine}
		old, had := byID[t.ID]
		if had && Final(old.Status) {
			row.Status, row.MatchID, row.Note, row.Machine = old.Status, old.MatchID, old.Note, old.Machine
		} else {
			row.Status, row.Note = Readiness(t, now)
		}
		if had && same(old, row) {
			continue
		}
		if err := feed.UpcomingUpsert(row); err != nil {
			return err
		}
	}
	for _, old := range existing {
		if !inSource[old.TicketID] && !Final(old.Status) {
			old.Status, old.Note = "skipped", "removed from its source before it ran"
			if err := feed.UpcomingUpsert(old); err != nil {
				return err
			}
		}
	}
	return nil
}

func same(a, b matchfeed.UpcomingRow) bool {
	return a.Source == b.Source && a.SourceRef == b.SourceRef && a.Sprint == b.Sprint && a.Title == b.Title &&
		a.Date == b.Date && a.Time == b.Time && a.Timezone == b.Timezone && a.DueAt == b.DueAt &&
		a.SetPiece == b.SetPiece && a.Mode == b.Mode && a.Prompt == b.Prompt && a.Player == b.Player &&
		a.Status == b.Status && a.MatchID == b.MatchID && a.Machine == b.Machine && a.Note == b.Note
}

func logTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000-07:00")
}

// Now is the clock the scheduler and sync use.
func Now() time.Time { return kit.Now() }
