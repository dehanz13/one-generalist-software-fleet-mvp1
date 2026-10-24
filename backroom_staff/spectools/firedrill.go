package spectools

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"

	"go.yaml.in/yaml/v3"
)

// Break is one planted defect: replace Old (which must occur exactly once in
// Target) with New, then run Test as it was at the base and as it is now.
type Break struct {
	Label  string `yaml:"label" json:"label"`   // what the break does, in words a person reads in the report
	Target string `yaml:"target" json:"target"` // the file to break, relative to the repository
	Old    string `yaml:"old" json:"old"`       // text that occurs exactly once in target
	New    string `yaml:"new" json:"new"`       // what replaces it
	Test   string `yaml:"test" json:"test"`     // the test file to run, relative to the repository
}

// Batch is a fire-drill file: `breaks: [{label, target, old, new, test}]`.
// (Legacy's batch was a Python module defining BREAKS; a Go binary cannot
// import one, so the batch is data now: YAML, or JSON.)
type Batch struct {
	Breaks []Break `yaml:"breaks" json:"breaks"`
}

// LoadBatch reads a YAML or JSON batch file.
func LoadBatch(path string) (*Batch, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var batch Batch
	if strings.HasSuffix(strings.ToLower(path), ".json") {
		err = json.Unmarshal(data, &batch)
	} else {
		err = yaml.Unmarshal(data, &batch)
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &batch, nil
}

// restorer puts every file it holds back the way it was, whatever ends the
// process. (Legacy: the _restore dict and _put_back.)
type restorer struct {
	mu    sync.Mutex
	order []string
	saved map[string]*string // path → original text, or nil for a file that did not exist
}

func newRestorer() *restorer { return &restorer{saved: map[string]*string{}} }

func (r *restorer) hold(path string, text *string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.saved[path]; !ok {
		r.order = append(r.order, path)
	}
	r.saved[path] = text
}

func (r *restorer) release(path string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.saved, path)
	for i, p := range r.order {
		if p == path {
			r.order = append(r.order[:i], r.order[i+1:]...)
			break
		}
	}
}

// putBack restores every held file, in the order they were taken.
func (r *restorer) putBack() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, path := range r.order {
		if text := r.saved[path]; text == nil {
			os.Remove(path)
		} else {
			os.WriteFile(path, []byte(*text), 0o644)
		}
		delete(r.saved, path)
	}
	r.order = nil
}

// drill is one fire drill against one repository.
type drill struct {
	repo    string
	jest    bool
	restore *restorer
	out     io.Writer
}

// oldCopy writes the test file as it was at base beside the current one,
// and returns its path. A prefix, not an infix: Jest picks its files up by
// `*.a11y.test.tsx`, and `x.a11y.orig.test.tsx` is a file it never runs.
func (d *drill) oldCopy(test, base string) (string, error) {
	path := filepath.Join(d.repo, test)
	copyPath := filepath.Join(filepath.Dir(path), "orig."+filepath.Base(path))
	shown, stderr, code := run(d.repo, nil, "git", "show", base+":"+test)
	if code != 0 {
		return "", fmt.Errorf("%s does not exist at %s: %s", test, base, strings.TrimSpace(stderr))
	}
	d.restore.hold(copyPath, nil)
	// A test with snapshots writes a fresh one for the copy; it goes with it.
	d.restore.hold(filepath.Join(filepath.Dir(copyPath), "__snapshots__", filepath.Base(copyPath)+".snap"), nil)
	return copyPath, os.WriteFile(copyPath, []byte(shown), 0o644)
}

// failing returns the titles of the tests in a file that do not pass, or one
// marker when none ran.
func (d *drill) failing(test string) []string {
	rel, err := filepath.Rel(d.repo, test)
	if err != nil {
		rel = test
	}
	argv := []string{"vitest", "run", "--project", "unit", rel, "--reporter=json"}
	if d.jest {
		argv = []string{"jest", "-c", "jest.config.mjs", "--runTestsByPath", rel, "--json"}
	}
	stdout, stderr, _ := run(d.repo, nil, "npx", argv...)
	var data struct {
		TestResults *[]struct {
			AssertionResults []struct {
				Title  string `json:"title"`
				Status string `json:"status"`
			} `json:"assertionResults"`
		} `json:"testResults"`
	}
	start := strings.Index(stdout, "{")
	if start < 0 {
		return []string{fmt.Sprintf("<<no result: substring not found; %s>>", pyTail(stderr, 200))}
	}
	if err := json.Unmarshal([]byte(stdout[start:]), &data); err != nil {
		return []string{fmt.Sprintf("<<no result: %v; %s>>", err, pyTail(stderr, 200))}
	}
	if data.TestResults == nil {
		return []string{fmt.Sprintf("<<no result: 'testResults'; %s>>", pyTail(stderr, 200))}
	}
	var titles []string
	ran := 0
	for _, suite := range *data.TestResults {
		for _, t := range suite.AssertionResults {
			ran++
			if t.Status != "passed" {
				titles = append(titles, t.Title)
			}
		}
	}
	if ran == 0 {
		return []string{"<<no tests ran>>"}
	}
	return titles
}

// one applies a single break, runs both copies of its test, and restores
// the target. It returns the verdict.
func (d *drill) one(b Break, copies map[string]string) string {
	path := filepath.Join(d.repo, b.Target)
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(d.out, "[%s] ABORT: %v\n", b.Label, err)
		return "ABORT"
	}
	source := string(data)
	if found := strings.Count(source, b.Old); found != 1 {
		fmt.Fprintf(d.out, "[%s] ABORT: the text to replace occurs %d times in %s\n", b.Label, found, b.Target)
		return "ABORT"
	}
	d.restore.hold(path, &source)
	var before, after []string
	func() {
		defer func() {
			os.WriteFile(path, []byte(source), 0o644)
			d.restore.release(path)
		}()
		if err := os.WriteFile(path, []byte(strings.Replace(source, b.Old, b.New, 1)), 0o644); err != nil {
			before = []string{"<<could not write the break: " + err.Error() + ">>"}
			return
		}
		before = d.failing(copies[b.Test])
		after = d.failing(filepath.Join(d.repo, b.Test))
	}()
	var missed, extra []string
	for _, t := range before {
		if !contains(after, t) {
			missed = append(missed, t)
		}
	}
	for _, t := range after {
		if !contains(before, t) {
			extra = append(extra, t)
		}
	}
	verdict := "OK"
	switch {
	case len(before) == 0 && len(after) == 0:
		verdict = "NEITHER"
	case len(missed) > 0:
		verdict = "WEAKER"
	}
	fmt.Fprintf(d.out, "[%s] %s: old fails %d, new fails %d\n", b.Label, verdict, len(before), len(after))
	for _, t := range missed {
		fmt.Fprintf(d.out, "    old-only: %s\n", t)
	}
	for _, t := range extra {
		fmt.Fprintf(d.out, "    new-only: %s\n", t)
	}
	return verdict
}

func contains(list []string, item string) bool {
	for _, x := range list {
		if x == item {
			return true
		}
	}
	return false
}

const fireDrillUsage = "ogsf fire-drill --base BASE [--jest] batch"

// FireDrill reviews a test-rewriting quest by breaking the code under test.
// A quest that rewrites assertions can pass every official review and still
// leave a test asserting less: the `expect(` is there, and it reads a
// different element than it did (matches fe8b82a0 and eac9e0eb, five tests
// each). For each break in the batch it applies the break, runs the test
// file as it was at --base and as it is now, reports every test the old
// file fails that the new one passes, and restores the code.
//
// Verdicts: OK (every test the old file fails, the new file fails too),
// WEAKER (the old file fails a test the new file passes: read it), NEITHER
// (no test in either file notices the break), ABORT (`old` does not occur
// exactly once; nothing was changed). WEAKER is a lead, not a finding.
//
// Run it when nothing else owns the working tree: it edits files in place
// and restores them, and a fleet match reading the tree meanwhile would see
// the break. Exit 1 on any WEAKER or ABORT, 2 on a dirty tree.
func FireDrill(argv []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(argv, []string{"base"}, []string{"jest"})
	if err == nil {
		err = a.require("base")
	}
	if err == nil && len(a.positionals) != 1 {
		err = fmt.Errorf("give exactly one batch file")
	}
	if err != nil {
		return usageError(stderr, fireDrillUsage, err)
	}
	batch, err := LoadBatch(a.positionals[0])
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	repo := repoRoot()

	dirty, _, _ := run(repo, nil, "git", "status", "--porcelain")
	if strings.TrimSpace(dirty) != "" {
		fmt.Fprintln(stdout, "the working tree is not clean; commit or stash first, so a restore cannot lose anything:\n"+dirty)
		return 2
	}

	d := &drill{repo: repo, jest: a.bools["jest"], restore: newRestorer(), out: stdout}
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGPIPE)
	done := make(chan struct{})
	go func() {
		select {
		case sig := <-signals:
			d.restore.putBack()
			if s, ok := sig.(syscall.Signal); ok {
				os.Exit(128 + int(s))
			}
			os.Exit(1)
		case <-done:
		}
	}()
	defer func() {
		signal.Stop(signals)
		close(done)
		d.restore.putBack()
	}()

	tally := map[string]int{}
	copies := map[string]string{}
	for _, b := range batch.Breaks {
		if _, ok := copies[b.Test]; ok {
			continue
		}
		path, err := d.oldCopy(b.Test, a.values["base"])
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		copies[b.Test] = path
	}
	for _, b := range batch.Breaks {
		tally[d.one(b, copies)]++
	}
	verdicts := make([]string, 0, len(tally))
	for v := range tally {
		verdicts = append(verdicts, v)
	}
	sort.Strings(verdicts)
	var parts []string
	for _, v := range verdicts {
		parts = append(parts, fmt.Sprintf("%d %s", tally[v], v))
	}
	fmt.Fprintf(stdout, "examined %d breaks: %s\n", len(batch.Breaks), strings.Join(parts, ", "))
	if tally["WEAKER"] > 0 || tally["ABORT"] > 0 {
		return 1
	}
	return 0
}

// repoRoot is the git toplevel of the working directory, else the
// working directory itself.
func repoRoot() string {
	out, _, code := run(".", nil, "git", "rev-parse", "--show-toplevel")
	if code == 0 && strings.TrimSpace(out) != "" {
		return strings.TrimSpace(out)
	}
	wd, _ := os.Getwd()
	return wd
}

// pyTail is Python's text[-n:].
func pyTail(text string, n int) string {
	runes := []rune(text)
	if len(runes) <= n {
		return text
	}
	return string(runes[len(runes)-n:])
}
