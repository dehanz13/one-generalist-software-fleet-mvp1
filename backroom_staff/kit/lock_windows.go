//go:build windows

package kit

import "os"

// LockFile creates path; Windows gets no exclusive lock here.
func LockFile(path string) (release func(), err error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, err
	}
	return func() { f.Close() }, nil
}
