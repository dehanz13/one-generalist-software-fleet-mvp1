// Package incorporate puts the fleet into a repository. (Legacy: the skill's
// scripts/install.py and make_config.py; the picked verbs are incorporate and
// onboard.) Idempotent: existing files are skipped unless forced.
package incorporate

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/templates"
)

// GitignoreEntries keep the match runtime and every secret out of git.
var GitignoreEntries = []string{
	"set_pieces/clubhouse/matches/",
	"set_pieces/clubhouse/match_log.db*",
	".env",
}

// Result lists what was stamped and what was left alone.
type Result struct {
	Stamped []string
	Skipped []string
}

func stamp(src, dest string, force bool, r *Result) error {
	return fs.WalkDir(templates.FS, src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		target := filepath.Join(dest, strings.TrimPrefix(path, src))
		if src == path {
			target = dest
		}
		if _, err := os.Stat(target); err == nil && !force {
			r.Skipped = append(r.Skipped, target)
			return nil
		}
		data, err := templates.FS.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(target, data, 0o644); err != nil {
			return err
		}
		r.Stamped = append(r.Stamped, target)
		return nil
	})
}

func ensureGitignore(root string, r *Result) error {
	path := filepath.Join(root, ".gitignore")
	existing := map[string]bool{}
	if data, err := os.ReadFile(path); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			existing[strings.TrimSpace(line)] = true
		}
	}
	var missing []string
	for _, e := range GitignoreEntries {
		if !existing[e] {
			missing = append(missing, e)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := fmt.Fprintf(f, "\n# ogsf runtime\n%s\n", strings.Join(missing, "\n")); err != nil {
		return err
	}
	r.Stamped = append(r.Stamped, fmt.Sprintf("%s (+%d entries)", path, len(missing)))
	return nil
}

// Incorporate stamps the fleet into root.
func Incorporate(root string, force bool) (Result, error) {
	var r Result
	if err := stamp("set_pieces", filepath.Join(root, "set_pieces"), force, &r); err != nil {
		return r, err
	}
	if err := stamp("env.sample", filepath.Join(root, ".env.sample"), force, &r); err != nil {
		return r, err
	}
	return r, ensureGitignore(root, &r)
}

// Report prints what Incorporate did and the next steps.
func Report(w io.Writer, root string, r Result) {
	fmt.Fprintf(w, "ogsf incorporated into %s\n", root)
	fmt.Fprintf(w, "  stamped: %d file(s)\n", len(r.Stamped))
	for _, s := range r.Stamped {
		fmt.Fprintf(w, "    + %s\n", s)
	}
	if len(r.Skipped) > 0 {
		fmt.Fprintf(w, "  skipped (already exist, use --force to overwrite): %d\n", len(r.Skipped))
	}
	fmt.Fprintln(w, "\nnext steps:")
	fmt.Fprintln(w, "  1. cp .env.sample .env      # then set the key(s) your roster needs")
	fmt.Fprintln(w, "  2. ogsf demo                # every set piece, scripted: no tokens, no changes here")
	fmt.Fprintln(w, "  3. ogsf ask \"say hello\" --player ranger   # one real, cheap match")
	fmt.Fprintln(w, "  4. ogsf matches             # what just happened")
	fmt.Fprintln(w, "  5. ogsf var                 # Matchday Live on http://127.0.0.1:4600")
}

// Onboard writes the club config with the fleet's defaults.
func Onboard(root string, force bool) (string, error) {
	dest := filepath.Join(root, "set_pieces", "boardroom", "club.config.yaml")
	if _, err := os.Stat(dest); err == nil && !force {
		return "", fmt.Errorf("%s already exists — use --force to overwrite", dest)
	}
	data, err := templates.FS.ReadFile("set_pieces/boardroom/club.config.yaml")
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return "", err
	}
	return dest, os.WriteFile(dest, data, 0o644)
}
