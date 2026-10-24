// Package resume decides whether a match id names a failed match awaiting
// re-verification. (Legacy: adw_modules/resume.py.)
package resume

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// ShouldReverify is true only for an existing match whose last result failed.
//
// A new id still plans and builds. Reusing a failed id means the founder
// repaired that same quest and wants one deterministic qa pass, not another
// paid spec/build/iterate cycle.
//
// Legacy cleared the failure on a console line starting "session <id> pass",
// but its console wrote "session <id> success …", so one failure marked an id
// failed forever. Here the touchdown line the console really writes clears it.
func ShouldReverify(dataDir, matchID string) bool {
	if matchID == "" {
		return false
	}
	file, err := os.Open(filepath.Join(dataDir, "matches", matchID, "match_feed.jsonl"))
	if err != nil {
		return false
	}
	defer file.Close()
	failed := false
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event struct {
			Type    string         `json:"type"`
			Name    string         `json:"name"`
			Payload map[string]any `json:"payload"`
		}
		if json.Unmarshal([]byte(line), &event) != nil {
			continue
		}
		switch {
		case event.Type == "error" && event.Name == "not_accepted":
			failed = true
		case event.Type == "log" && event.Name == "console":
			if message, _ := event.Payload["message"].(string); strings.HasPrefix(message, "match "+matchID+" touchdown") {
				failed = false
			}
		}
	}
	return failed
}
