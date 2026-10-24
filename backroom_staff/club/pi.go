package club

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/abandoned"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/kit"
)

// Pi runs `pi -p --mode json` and reads its JSONL stdout line by line,
// forwarding each event WHILE the player works. `--session-id` creates or
// continues, so running and continuing a player are the same call.
type Pi struct {
	once    sync.Once
	catalog []catalogRow
}

type catalogRow struct {
	provider, model string
	window          int
}

// NewPi returns the Pi driver.
func NewPi() *Pi { return &Pi{} }

// Name implements Driver.
func (*Pi) Name() string { return "pi" }

func piPath() string {
	if p := os.Getenv("PI_PATH"); p != "" {
		return p
	}
	return "pi"
}

// The model catalogs pi keeps. Pi 1.1 renamed models.json to
// models-store.json; PI_MODELS_PATH serves a custom or older one.
func catalogPaths() []string {
	home, _ := os.UserHomeDir()
	primary := os.Getenv("PI_MODELS_PATH")
	if primary == "" {
		primary = filepath.Join(home, ".pi", "agent", "models.json")
	}
	store := filepath.Join(home, ".pi", "agent", "models-store.json")
	if primary == store {
		return []string{primary}
	}
	return []string{primary, store}
}

// parseCount reads pi's compact counts: `272K`, `1.0M`.
func parseCount(value string) (int, error) {
	if value == "" {
		return 0, errors.New("empty")
	}
	suffix := strings.ToUpper(value[len(value)-1:])
	mult := map[string]float64{"K": 1_000, "M": 1_000_000}
	if m, ok := mult[suffix]; ok {
		f, err := strconv.ParseFloat(value[:len(value)-1], 64)
		if err != nil {
			return 0, err
		}
		return int(f * m), nil
	}
	return strconv.Atoi(value)
}

// loadCatalog reads `pi --list-models` once per process: built-in providers
// merged with custom models.
func (p *Pi) loadCatalog() []catalogRow {
	p.once.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, piPath(), "--list-models")
		cmd.Env = kit.OperatorEnv()
		out, err := cmd.Output()
		if err != nil {
			return
		}
		lines := strings.Split(string(out), "\n")
		for _, line := range lines[min(1, len(lines)):] {
			columns := strings.Fields(line)
			if len(columns) < 3 {
				continue
			}
			window, err := parseCount(columns[2])
			if err != nil {
				continue
			}
			p.catalog = append(p.catalog, catalogRow{columns[0], columns[1], window})
		}
	})
	return p.catalog
}

// Resolve turns a model pattern into an explicit (provider, model id): an
// exact provider/id, else exactly one exact id, else exactly one substring
// match. Ambiguity and absence are errors, not guesses.
func (p *Pi) Resolve(pattern string) (string, string, error) {
	catalog := p.loadCatalog()
	if provider, id, ok := strings.Cut(pattern, "/"); ok {
		for _, row := range catalog {
			if row.provider == provider && row.model == id {
				return provider, id, nil
			}
		}
	}
	var matches, exact []catalogRow
	for _, row := range catalog {
		if pattern == row.model || strings.Contains(row.model, pattern) {
			matches = append(matches, row)
			if row.model == pattern || strings.HasSuffix(row.model, "/"+pattern) {
				exact = append(exact, row)
			}
		}
	}
	switch {
	case len(exact) == 1:
		return exact[0].provider, exact[0].model, nil
	case len(matches) == 1:
		return matches[0].provider, matches[0].model, nil
	case len(matches) == 0:
		return "", "", fmt.Errorf("model pattern %q not found in pi --list-models — "+
			"authenticate/register it or fix the config", pattern)
	}
	var names []string
	for _, m := range matches {
		names = append(names, m.provider+"/"+m.model)
	}
	return "", "", fmt.Errorf("model pattern %q is ambiguous: %s", pattern, strings.Join(names, ", "))
}

// ResolveModel implements Driver.
func (p *Pi) ResolveModel(pattern string) error {
	_, _, err := p.Resolve(pattern)
	return err
}

// ContextWindow is the model's context ceiling from pi's catalogs.
func (p *Pi) ContextWindow(provider, model string) int {
	for _, path := range catalogPaths() {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var registry map[string]any
		if json.Unmarshal(data, &registry) != nil {
			continue
		}
		// Older catalogs nest providers; Pi 1.1's store is keyed by provider.
		models := modelsOf(registry["providers"], provider)
		if len(models) == 0 {
			models = modelsOf(registry, provider)
		}
		for _, m := range models {
			entry, _ := m.(map[string]any)
			if entry["id"] == model {
				return asInt(entry["contextWindow"])
			}
		}
	}
	for _, row := range p.loadCatalog() {
		if row.provider == provider && row.model == model {
			return row.window
		}
	}
	return 0
}

func modelsOf(container any, provider string) []any {
	byProvider, _ := container.(map[string]any)
	entry, _ := byProvider[provider].(map[string]any)
	models, _ := entry["models"].([]any)
	return models
}

// Run sends one prompt through pi and waits for the turn to end.
func (p *Pi) Run(ctx context.Context, req Request, hooks Hooks) (Result, error) {
	provider, model, err := p.Resolve(req.Model)
	if err != nil {
		return Result{}, err
	}
	args := []string{"-p", "--mode", "json",
		"--provider", provider, "--model", model,
		"--thinking", req.Thinking,
		"--session-id", req.SessionID,
		"--session-dir", req.SessionDir,
		"--system-prompt", req.SystemPrompt,
	}
	if len(req.Tools) > 0 {
		args = append(args, "--tools", strings.Join(req.Tools, ","))
	}
	for _, e := range req.Enchantments {
		args = append(args, "-e", e)
	}
	args = append(args, req.Prompt)

	result := Result{SessionID: req.SessionID, ContextWindow: p.ContextWindow(provider, model)}
	cmd := kit.GroupCommand(ctx, piPath(), args...)
	cmd.Dir = req.Cwd
	cmd.Env = kit.OperatorEnv()
	// Stdin stays nil, which is /dev/null, deliberately: the prompt travels in
	// argv, and an inherited stdin made pi wait forever for piped input that
	// never came, at 0% CPU with an empty raw_output.jsonl.
	return streamJSONL(cmd, req.RawOutputPath, hooks, result)
}

// streamJSONL runs a club process whose stdout is pi-shaped JSONL, keeps
// every line, and folds the events into a Result. The scripted club and the
// Pi driver share it, so both go through the same accounting.
func streamJSONL(cmd *exec.Cmd, rawPath string, hooks Hooks, result Result) (Result, error) {
	if err := os.MkdirAll(filepath.Dir(rawPath), 0o755); err != nil {
		return result, err
	}
	raw, err := os.OpenFile(rawPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return result, err
	}
	defer raw.Close()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return result, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return result, err
	}
	if hooks.OnSpawn != nil {
		hooks.OnSpawn(cmd.Process.Pid)
	}
	acc := newAccumulator(&result)
	reader := bufio.NewReader(stdout)
	for {
		line, readErr := reader.ReadString('\n')
		if line != "" {
			raw.WriteString(line) // events land on disk as they happen
			if !strings.HasSuffix(line, "\n") {
				raw.WriteString("\n")
			}
			acc.line(line, hooks)
		}
		if readErr != nil {
			if readErr != io.EOF {
				stderr.WriteString(readErr.Error())
			}
			break
		}
	}
	waitErr := cmd.Wait()
	result.ReturnCode = cmd.ProcessState.ExitCode()
	if hooks.OnExit != nil {
		hooks.OnExit(cmd.Process.Pid)
	}
	return acc.finish(waitErr, stderr.String())
}

// accumulator folds a club's JSONL events into a Result.
type accumulator struct {
	result         *Result
	providerErrors []string
}

func newAccumulator(r *Result) *accumulator { return &accumulator{result: r} }

func (a *accumulator) line(line string, hooks Hooks) {
	line = strings.TrimSpace(line)
	if line == "" {
		return
	}
	var event map[string]any
	if json.Unmarshal([]byte(line), &event) != nil {
		return
	}
	a.event(event)
	if hooks.OnEvent != nil {
		hooks.OnEvent(event)
	}
}

func (a *accumulator) event(event map[string]any) {
	if event["type"] != "message_end" {
		return
	}
	message, _ := event["message"].(map[string]any)
	if message["role"] != "assistant" {
		return
	}
	if text := TextOf(message); text != "" {
		a.result.Text = text // the last assistant message wins
	}
	stop, _ := message["stopReason"].(string)
	if errMsg, _ := message["errorMessage"].(string); stop == "error" && errMsg != "" {
		a.providerErrors = append(a.providerErrors, errMsg)
	}
	usage, _ := message["usage"].(map[string]any)
	if usage == nil {
		usage = map[string]any{}
	}
	turn := ContextTokens(usage)
	a.result.Tokens += turn
	a.result.Usage.AddTurn(usage, turn)
	// Occupancy is read off the last VALID assistant turn, the way pi does
	// it: an aborted or errored turn reports usage that cannot be trusted.
	if turn != 0 && stop != "aborted" && stop != "error" {
		a.result.ContextTokens = turn
	}
	cost, _ := usage["cost"].(map[string]any)
	a.result.Cost += asFloat(cost["total"])
}

func (a *accumulator) finish(waitErr error, stderr string) (Result, error) {
	if len(a.providerErrors) > 0 && a.result.Text == "" {
		// Its own type, so a set piece can tell a cut-off club from wrong work.
		return *a.result, &abandoned.MatchAbandoned{
			Message: "pi provider error: " + a.providerErrors[len(a.providerErrors)-1]}
	}
	if a.result.ReturnCode != 0 && a.result.Text == "" {
		return *a.result, fmt.Errorf("pi exited %d: %s", a.result.ReturnCode, kit.Tail(strings.TrimSpace(stderr), 800))
	}
	_ = waitErr // a non-zero exit WITH a reply is still a reply, as in legacy
	return *a.result, nil
}
