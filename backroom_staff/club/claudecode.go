package club

import (
	"context"
	"errors"
)

// ClaudeCode is a stub, as it was in legacy: the config accepts
// `club: claude_code` so nothing breaks at the schema level, but selecting it
// fails until a driver for `claude -p --output-format stream-json --resume
// <session_id>` is written.
type ClaudeCode struct{}

// Name implements Driver.
func (ClaudeCode) Name() string { return "claude_code" }

var errClaudeCode = errors.New("club 'claude_code' is not implemented yet — the fleet runs " +
	"the Pi coding agent (or the scripted club). Set club: pi (or omit it) in club.config.yaml")

// ResolveModel implements Driver.
func (ClaudeCode) ResolveModel(string) error { return errClaudeCode }

// Run implements Driver.
func (ClaudeCode) Run(context.Context, Request, Hooks) (Result, error) {
	return Result{}, errClaudeCode
}
