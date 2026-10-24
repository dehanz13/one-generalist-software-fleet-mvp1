package demo

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchday"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
)

// Dataset is the demo dataset Matchday Live replays in the browser: every
// match with every row the API would serve for it, in the API's own shapes
// (see matchday_live/README.md). Matches are ordered by start, oldest first,
// so a replay plays them in the order they happened. Version 2 adds the
// Upcoming Matches board and the requests, as they stand at the end.
type Dataset struct {
	Version     int            `json:"version"`
	GeneratedAt string         `json:"generated_at"`
	Title       string         `json:"title"`
	Matches     []DemoMatch    `json:"matches"`
	Upcoming    []matchday.Row `json:"upcoming"`
	Requests    []matchday.Row `json:"requests"`
}

// DemoMatch is one match and everything under it.
type DemoMatch struct {
	Match      matchday.Row   `json:"match"`
	Objectives any            `json:"objectives"`
	Players    any            `json:"players"`
	Events     []matchday.Row `json:"events"`
	Reports    []matchday.Row `json:"reports"`
	Reviews    []matchday.Row `json:"reviews"`
	Processes  []matchday.Row `json:"processes"`
	TeamTalks  []matchday.Row `json:"team_talks"`
}

// Export writes the dataset for every match in a match log.
func Export(dbPath, outPath, title string) (*Dataset, error) {
	db, err := matchfeed.OpenDB(dbPath)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	reader := &matchday.Reader{DB: db, Path: dbPath}
	data := &Dataset{Version: 2, GeneratedAt: kit.NowISO(), Title: title}
	if data.Upcoming, err = reader.Upcoming(); err != nil {
		return nil, err
	}
	rows, err := db.Query("SELECT * FROM requests ORDER BY created_at DESC, request_id")
	if err != nil {
		return nil, err
	}
	data.Requests, err = matchfeed.ScanRows(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	if data.Requests == nil {
		data.Requests = []matchday.Row{}
	}
	all, err := reader.Matches(matchday.MaxLimit, "all")
	if err != nil {
		return nil, err
	}
	sort.SliceStable(all, func(i, j int) bool {
		a, _ := all[i]["started_at"].(string)
		b, _ := all[j]["started_at"].(string)
		return a < b
	})
	for _, summary := range all {
		id, _ := summary["match_id"].(string)
		detail, err := reader.Detail(id)
		if err != nil {
			return nil, err
		}
		m := DemoMatch{Match: detail["match"].(matchday.Row), Objectives: detail["objectives"], Players: detail["players"]}
		after := 0
		for {
			page, err := reader.Events(id, after, matchday.MaxLimit)
			if err != nil {
				return nil, err
			}
			events, _ := page["events"].([]matchday.Row)
			m.Events = append(m.Events, events...)
			if more, _ := page["has_more"].(bool); !more {
				break
			}
			next, _ := page["cursor"].(int64)
			after = int(next)
		}
		if m.Reports, err = reader.Reports(id); err != nil {
			return nil, err
		}
		if m.Reviews, err = reader.Reviews(id); err != nil {
			return nil, err
		}
		if m.Processes, err = reader.Processes(id); err != nil {
			return nil, err
		}
		rows, err := db.Query("SELECT player, system, user FROM team_talks WHERE match_id = ? ORDER BY player", id)
		if err != nil {
			return nil, err
		}
		talks, err := matchfeed.ScanRows(rows)
		rows.Close()
		if err != nil {
			return nil, err
		}
		if talks == nil {
			talks = []matchday.Row{}
		}
		m.TeamTalks = talks
		if m.Events == nil {
			m.Events = []matchday.Row{}
		}
		data.Matches = append(data.Matches, m)
	}
	if outPath != "" {
		if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
			return nil, err
		}
		encoded, err := json.MarshalIndent(data, "", " ")
		if err != nil {
			return nil, err
		}
		if err := os.WriteFile(outPath, encoded, 0o644); err != nil {
			return nil, err
		}
	}
	return data, nil
}
