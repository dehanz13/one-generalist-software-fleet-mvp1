//go:build windows

package kit

import (
	"context"
	"os/exec"
	"time"
)

// GroupCommand builds a cancellable command. Windows has no process groups
// in this sense; cancelling kills the direct child only.
func GroupCommand(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.WaitDelay = 2 * time.Second
	return cmd
}
