package spectools

// The whole commands, measuring included, against the Python originals'
// recorded output (testdata/make_goldens.py ran them over the same trees).

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixturePath(t *testing.T, rel string) string {
	t.Helper()
	abs, err := filepath.Abs(filepath.Join("testdata", rel))
	if err != nil {
		t.Fatal(err)
	}
	return abs
}

func TestAreaSpecCommandMatchesThePythonOriginal(t *testing.T) {
	for _, c := range []struct {
		name  string
		flags []string
	}{{"e2e", nil}, {"e2e-only-with-errors", []string{"--only-with-errors"}}} {
		t.Run(c.name, func(t *testing.T) {
			golden := fixturePath(t, "golden/area_spec_"+c.name)
			fake := readFile(t, fixturePath(t, "fake_npx.sh"))
			repo := newRepo(t, nil)
			copyTree(t, fixturePath(t, "area_repo"), repo)
			gitIn(t, repo, "add", "-A")
			gitIn(t, repo, "commit", "-q", "-m", "fixtures")
			fakeOnPath(t, "npx", fake)
			t.Chdir(repo)

			var stdout, stderr bytes.Buffer
			argv := append([]string{"--name", "home-a11y", "--label", "group 7"}, c.flags...)
			argv = append(argv, "components/home", "components/a11y")
			if code := AreaSpec(argv, &stdout, &stderr); code != 0 {
				t.Fatalf("exit %d\nstdout: %s\nstderr: %s", code, stdout.String(), stderr.String())
			}
			assertGolden(t, golden+".stdout", stdout.String())
			assertGolden(t, golden+".md", readFile(t, filepath.Join(repo, AreaSpecDir, "testing-library-clean-home-a11y.md")))
		})
	}
}

func TestAreaSpecRefusesAGroupWithNothingToDo(t *testing.T) {
	repo := newRepo(t, map[string]string{"components/ok/A.test.ts": "it('x', () => {});\n"})
	fakeOnPath(t, "npx", readFile(t, fixturePath(t, "fake_npx.sh")))
	t.Chdir(repo)
	var stdout, stderr bytes.Buffer
	if code := AreaSpec([]string{"--name", "ok", "--label", "g", "components/ok"}, &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if !strings.Contains(stdout.String(), "examined 1 test files: 0 lint errors. Nothing to do; no spec written.") {
		t.Fatalf("stdout: %s", stdout.String())
	}
	if _, err := os.Stat(filepath.Join(repo, AreaSpecDir)); err == nil {
		t.Fatalf("a spec folder was written for a group with nothing to do")
	}
	stdout.Reset()
	if code := AreaSpec([]string{"--name", "none", "--label", "g", "nowhere"}, &stdout, &stderr); code != 1 {
		t.Fatalf("exit %d, want 1", code)
	}
	if strings.TrimSpace(stdout.String()) != "no test files under ['nowhere']" {
		t.Fatalf("stdout: %q", stdout.String())
	}
}

func TestAreaSpecNeedsItsArguments(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := AreaSpec([]string{"--label", "g", "components"}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "--name") {
		t.Fatalf("stderr does not name the missing flag: %s", stderr.String())
	}
}

func TestTypeSpecMatchesThePythonOriginal(t *testing.T) {
	for _, c := range []struct {
		name   string
		helper bool
		pilot  bool
	}{{"no-helper", false, false}, {"helper-pilot", true, true}} {
		t.Run(c.name, func(t *testing.T) {
			files := map[string]string{"README.md": "x\n"}
			if c.helper {
				files["lib/unchecked-fields.ts"] = "export type UncheckedFields = never;\n"
			}
			repo := newRepo(t, files)
			src := readFile(t, fixturePath(t, "types_src.json"))
			golden := fixturePath(t, "golden/type_spec_"+c.name)
			writeFile(t, filepath.Join(repo, "src.json"), src)
			t.Chdir(repo)
			argv := []string{"--src", "src.json", "--name", "rooms-and-routes", "--label", "group 2"}
			if c.pilot {
				argv = append(argv, "--pilot")
			}
			argv = append(argv, "lib", "app")
			var stdout, stderr bytes.Buffer
			if code := TypeSpec(argv, &stdout, &stderr); code != 0 {
				t.Fatalf("exit %d: %s", code, stderr.String())
			}
			assertGolden(t, golden+".stdout", stdout.String())
			assertGolden(t, golden+".md", readFile(t, filepath.Join(repo, TypeSpecDir, "typed-records-rooms-and-routes.md")))
		})
	}
}

func TestTypeSpecSaysWhenThereIsNothingToDo(t *testing.T) {
	repo := newRepo(t, map[string]string{"README.md": "x\n"})
	writeFile(t, filepath.Join(repo, "src.json"), readFile(t, fixturePath(t, "types_src.json")))
	t.Chdir(repo)
	var stdout, stderr bytes.Buffer
	code := TypeSpec([]string{"--src", "src.json", "--name", "n", "--label", "l", "nowhere", "else"}, &stdout, &stderr)
	if code != 1 || strings.TrimSpace(stderr.String()) != "nothing to do in nowhere, else" {
		t.Fatalf("exit %d, stderr %q", code, stderr.String())
	}
}
