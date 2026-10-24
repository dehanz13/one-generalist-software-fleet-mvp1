package spectools

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// gitIn runs git in dir and fails the test on an error.
func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

// newRepo makes a git repository with one commit holding files (path → text).
func newRepo(t *testing.T, files map[string]string) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "repo")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	gitIn(t, root, "init", "-q")
	gitIn(t, root, "config", "user.email", "t@example.invalid")
	gitIn(t, root, "config", "user.name", "t")
	gitIn(t, root, "config", "commit.gpgsign", "false")
	for path, text := range files {
		writeFile(t, filepath.Join(root, path), text)
	}
	gitIn(t, root, "add", "-A")
	gitIn(t, root, "commit", "-q", "--allow-empty", "-m", "base")
	return root
}

func writeFile(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// copyTree copies a directory of fixtures into dst.
func copyTree(t *testing.T, src, dst string) {
	t.Helper()
	err := filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
}

// fakeOnPath puts an executable called name, holding script, first on PATH.
func fakeOnPath(t *testing.T, name, script string) string {
	t.Helper()
	bin := t.TempDir()
	path := filepath.Join(bin, name)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	return bin
}
