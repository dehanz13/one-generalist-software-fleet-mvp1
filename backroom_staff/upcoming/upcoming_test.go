package upcoming

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

const sprint = `---
sprint: Sprint 14
timezone: Europe/London
---

# Sprint 14 · 12–23 Oct

Prose before the first ticket is ignored.

## KICK-1 · Add a dark mode toggle
date: 2026-10-12
time: 10:30
set piece: run-heroic
mode: auto

Add a toggle to the header that switches the theme
and remembers the choice.

## KICK-2 – Answer a question
date: 2026-10-13
set piece: ask
player: ranger

Where is the session cookie set?

## KICK-3: Build from a spec
date: 2026-10-14
set piece: run-mythic
spec: specs/kick-3.md
mode: manual

This prose is replaced by the spec path.
`

func TestParseMarkdownReadsTicketsFieldsAndPrompts(t *testing.T) {
	tickets, problems := ParseMarkdown("set_pieces/upcoming/sprint-14.md", sprint, Defaults{Time: "09:00"})
	if len(problems) != 0 {
		t.Fatalf("problems: %v", problems)
	}
	if len(tickets) != 3 {
		t.Fatalf("want 3 tickets, got %d", len(tickets))
	}
	one := tickets[0]
	if one.ID != "KICK-1" || one.Title != "Add a dark mode toggle" || one.Sprint != "Sprint 14" || one.Mode != "auto" ||
		one.SetPiece != "run-heroic" || one.Timezone != "Europe/London" {
		t.Fatalf("ticket one: %+v", one)
	}
	if one.Prompt != "Add a toggle to the header that switches the theme\nand remembers the choice." {
		t.Fatalf("prompt: %q", one.Prompt)
	}
	// 10:30 in London in October (BST) is 09:30 UTC.
	if got := one.DueAt.UTC().Format(time.RFC3339); got != "2026-10-12T09:30:00Z" {
		t.Fatalf("due: %s", got)
	}
	two := tickets[1]
	if two.Mode != "manual" || two.Player != "ranger" || two.Time != "" ||
		two.DueAt.UTC().Format(time.RFC3339) != "2026-10-13T08:00:00Z" {
		t.Fatalf("ticket two takes the default mode and time: %+v", two)
	}
	if tickets[2].Prompt != "specs/kick-3.md" {
		t.Fatalf("a spec replaces the prose: %q", tickets[2].Prompt)
	}
}

func TestParseMarkdownNamesEachBrokenTicketAndKeepsTheRest(t *testing.T) {
	text := `## KICK-1 · No date
set piece: ask

Prompt.

## KICK-2 · Bad time
date: 2026-10-12
time: 25:00
set piece: ask

Prompt.

## KICK-3 · Unknown field
date: 2026-10-12
set piece: ask
colour: blue

Prompt.

## KICK-4 · No prompt
date: 2026-10-12
set piece: ask

## KICK-5 · Fine
date: 2026-10-12
set piece: ask
mode: AUTO

Prompt.
`
	tickets, problems := ParseMarkdown("plan.md", text, Defaults{})
	if len(tickets) != 2 || tickets[len(tickets)-1].ID != "KICK-5" || tickets[len(tickets)-1].Mode != "auto" {
		t.Fatalf("tickets: %+v", tickets)
	}
	joined := ""
	for _, p := range problems {
		joined += p.Error() + "\n"
	}
	for _, want := range []string{"KICK-1: date", "KICK-2: time", `KICK-3: unknown field "colour"`, "KICK-4: no prompt"} {
		if !strings.Contains(joined, want) {
			t.Errorf("problems should name %q:\n%s", want, joined)
		}
	}
}

func config(t *testing.T, files map[string]string) *boardroom.Config {
	t.Helper()
	dir := t.TempDir()
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cfg := boardroom.Default()
	cfg.Upcoming.Sources = []boardroom.UpcomingSource{{Kind: "markdown", Path: filepath.Join(dir, "*.md")}}
	cfg.Upcoming.Timezone = "UTC"
	return cfg
}

func TestLoadSkipsTheReadmeDuplicatesAndUnknownSetPieces(t *testing.T) {
	cfg := config(t, map[string]string{
		"README.md": "## KICK-9 · Example in the readme\ndate: 2026-10-12\nset piece: ask\n\nIgnored.\n",
		"a.md":      "## KICK-2 · Later\ndate: 2026-10-14\nset piece: ask\n\nP.\n\n## KICK-1 · Sooner\ndate: 2026-10-12\nset piece: ask\n\nP.\n",
		"b.md":      "## KICK-1 · Again\ndate: 2026-10-13\nset piece: ask\n\nP.\n\n## KICK-3 · Odd\ndate: 2026-10-13\nset piece: juggle\n\nP.\n",
	})
	tickets, problems := Load(cfg, func(name string) bool { return name == "ask" })
	var ids []string
	for _, t := range tickets {
		ids = append(ids, t.ID)
	}
	if strings.Join(ids, ",") != "KICK-1,KICK-2" {
		t.Fatalf("tickets in due order without the readme, duplicate or unknown set piece: %v", ids)
	}
	if len(problems) != 2 {
		t.Fatalf("want the duplicate and the unknown set piece as problems, got %v", problems)
	}
}

func openFeed(t *testing.T) *matchfeed.Feed {
	t.Helper()
	dir := t.TempDir()
	feed, err := matchfeed.Open(filepath.Join(dir, "match_log.db"), os.DevNull, matchfeed.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { feed.Close() })
	return feed
}

func statuses(t *testing.T, feed *matchfeed.Feed) map[string]string {
	t.Helper()
	rows, err := feed.UpcomingRows()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, r := range rows {
		out[r.TicketID] = r.Status
	}
	return out
}

func TestSyncMarksDueAndScheduledKeepsSettledTicketsAndSkipsRemovedOnes(t *testing.T) {
	feed := openFeed(t)
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }
	tickets := []Ticket{
		{ID: "KICK-1", Title: "one", Date: "2026-10-12", SetPiece: "ask", Mode: "auto", Prompt: "p", DueAt: at("2026-10-12T09:00:00Z")},
		{ID: "KICK-2", Title: "two", Date: "2026-10-14", SetPiece: "ask", Mode: "auto", Prompt: "p", DueAt: at("2026-10-14T09:00:00Z")},
		{ID: "KICK-3", Title: "three", Date: "2026-10-12", SetPiece: "ask", Mode: "manual", Prompt: "p", DueAt: at("2026-10-12T09:00:00Z")},
	}
	if err := Sync(feed, tickets, "mac", at("2026-10-13T00:00:00Z")); err != nil {
		t.Fatal(err)
	}
	if got := statuses(t, feed); got["KICK-1"] != "due" || got["KICK-2"] != "scheduled" || got["KICK-3"] != "due" {
		t.Fatalf("statuses: %v", got)
	}
	// KICK-1 is played; KICK-3 leaves its file before it ran.
	feed.UpcomingUpsert(matchfeed.UpcomingRow{TicketID: "KICK-1", Title: "one", Date: "2026-10-12", SetPiece: "ask",
		Mode: "auto", Prompt: "p", Status: "touchdown", MatchID: "m1", Machine: "mac"})
	if err := Sync(feed, tickets[:2], "mac", at("2026-10-15T00:00:00Z")); err != nil {
		t.Fatal(err)
	}
	got := statuses(t, feed)
	if got["KICK-1"] != "touchdown" || got["KICK-2"] != "due" || got["KICK-3"] != "skipped" {
		t.Fatalf("after a run and a removal: %v", got)
	}
	rows, _ := feed.UpcomingRows()
	for _, r := range rows {
		if r.TicketID == "KICK-1" && r.MatchID != "m1" {
			t.Fatalf("a played ticket keeps its match: %+v", r)
		}
	}
}

func TestSpecPathIsAOneLineMarkdownPath(t *testing.T) {
	for prompt, want := range map[string]string{
		"specs/demo-quests/x.md":      "specs/demo-quests/x.md",
		"  specs/a.MD\n":              "specs/a.MD",
		"Write specs/a.md":            "",
		"Add a toggle.":               "",
		"specs/a.md\nand more prose.": "",
	} {
		if got := SpecPath(prompt); got != want {
			t.Errorf("SpecPath(%q) = %q, want %q", prompt, got, want)
		}
	}
}
