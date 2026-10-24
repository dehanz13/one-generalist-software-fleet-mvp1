//go:build !windows

package kit

import (
	"fmt"
	"os"
	"syscall"
)

// LockFile takes an exclusive lock on path, creating it, or fails at once
// when another process holds it. Release frees it.
func LockFile(path string) (release func(), err error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("%s is held by another process", path)
	}
	fmt.Fprintf(f, "%d\n", os.Getpid())
	return func() { syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, nil
}
