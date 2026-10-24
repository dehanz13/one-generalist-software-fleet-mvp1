package club

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.yaml.in/yaml/v3"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
)

// Scripted is a club that plays a script instead of calling a model. It
// exists so the fleet can be exercised end to end without spending a token:
// the tests drive set pieces with it, and `ogsf demo` runs every set piece
// against a throwaway repository with it.
//
// It is not a mock of the lanes: it emits the same pi-shaped JSONL a real
// club does (tool calls, message_end with usage), writes raw_output.jsonl,
// and makes the file changes its script says a player makes, for real, in
// the repository. Everything downstream (the tracker, usage, official
// reviews, the restricted area, git) runs exactly as it would for pi.
type Scripted struct {
	mu     sync.Mutex
	script *Script
	next   map[string]int
}

// Script is what each player does, turn by turn. A turn is one prompt sent
// to the club: a first prompt, a JSON correction, an official review's
// correction each use one.
type Script struct {
	Players map[string][]Turn `json:"players" yaml:"players"`
}

// Turn is one reply from a scripted player.
type Turn struct {
	Steps []Step `json:"steps" yaml:"steps"`
	// ThinkMS is how long the player "thinks" before replying.
	ThinkMS int `json:"think_ms" yaml:"think_ms"`
	// Reply is the final assistant text: normally the report JSON.
	Reply string `json:"reply" yaml:"reply"`
	Usage struct {
		Input      int     `json:"input" yaml:"input"`
		Output     int     `json:"output" yaml:"output"`
		CacheRead  int     `json:"cache_read" yaml:"cache_read"`
		CacheWrite int     `json:"cache_write" yaml:"cache_write"`
		Reasoning  int     `json:"reasoning" yaml:"reasoning"`
		Cost       float64 `json:"cost" yaml:"cost"`
	} `json:"usage" yaml:"usage"`
	// ProviderError ends the turn the way a provider refusal does:
	// stopReason "error" with this message, and no text.
	ProviderError string `json:"provider_error" yaml:"provider_error"`
}

// Step is one tool call the player makes.
type Step struct {
	Tool       string         `json:"tool" yaml:"tool"`
	Args       map[string]any `json:"args" yaml:"args"`
	Result     string         `json:"result" yaml:"result"`
	IsError    bool           `json:"is_error" yaml:"is_error"`
	DurationMS int            `json:"duration_ms" yaml:"duration_ms"`
	// Write creates or replaces a file, for real, relative to the repo root.
	Write *FileWrite `json:"write,omitempty" yaml:"write,omitempty"`
	// Edit replaces text in a file as it is when the step runs, so several
	// edits to one file in one turn build on each other.
	Edit *FileEdit `json:"edit,omitempty" yaml:"edit,omitempty"`
	// Delete removes a file, for real.
	Delete string `json:"delete,omitempty" yaml:"delete,omitempty"`
	// Run runs a shell command, for real, in the repo root; its output becomes
	// the step's result unless Result is set.
	Run string `json:"run,omitempty" yaml:"run,omitempty"`
}

// FileWrite is a file a scripted step writes.
type FileWrite struct {
	Path    string `json:"path" yaml:"path"`
	Content string `json:"content" yaml:"content"`
	Append  bool   `json:"append" yaml:"append"`
}

// FileEdit replaces the first Old with New in a file; Old must be there.
type FileEdit struct {
	Path string `json:"path" yaml:"path"`
	Old  string `json:"old" yaml:"old"`
	New  string `json:"new" yaml:"new"`
}

// NewScripted returns the scripted driver with no script.
func NewScripted() *Scripted { return &Scripted{next: map[string]int{}} }

// Name implements Driver.
func (*Scripted) Name() string { return "scripted" }

// ResolveModel implements Driver: a script runs any model name.
func (*Scripted) ResolveModel(string) error { return nil }

// Use sets the script every following turn is taken from, and rewinds it.
func (s *Scripted) Use(script *Script) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.script, s.next = script, map[string]int{}
}

// UseScript installs a script on the registered scripted driver.
func UseScript(script *Script) {
	d, _ := For("scripted")
	if sd, ok := d.(*Scripted); ok {
		sd.Use(script)
	}
}

// LoadScript reads a script from a YAML or JSON file.
func LoadScript(path string) (*Script, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var script Script
	if err := yaml.Unmarshal(data, &script); err != nil {
		return nil, fmt.Errorf("script %s: %w", path, err)
	}
	return &script, nil
}

func (s *Scripted) take(player string) (Turn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.script == nil {
		if path := os.Getenv("CLUB_SCRIPT"); path != "" {
			script, err := LoadScript(path)
			if err != nil {
				return Turn{}, err
			}
			s.script = script
		} else {
			return Turn{}, fmt.Errorf("scripted club: no script (set CLUB_SCRIPT, or run `ogsf demo`)")
		}
	}
	turns := s.script.Players[player]
	i := s.next[player]
	if i >= len(turns) {
		return Turn{}, fmt.Errorf("scripted club: no turn left for %s (it had %d)", player, len(turns))
	}
	s.next[player] = i + 1
	return turns[i], nil
}

// Run plays the player's next turn.
func (s *Scripted) Run(ctx context.Context, req Request, hooks Hooks) (Result, error) {
	turn, err := s.take(req.Player)
	if err != nil {
		return Result{}, err
	}
	sub := func(text string) string {
		for k, v := range req.Vars {
			text = strings.ReplaceAll(text, "{{"+k+"}}", v)
		}
		return text
	}
	if err := os.MkdirAll(filepath.Dir(req.RawOutputPath), 0o755); err != nil {
		return Result{}, err
	}
	raw, err := os.OpenFile(req.RawOutputPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return Result{}, err
	}
	defer raw.Close()

	result := Result{SessionID: req.SessionID, ContextWindow: 200_000}
	acc := newAccumulator(&result)
	emit := func(event map[string]any) {
		data, _ := json.Marshal(event)
		raw.Write(append(data, '\n'))
		acc.line(string(data), hooks)
	}
	pid := os.Getpid()
	if hooks.OnSpawn != nil {
		hooks.OnSpawn(pid)
	}
	emit(map[string]any{"type": "agent_start"})

	// pi reports usage once per assistant message, one message per API call,
	// and the window's occupancy is the LAST call's total. A script gives a
	// turn's usage as a whole, so it is spread over the turn's calls (one per
	// step, one for the reply), the remainder on the last: the match's totals
	// stay exact, and the occupancy reads as a real window would, not as the
	// sum of every call the turn made.
	calls := len(turn.Steps) + 1
	share := func(i int) map[string]any {
		part := func(total int) int {
			if i == calls-1 {
				return total - total/calls*(calls-1)
			}
			return total / calls
		}
		cost := turn.Usage.Cost / float64(calls)
		if i == calls-1 {
			cost = turn.Usage.Cost - cost*float64(calls-1)
		}
		in, out := part(turn.Usage.Input), part(turn.Usage.Output)
		cacheRead, cacheWrite := part(turn.Usage.CacheRead), part(turn.Usage.CacheWrite)
		return map[string]any{
			"input": in, "output": out, "cacheRead": cacheRead, "cacheWrite": cacheWrite,
			"reasoning":   part(turn.Usage.Reasoning),
			"totalTokens": in + out + cacheRead + cacheWrite,
			"cost": map[string]any{
				"input": cost * 0.3, "output": cost * 0.5, "cacheRead": cost * 0.1, "cacheWrite": cost * 0.1, "total": cost,
			},
		}
	}

	for i, step := range turn.Steps {
		if err := ctx.Err(); err != nil {
			break
		}
		callID := fmt.Sprintf("call_%s_%d", kit.NewID(6), i)
		args := map[string]any{}
		for k, v := range step.Args {
			if text, ok := v.(string); ok {
				args[k] = sub(text)
			} else {
				args[k] = v
			}
		}
		emit(map[string]any{"type": "message_end", "message": map[string]any{
			"role": "assistant", "stopReason": "toolUse",
			"content": []any{map[string]any{"type": "toolCall", "id": callID, "name": step.Tool, "arguments": args}},
			"usage":   share(i),
		}})
		emit(map[string]any{"type": "tool_execution_start", "toolCallId": callID, "toolName": step.Tool, "args": args})
		text, isError := sub(step.Result), step.IsError
		if out, failed, done := s.act(ctx, step, req.Cwd, sub); done {
			if text == "" {
				text = out
			}
			isError = isError || failed
		}
		kit.Sleep(time.Duration(step.DurationMS) * time.Millisecond)
		emit(map[string]any{"type": "tool_execution_end", "toolCallId": callID, "toolName": step.Tool,
			"args": args, "isError": isError,
			"result": map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}}})
	}
	kit.Sleep(time.Duration(turn.ThinkMS) * time.Millisecond)

	message := map[string]any{"role": "assistant", "usage": share(calls - 1), "stopReason": "stop"}
	if turn.ProviderError != "" {
		message["stopReason"] = "error"
		message["errorMessage"] = turn.ProviderError
		message["content"] = []any{}
	} else {
		message["content"] = []any{map[string]any{"type": "text", "text": sub(turn.Reply)}}
	}
	emit(map[string]any{"type": "message_end", "message": message})
	emit(map[string]any{"type": "agent_end"})
	if hooks.OnExit != nil {
		hooks.OnExit(pid)
	}
	return acc.finish(ctx.Err(), "")
}

// act performs a step's real side effect. done is false when the step has none.
func (s *Scripted) act(ctx context.Context, step Step, cwd string, sub func(string) string) (output string, failed, done bool) {
	resolve := func(p string) string {
		p = sub(p)
		if filepath.IsAbs(p) {
			return p
		}
		return filepath.Join(cwd, p)
	}
	switch {
	case step.Write != nil:
		path := resolve(step.Write.Path)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err.Error(), true, true
		}
		flags := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
		if step.Write.Append {
			flags = os.O_CREATE | os.O_WRONLY | os.O_APPEND
		}
		f, err := os.OpenFile(path, flags, 0o644)
		if err != nil {
			return err.Error(), true, true
		}
		defer f.Close()
		if _, err := f.WriteString(sub(step.Write.Content)); err != nil {
			return err.Error(), true, true
		}
		return fmt.Sprintf("Successfully wrote %d bytes to %s", len(sub(step.Write.Content)), sub(step.Write.Path)), false, true
	case step.Edit != nil:
		path := resolve(step.Edit.Path)
		data, err := os.ReadFile(path)
		if err != nil {
			return err.Error(), true, true
		}
		old, replacement := sub(step.Edit.Old), sub(step.Edit.New)
		if !strings.Contains(string(data), old) {
			return "Could not find the exact text in " + sub(step.Edit.Path), true, true
		}
		if err := os.WriteFile(path, []byte(strings.Replace(string(data), old, replacement, 1)), 0o644); err != nil {
			return err.Error(), true, true
		}
		return "Successfully replaced text in " + sub(step.Edit.Path), false, true
	case step.Delete != "":
		if err := os.Remove(resolve(step.Delete)); err != nil {
			return err.Error(), true, true
		}
		return "removed " + sub(step.Delete), false, true
	case step.Run != "":
		cmd := exec.CommandContext(ctx, "bash", "-c", sub(step.Run))
		cmd.Dir = cwd
		cmd.Env = kit.OperatorEnv()
		out, err := cmd.CombinedOutput()
		return strings.TrimRight(string(out), "\n"), err != nil, true
	}
	return "", false, false
}
