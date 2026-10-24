// Package kit holds the small helpers every other package shares: ids, the
// clock, the operator's environment, and reading a prompt argument. Anything
// bigger belongs in its own package. (Legacy: adw_modules/utils.py.)
package kit

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// NewID returns `length` hex characters from a cryptographic source.
// Legacy's new_id(8) was token_hex(4): the same eight characters.
func NewID(length int) string {
	buf := make([]byte, (length+1)/2)
	if _, err := rand.Read(buf); err != nil {
		panic("kit: no randomness: " + err.Error())
	}
	return hex.EncodeToString(buf)[:length]
}

// The clock every record uses. Normally the wall clock; the demo switches to
// a virtual clock so a scripted player that "works for four minutes" moves
// the timestamps four minutes without anyone waiting for them.
var (
	clockMu      sync.Mutex
	virtual      bool
	virtualStart time.Time     // the virtual time the clock started at
	realStart    time.Time     // the wall time it started at
	slept        time.Duration // virtual time added by Sleep
)

// Now is the current time on the active clock.
func Now() time.Time {
	clockMu.Lock()
	defer clockMu.Unlock()
	if !virtual {
		return time.Now()
	}
	return virtualStart.Add(time.Since(realStart) + slept)
}

// Sleep waits d on the wall clock, or advances the virtual clock by d at once.
func Sleep(d time.Duration) {
	clockMu.Lock()
	if virtual {
		slept += d
		clockMu.Unlock()
		return
	}
	clockMu.Unlock()
	time.Sleep(d)
}

// UseVirtualClock starts a virtual clock at start.
func UseVirtualClock(start time.Time) {
	clockMu.Lock()
	defer clockMu.Unlock()
	virtual, virtualStart, realStart, slept = true, start, time.Now(), 0
}

// UseRealClock goes back to the wall clock.
func UseRealClock() {
	clockMu.Lock()
	defer clockMu.Unlock()
	virtual = false
}

// Since is the time elapsed on the active clock.
func Since(t time.Time) time.Duration { return Now().Sub(t) }

// NowISO is the timestamp every row carries: UTC, milliseconds, an explicit
// offset. Byte-for-byte the format of Python's
// datetime.now(timezone.utc).isoformat(timespec="milliseconds"), so a match
// log written by either engine sorts the same way.
func NowISO() string {
	return Now().UTC().Format("2006-01-02T15:04:05.000-07:00")
}

// EnsureDir creates a directory and its parents, and returns its path.
func EnsureDir(path string) (string, error) {
	return path, os.MkdirAll(path, 0o755)
}

// OperatorEnv is the founder's own environment, as their shell would hand it
// over: what players and qa checks are meant to see.
//
// Legacy launched under `uv run`, which put its own virtualenv first on PATH;
// that venv held the factory's packages, not the operator's, so `python3` in a
// player's bash silently became the wrong one. The Go binary has no venv of its
// own, but if it is started from inside one, the same rule applies: the venv
// is stripped so a child sees the operator's toolchain.
func OperatorEnv() []string {
	env := os.Environ()
	venv := os.Getenv("VIRTUAL_ENV")
	if venv == "" {
		return env
	}
	venvBin := filepath.Join(venv, "bin")
	out := make([]string, 0, len(env))
	for _, kv := range env {
		switch {
		case strings.HasPrefix(kv, "VIRTUAL_ENV="):
			continue
		case strings.HasPrefix(kv, "PATH="):
			var kept []string
			for _, part := range filepath.SplitList(strings.TrimPrefix(kv, "PATH=")) {
				if part != "" && part != venvBin {
					kept = append(kept, part)
				}
			}
			out = append(out, "PATH="+strings.Join(kept, string(os.PathListSeparator)))
		default:
			out = append(out, kv)
		}
	}
	return out
}

// ResolvePrompt turns a command-line prompt into text: a path to a file is
// read, anything else is the prompt itself.
func ResolvePrompt(arg string) string {
	info, err := os.Stat(arg)
	if err != nil || info.IsDir() {
		return arg
	}
	data, err := os.ReadFile(arg)
	if err != nil {
		return arg
	}
	return string(data)
}

// FounderName is the label of the human's lane: FOUNDER_NAME, else git's
// user.name, else $USER, else "founder".
func FounderName() string {
	if name := strings.TrimSpace(os.Getenv("FOUNDER_NAME")); name != "" {
		return name
	}
	if out, err := exec.Command("git", "config", "user.name").Output(); err == nil {
		if name := strings.TrimSpace(string(out)); name != "" {
			return name
		}
	}
	if user := os.Getenv("USER"); user != "" {
		return user
	}
	return "founder"
}

// MachineName labels which Mac ran a match: CLUB_MACHINE, else the host name.
func MachineName() string {
	if name := strings.TrimSpace(os.Getenv("CLUB_MACHINE")); name != "" {
		return name
	}
	host, err := os.Hostname()
	if err != nil || host == "" {
		return "unknown"
	}
	return strings.TrimSuffix(host, ".local")
}

// Clip shortens text to `limit` characters, ending with an ellipsis when it
// had to cut. It counts characters, not bytes, so it never splits a rune.
func Clip(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return strings.TrimRight(string(runes[:limit]), " \t\n") + "…"
}

// Tail returns the last `limit` characters of text, unchanged otherwise.
func Tail(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[len(runes)-limit:])
}

// Head returns the first `limit` characters of text.
func Head(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}

// ErrNotARepo is returned by anything that needs git and is not inside a repository.
var ErrNotARepo = errors.New("not a git repository")
