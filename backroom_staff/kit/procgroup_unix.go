//go:build !windows

package kit

import (
	"context"
	"os/exec"
	"syscall"
	"time"
)

// GroupCommand builds a command that runs in its own process group, so
// cancelling it (a time limit, Ctrl-C) stops the command AND every child it
// started. Legacy's subprocess timeout killed only the direct child, so a
// test runner's workers could outlive their limit.
func GroupCommand(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		// The negative pid addresses the whole group.
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	// After the kill, stop waiting on output pipes a stray grandchild holds.
	cmd.WaitDelay = 2 * time.Second
	return cmd
}
