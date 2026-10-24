package spectools

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeRunner stands in for `npx vitest` and `npx jest`. A test file is lines
// of `test <name> needs <text>`: the test passes while src/thing.ts holds
// the text. A file that starts with `crash` prints no JSON; one that starts
// with `empty` reports no tests. Every call is appended to $FAKE_LOG.
// fakeRunnerScript is testdata/fake_runner.sh.
func fakeRunnerScript(t *testing.T) string { return readFile(t, "testdata/fake_runner.sh") }

// drillRepo is a repository whose test file was rewritten after the base
// commit: the rewrite dropped the check on the label.
func drillRepo(t *testing.T) (repo, base string) {
	t.Helper()
	repo = newRepo(t, map[string]string{
		"src/thing.ts":      "export const answer = 42;\nexport const label = 'deep';\n",
		"src/thing.test.ts": "test answer needs 42\ntest label needs deep\n",
	})
	base = gitIn(t, repo, "rev-parse", "HEAD")
	writeFile(t, filepath.Join(repo, "src/thing.test.ts"), "test answer needs 42\n")
	gitIn(t, repo, "commit", "-qam", "rewrite the test")
	fakeOnPath(t, "npx", fakeRunnerScript(t))
	t.Setenv("FAKE_LOG", filepath.Join(t.TempDir(), "calls.log"))
	return repo, base
}

func batchFile(t *testing.T, yaml string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "breaks.yaml")
	writeFile(t, path, yaml)
	return path
}

func TestFireDrillVerdicts(t *testing.T) {
	pkgDir, _ := os.Getwd()
	repo, base := drillRepo(t)
	batch := batchFile(t, `breaks:
  - {label: label breaks, target: src/thing.ts, old: deep, new: shallow, test: src/thing.test.ts}
  - {label: answer breaks, target: src/thing.ts, old: "42", new: "41", test: src/thing.test.ts}
  - {label: harmless, target: src/thing.ts, old: "export const answer", new: "export  const answer", test: src/thing.test.ts}
  - {label: missing, target: src/thing.ts, old: nope, new: x, test: src/thing.test.ts}
`)
	t.Chdir(repo)
	before := readFile(t, "src/thing.ts")
	var stdout, stderr bytes.Buffer
	code := FireDrill([]string{"--base", base, batch}, &stdout, &stderr)
	// The legacy Python break review, run over the same repository and runner
	// by testdata/make_goldens.py, printed exactly this.
	want := readFile(t, filepath.Join(pkgDir, "testdata/golden/fire_drill.txt"))
	if stdout.String() != want {
		t.Fatalf("output:\n%s\nwant:\n%s\nstderr: %s", stdout.String(), want, stderr.String())
	}
	if code != 1 {
		t.Errorf("exit %d, want 1 for a WEAKER or an ABORT", code)
	}
	// Everything put back: the code, and no copy of the old test left behind.
	if got := readFile(t, "src/thing.ts"); got != before {
		t.Errorf("src/thing.ts was not restored: %q", got)
	}
	if _, err := os.Stat("src/orig.thing.test.ts"); !os.IsNotExist(err) {
		t.Errorf("the old copy was left behind")
	}
	if status := gitIn(t, repo, "status", "--porcelain"); status != "" {
		t.Errorf("the tree is not clean afterwards:\n%s", status)
	}
	calls := readFile(t, os.Getenv("FAKE_LOG"))
	if !strings.Contains(calls, "vitest run --project unit src/orig.thing.test.ts --reporter=json") ||
		!strings.Contains(calls, "vitest run --project unit src/thing.test.ts --reporter=json") {
		t.Errorf("the runner was not called as Vitest on both copies:\n%s", calls)
	}
}

func TestFireDrillPassesWhenEveryBreakIsCaughtAndRunsJestOnRequest(t *testing.T) {
	repo, base := drillRepo(t)
	batch := batchFile(t, `{"breaks": [{"label": "answer breaks", "target": "src/thing.ts", "old": "42", "new": "41", "test": "src/thing.test.ts"}]}`)
	jsonBatch := strings.TrimSuffix(batch, ".yaml") + ".json"
	if err := os.Rename(batch, jsonBatch); err != nil {
		t.Fatal(err)
	}
	t.Chdir(repo)
	var stdout, stderr bytes.Buffer
	if code := FireDrill([]string{jsonBatch, "--jest", "--base=" + base}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d\n%s%s", code, stdout.String(), stderr.String())
	}
	if !strings.HasSuffix(stdout.String(), "examined 1 breaks: 1 OK\n") {
		t.Errorf("output:\n%s", stdout.String())
	}
	calls := readFile(t, os.Getenv("FAKE_LOG"))
	if !strings.Contains(calls, "jest -c jest.config.mjs --runTestsByPath src/orig.thing.test.ts --json") {
		t.Errorf("--jest did not run Jest:\n%s", calls)
	}
}

func TestFireDrillRefusesADirtyTree(t *testing.T) {
	repo, base := drillRepo(t)
	writeFile(t, filepath.Join(repo, "src/thing.ts"), "edited\n")
	batch := batchFile(t, "breaks: []\n")
	t.Chdir(repo)
	var stdout, stderr bytes.Buffer
	if code := FireDrill([]string{"--base", base, batch}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit %d, want 2", code)
	}
	if !strings.HasPrefix(stdout.String(), "the working tree is not clean; commit or stash first") {
		t.Errorf("output: %s", stdout.String())
	}
	if got := readFile(t, "src/thing.ts"); got != "edited\n" {
		t.Errorf("a dirty tree was touched: %q", got)
	}
}

func TestFireDrillStopsWhenATestDidNotExistAtTheBase(t *testing.T) {
	repo, base := drillRepo(t)
	batch := batchFile(t, "breaks:\n  - {label: x, target: src/thing.ts, old: deep, new: y, test: src/new.test.ts}\n")
	t.Chdir(repo)
	var stdout, stderr bytes.Buffer
	if code := FireDrill([]string{"--base", base, batch}, &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "src/new.test.ts does not exist at "+base) {
		t.Errorf("stderr: %s", stderr.String())
	}
	if status := gitIn(t, repo, "status", "--porcelain"); status != "" {
		t.Errorf("the tree is not clean afterwards:\n%s", status)
	}
}

func TestFailingReportsARunnerThatGaveNoResult(t *testing.T) {
	repo, _ := drillRepo(t)
	writeFile(t, filepath.Join(repo, "crash.test.ts"), "crash\n")
	writeFile(t, filepath.Join(repo, "empty.test.ts"), "empty\n")
	t.Chdir(repo)
	d := &drill{repo: repo, restore: newRestorer()}
	if got := d.failing(filepath.Join(repo, "crash.test.ts")); len(got) != 1 ||
		!strings.HasPrefix(got[0], "<<no result: substring not found; Error: runner crashed") {
		t.Errorf("crash: %q", got)
	}
	if got := d.failing(filepath.Join(repo, "empty.test.ts")); len(got) != 1 || got[0] != "<<no tests ran>>" {
		t.Errorf("empty: %q", got)
	}
}

func TestTheRestorerPutsEveryFileBack(t *testing.T) {
	dir := t.TempDir()
	created := filepath.Join(dir, "orig.x.test.ts")
	changed := filepath.Join(dir, "x.ts")
	writeFile(t, created, "copy\n")
	writeFile(t, changed, "broken\n")
	original := "original\n"
	r := newRestorer()
	r.hold(created, nil)
	r.hold(changed, &original)
	r.hold(filepath.Join(dir, "never-written.snap"), nil)
	r.putBack()
	if _, err := os.Stat(created); !os.IsNotExist(err) {
		t.Errorf("a file that did not exist before was left")
	}
	if got := readFile(t, changed); got != original {
		t.Errorf("x.ts = %q", got)
	}
	r.putBack() // a second call has nothing left to do
}

func TestFireDrillNeedsABaseAndOneBatch(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := FireDrill([]string{"batch.yaml"}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit %d, want 2", code)
	}
	if code := FireDrill([]string{"--base", "HEAD"}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit %d, want 2", code)
	}
}
