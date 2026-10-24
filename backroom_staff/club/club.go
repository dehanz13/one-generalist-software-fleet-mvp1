// Package club is the adapter between the fleet and the agent programs that
// run a model: one interface, a driver per club. (Legacy: agent_pi.py, and
// the agent_cc.py stub.)
//
// A driver starts a program the founder has already signed in to; that
// program holds the credential, never the fleet. Lanes never learn a club's
// command-line flags: they hand a Request to Run and get a Result back, with
// the club's stream forwarded event by event WHILE it works.
package club

import (
	"context"
	"fmt"
	"sync"
)

// Request is everything one non-interactive club turn needs. (Legacy: PiRequest.)
type Request struct {
	Prompt        string
	SystemPrompt  string
	Model         string // provider/id or a pattern the club resolves
	Thinking      string
	SessionID     string // same id = same context window (creates or continues)
	SessionDir    string
	RawOutputPath string // the club's JSONL stream lands here, line by line
	Tools         []string
	Enchantments  []string
	Cwd           string // the repo root players work in
	Player        string
	// Vars are values a scripted club may substitute into its script:
	// match_id, torch_pass_dir, repo_root.
	Vars map[string]string
}

// Hooks bracket a club run. OnSpawn and OnExit let the caller record the
// child as killable: a hung club is otherwise a pid to hunt for in `ps`.
type Hooks struct {
	OnEvent func(event map[string]any)
	OnSpawn func(pid int)
	OnExit  func(pid int)
}

// Usage is tokens and the dollars they cost, per component, summed over a
// call. It mirrors pi's `usage` shape one for one: `input` EXCLUDES cache
// reads; reasoning is the thinking SHARE of output, never added to it.
type Usage struct {
	InputTokens      int     `json:"input_tokens"`
	OutputTokens     int     `json:"output_tokens"`
	CacheReadTokens  int     `json:"cache_read_tokens"`
	CacheWriteTokens int     `json:"cache_write_tokens"`
	ReasoningTokens  int     `json:"reasoning_tokens"`
	TotalTokens      int     `json:"total_tokens"`
	InputCost        float64 `json:"input_cost"`
	OutputCost       float64 `json:"output_cost"`
	CacheReadCost    float64 `json:"cache_read_cost"`
	CacheWriteCost   float64 `json:"cache_write_cost"`
	TotalCost        float64 `json:"total_cost"`
}

// AddTurn folds in one `message_end` usage object. totalTokens is passed in,
// already computed pi's way (totalTokens, else the sum of the parts).
func (u *Usage) AddTurn(usage map[string]any, totalTokens int) {
	cost, _ := usage["cost"].(map[string]any)
	u.InputTokens += asInt(usage["input"])
	u.OutputTokens += asInt(usage["output"])
	u.CacheReadTokens += asInt(usage["cacheRead"])
	u.CacheWriteTokens += asInt(usage["cacheWrite"])
	u.ReasoningTokens += asInt(usage["reasoning"])
	u.TotalTokens += totalTokens
	u.InputCost += asFloat(cost["input"])
	u.OutputCost += asFloat(cost["output"])
	u.CacheReadCost += asFloat(cost["cacheRead"])
	u.CacheWriteCost += asFloat(cost["cacheWrite"])
	u.TotalCost += asFloat(cost["total"])
}

// Merge adds another call's usage: an objective that retries spends more than once.
func (u *Usage) Merge(o Usage) {
	u.InputTokens += o.InputTokens
	u.OutputTokens += o.OutputTokens
	u.CacheReadTokens += o.CacheReadTokens
	u.CacheWriteTokens += o.CacheWriteTokens
	u.ReasoningTokens += o.ReasoningTokens
	u.TotalTokens += o.TotalTokens
	u.InputCost += o.InputCost
	u.OutputCost += o.OutputCost
	u.CacheReadCost += o.CacheReadCost
	u.CacheWriteCost += o.CacheWriteCost
	u.TotalCost += o.TotalCost
}

// Result is what one club turn produced. (Legacy: PiResult.)
type Result struct {
	Text       string
	ReturnCode int
	SessionID  string
	Tokens     int
	Cost       float64
	Usage      Usage
	// Context occupancy after the LAST turn, not a sum: how full the window
	// is right now, which the page's context bar measures against the window.
	ContextTokens int
	ContextWindow int // 0 when the club declares no ceiling
}

// Driver runs one club.
type Driver interface {
	// Name is the config value: pi, claude_code, scripted.
	Name() string
	// ResolveModel checks the club can run a model, before anything spawns.
	ResolveModel(pattern string) error
	// Run sends one prompt and waits for the turn to end.
	Run(ctx context.Context, req Request, hooks Hooks) (Result, error)
}

var (
	mu      sync.Mutex
	drivers = map[string]Driver{}
)

// Register installs a driver under its name (the scripted club is swapped in
// tests and by the demo).
func Register(d Driver) {
	mu.Lock()
	defer mu.Unlock()
	drivers[d.Name()] = d
}

// For returns the driver for a club name.
func For(name string) (Driver, error) {
	mu.Lock()
	defer mu.Unlock()
	if d, ok := drivers[name]; ok {
		return d, nil
	}
	return nil, fmt.Errorf("club %q has no driver", name)
}

// ResolveModel checks a club can run a model: the boardroom.ModelResolver.
func ResolveModel(clubName, model string) error {
	d, err := For(clubName)
	if err != nil {
		return err
	}
	return d.ResolveModel(model)
}

func init() {
	Register(NewPi())
	Register(ClaudeCode{})
	Register(NewScripted())
}

func asInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

func asFloat(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	}
	return 0
}

// ContextTokens is what occupies the window after a turn, the way pi's own
// calculateContextTokens counts it: the provider's totalTokens, else the sum
// of the parts. Cache reads count: cached prompt is still prompt.
func ContextTokens(usage map[string]any) int {
	if total := asInt(usage["totalTokens"]); total != 0 {
		return total
	}
	return asInt(usage["input"]) + asInt(usage["output"]) + asInt(usage["cacheRead"]) + asInt(usage["cacheWrite"])
}

// TextOf joins the text blocks of anything shaped {content: [...]}: a message
// or a tool result.
func TextOf(container map[string]any) string {
	items, _ := container["content"].([]any)
	out := ""
	for _, item := range items {
		part, ok := item.(map[string]any)
		if !ok || part["type"] != "text" {
			continue
		}
		if text, ok := part["text"].(string); ok {
			out += text
		}
	}
	return out
}
