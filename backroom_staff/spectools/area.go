package spectools

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// AreaSpecDir is where `ogsf spec-area` writes its quests.
const AreaSpecDir = "specs/beta-18-quests"

// NodeRules are the two rules that never have a fixer.
var NodeRules = []string{"testing-library/no-node-access", "testing-library/no-container"}

var (
	exactRe  = regexp.MustCompile(`\.textContent\s*\)\s*\.(?:toBe|toEqual|toStrictEqual)\(`)
	hookRe   = regexp.MustCompile("(?:querySelectorAll|querySelector|closest)(?:<[^>]*>)?\\(\\s*['\"`]\\[data-hp")
	testRe   = regexp.MustCompile(`\.test\.tsx?$`)
	caseRe   = regexp.MustCompile(`^\s*(it|test)(\.each)?\(`)
	envRe    = regexp.MustCompile(`@vitest-environment\s+(jsdom|happy-dom)`)
	ansiRe   = regexp.MustCompile(`\x1b\[[0-9;]*m`)
	vitestRe = regexp.MustCompile(`Tests\s+(.*)`)
	jestRe   = regexp.MustCompile(`(?m)^Tests:\s+(.*)$`)
)

// Site is one finding no fixer closes: its line, the rule's short name, and
// the line's text.
type Site struct {
	Line int
	Rule string
	Text string
}

// AreaRow is one test file, measured. (Legacy: the dicts measure() returned.)
type AreaRow struct {
	File    string
	Env     string // jsdom | node | Jest
	Errors  int
	Rules   *Counter // rule → errors now
	Left    *Counter // rule → errors left after `eslint --fix-dry-run`
	Broken  string   // the fixer's parse error, when it breaks the file
	Sites   []Site
	Exact   int // exact text comparisons the fixer would loosen
	Hooks   int // data-hp lookups
	Expects int // lines with `expect(`
	Cases   int // test cases
	Cleanup int // lines naming cleanup
}

// IsTestFile reports whether a path names a test file rather than a directory.
func IsTestFile(path string) bool {
	return testRe.MatchString(path)
}

// Pathspecs are git pathspecs for the scope. A directory names every test
// file under it. A test file names itself, and literally:
// `app/r/[code]/page.test.tsx` holds a character class as far as a glob is
// concerned, and a quest must not widen to `app/r/c/…` because of it.
func Pathspecs(paths []string) []string {
	var specs []string
	for _, p := range paths {
		if IsTestFile(p) {
			specs = append(specs, ":(literal)"+p)
		} else {
			base := strings.TrimRight(p, "/")
			specs = append(specs, base+"/*.test.ts", base+"/*.test.tsx")
		}
	}
	return specs
}

// WriteGlobs are the same scope as fnmatch patterns, which is what the
// contract's `writes` are read with.
func WriteGlobs(paths []string) []string {
	var globs []string
	for _, p := range paths {
		if IsTestFile(p) {
			globs = append(globs, GlobEscape(p))
		} else {
			base := GlobEscape(strings.TrimRight(p, "/"))
			globs = append(globs, base+"/*.test.ts", base+"/*.test.tsx")
		}
	}
	return globs
}

// Contract is the quest's ```ogsf block for a scope: the precondition, the
// writes, and every check a machine can hold the quest to.
func Contract(name string, prefixes []string, rows []AreaRow) string {
	specs := quoteAll(Pathspecs(prefixes))
	files := "git ls-files " + specs
	var jest []string
	for _, r := range rows {
		if r.Env == "Jest" {
			jest = append(jest, r.File)
		}
	}
	var writes []string
	for _, g := range WriteGlobs(prefixes) {
		writes = append(writes, "  - "+g)
	}
	jestCheck := ""
	if len(jest) > 0 {
		jestCheck = "  - name: the Jest-run files in scope pass\n" +
			"    run: |\n" +
			"      npx jest -c jest.config.mjs --runTestsByPath " + quoteAll(jest) + "\n"
	}
	return fill(template("area_contract.tmpl"), map[string]string{
		"files": files, "writes": strings.Join(writes, "\n"), "name": name,
		"specs": specs, "jest_check": jestCheck,
	})
}

// ruleShort is a rule's name after its plugin, as legacy's
// `rule.split("/")[1]`; a core rule has no plugin and keeps its name.
func ruleShort(rule string) string {
	parts := strings.Split(rule, "/")
	if len(parts) > 1 {
		return parts[1]
	}
	return rule
}

// Render writes the whole quest spec for a measured group.
func Render(name, label string, prefixes []string, rows []AreaRow, tests [2]string) string {
	total := 0
	var dirty, broken, jest, node []AreaRow
	rules := NewCounter()
	for _, r := range rows {
		total += r.Errors
		if r.Errors > 0 {
			dirty = append(dirty, r)
		}
		if r.Broken != "" {
			broken = append(broken, r)
		}
		rules.Update(r.Rules)
		if r.Env == "Jest" {
			jest = append(jest, r)
		}
		if r.Env == "node" {
			for _, k := range r.Rules.Keys() {
				if strings.HasPrefix(k, "jest-dom/") {
					node = append(node, r)
					break
				}
			}
		}
	}

	allFiles := true
	for _, p := range prefixes {
		if !IsTestFile(p) {
			allFiles = false
		}
	}
	var scope string
	if allFiles {
		// A scattered group names its files; listing them in every sentence
		// would bury the sentence, and the table below is the list.
		seen := map[string]bool{}
		var tops []string
		for _, p := range prefixes {
			top := strings.Split(p, "/")[0]
			if !seen[top] {
				seen[top] = true
				tops = append(tops, top)
			}
		}
		sort.Strings(tops)
		scope = fmt.Sprintf("the %d files listed below, under %s", len(prefixes), backticked(tops))
	} else {
		var trimmed []string
		for _, p := range prefixes {
			trimmed = append(trimmed, strings.TrimRight(p, "/"))
		}
		scope = backticked(trimmed)
	}

	outcome := func(r AreaRow) string {
		if r.Errors == 0 {
			return "clean already"
		}
		if r.Broken != "" {
			return fmt.Sprintf("**does not parse** (%s)", r.Broken)
		}
		left := r.Left.Total()
		if left == 0 {
			return "0"
		}
		var parts []string
		for _, kv := range r.Left.MostCommon() {
			parts = append(parts, fmt.Sprintf("%s %d", ruleShort(kv.Key), kv.Count))
		}
		return fmt.Sprintf("%d left: ", left) + strings.Join(parts, ", ")
	}

	var table []string
	for _, r := range rows {
		table = append(table, fmt.Sprintf("| `%s` | %s | %d | %s | %d / %d |",
			r.File, r.Env, r.Errors, outcome(r), r.Expects, r.Cases))
	}
	var sites []string
	for _, r := range rows {
		for _, s := range r.Sites {
			sites = append(sites, fmt.Sprintf("- `%s:%d` (%s): `%s`", r.File, s.Line, s.Rule, pyHead(s.Text, 110)))
		}
	}
	siteList := strings.Join(sites, "\n")
	if siteList == "" {
		siteList = "- None in this group."
	}
	var ruleParts []string
	for _, kv := range rules.MostCommon() {
		ruleParts = append(ruleParts, fmt.Sprintf("`%s` %d", kv.Key, kv.Count))
	}

	fileList := func(rs []AreaRow) string {
		var names []string
		for _, r := range rs {
			names = append(names, r.File)
		}
		return backticked(names)
	}
	brokenText := ""
	if len(broken) > 0 {
		which := "these files"
		if len(broken) == 1 {
			which = "this file"
		}
		brokenText = "\n**The fixer breaks " + which + ":** " + fileList(broken) +
			". Do not keep its output there. Restore the file (`git checkout -- <file>`) and convert the same " +
			"assertions by hand, to the matchers in the table under step 3.\n"
	}
	jestText := ""
	if len(jest) > 0 {
		verb, pronoun := "", "them"
		if len(jest) == 1 {
			verb, pronoun = "s", "it"
		}
		jestText = "\n**" + fileList(jest) + " run" + verb + " under Jest, not Vitest.** Run " +
			"`npx jest -c jest.config.mjs --runTestsByPath <file>` for " + pronoun +
			". `expect` comes from `@jest/globals` there and is typed `any`, so `tsc` will not catch a " +
			"misspelt matcher: run the file. Jest unmounts between tests by itself, so do not add " +
			"`cleanup` to a Jest-run file.\n"
	}
	nodeText := ""
	if len(node) > 0 {
		nodeText = "\n**" + fileList(node) + " run in the node environment.** The " +
			"matchers are registered only where a `document` exists, so a node file that calls one starts " +
			"with `import \"@testing-library/jest-dom/vitest\";`.\n"
	}

	return fill(template("area_render.tmpl"), map[string]string{
		"scope": scope, "label": label, "name": name,
		"contract":    Contract(name, prefixes, rows),
		"n_rows":      strconv.Itoa(len(rows)),
		"n_dirty":     strconv.Itoa(len(dirty)),
		"total":       strconv.Itoa(total),
		"rule_list":   strings.Join(ruleParts, ", "),
		"table":       strings.Join(table, "\n"),
		"tests0":      tests[0],
		"tests1":      tests[1],
		"broken_text": brokenText,
		"jest_text":   jestText,
		"node_text":   nodeText,
		"site_list":   siteList,
		"name_head":   strings.Split(name, "-")[0],
		"name_spaced": strings.ReplaceAll(name, "-", ", "),
	})
}

// ── measuring ───────────────────────────────────────────────────────────────

// eslintMessage is one finding in ESLint's JSON output.
type eslintMessage struct {
	RuleID   *string `json:"ruleId"`
	Severity int     `json:"severity"`
	Line     int     `json:"line"`
	Message  string  `json:"message"`
	Fatal    bool    `json:"fatal"`
}

type eslintResult struct {
	FilePath string          `json:"filePath"`
	Messages []eslintMessage `json:"messages"`
}

func (m eslintMessage) rule() string {
	if m.RuleID == nil {
		return "None" // what Python printed for a parse error's missing rule
	}
	return *m.RuleID
}

// testFiles lists the test files in scope, from git.
func testFiles(dir string, paths []string) ([]string, error) {
	out, stderr, code := run(dir, nil, "git", append([]string{"ls-files"}, Pathspecs(paths)...)...)
	if code != 0 {
		return nil, fmt.Errorf("git ls-files: %s", strings.TrimSpace(stderr))
	}
	var files []string
	for _, line := range strings.Split(out, "\n") {
		if line != "" {
			files = append(files, line)
		}
	}
	sort.Strings(files)
	return files, nil
}

// eslint runs ESLint over files and returns its results by repo-relative path.
func eslint(dir string, files []string, flags ...string) (map[string]eslintResult, error) {
	argv := append([]string{"eslint", "--no-warn-ignored", "--format", "json"}, flags...)
	argv = append(argv, files...)
	out, stderr, _ := run(dir, nil, "npx", argv...)
	var results []eslintResult
	if err := json.Unmarshal([]byte(out), &results); err != nil {
		return nil, fmt.Errorf("eslint did not answer with JSON: %v %s", err, strings.TrimSpace(stderr))
	}
	// ESLint reports absolute paths. The working directory can be reached
	// through a symlink (macOS's /var is /private/var), so both spellings of
	// the root are taken off, the longer first, since the other can be a
	// substring of it.
	root, _ := filepath.Abs(dir)
	roots := []string{root + "/"}
	if real, err := filepath.EvalSymlinks(root); err == nil && real != root {
		roots = append(roots, real+"/")
	}
	sort.Slice(roots, func(i, j int) bool { return len(roots[i]) > len(roots[j]) })
	byFile := map[string]eslintResult{}
	for _, r := range results {
		path := r.FilePath
		for _, prefix := range roots {
			path = strings.ReplaceAll(path, prefix, "")
		}
		byFile[path] = r
	}
	return byFile, nil
}

// withErrors keeps the files ESLint reports an error in, as they stand.
func withErrors(dir string, files []string) ([]string, error) {
	now, err := eslint(dir, files)
	if err != nil {
		return nil, err
	}
	var kept []string
	for _, f := range files {
		for _, m := range now[f].Messages {
			if m.Severity == 2 {
				kept = append(kept, f)
				break
			}
		}
	}
	return kept, nil
}

// environment is the runner a test file runs in.
func environment(path, source string) string {
	if strings.HasSuffix(path, ".a11y.test.tsx") {
		return "Jest"
	}
	if envRe.MatchString(pyHead(source, 800)) {
		return "jsdom"
	}
	return "node"
}

// passing returns the (Vitest summary, Jest summary) for files as they stand.
func passing(dir string, files []string) [2]string {
	var vitest, jest []string
	for _, f := range files {
		if strings.HasSuffix(f, ".a11y.test.tsx") {
			jest = append(jest, f)
		} else {
			vitest = append(vitest, f)
		}
	}
	v, j := "none in scope", "none in scope"
	if len(vitest) > 0 {
		out, _, _ := run(dir, nil, "npx", append([]string{"vitest", "run", "--project", "unit"}, vitest...)...)
		out = ansiRe.ReplaceAllString(out, "")
		if m := vitestRe.FindStringSubmatch(out); m != nil {
			v = strings.TrimSpace(m[1])
		} else {
			v = "COULD NOT READ THE VITEST SUMMARY"
		}
	}
	if len(jest) > 0 {
		out, stderr, _ := run(dir, nil, "npx", append([]string{"jest", "-c", "jest.config.mjs", "--runTestsByPath"}, jest...)...)
		if m := jestRe.FindStringSubmatch(out + stderr); m != nil {
			j = strings.TrimSpace(m[1])
		} else {
			j = "COULD NOT READ THE JEST SUMMARY"
		}
	}
	return [2]string{v, j}
}

// measure runs ESLint as the files are and with `--fix-dry-run`, and counts
// what the spec reports about each file.
func measure(dir string, files []string) ([]AreaRow, error) {
	now, err := eslint(dir, files)
	if err != nil {
		return nil, err
	}
	fixed, err := eslint(dir, files, "--fix-dry-run")
	if err != nil {
		return nil, err
	}
	var rows []AreaRow
	for _, f := range files {
		data, err := os.ReadFile(filepath.Join(dir, f))
		if err != nil {
			return nil, err
		}
		source := string(data)
		lines := splitLines(source)
		var messages []eslintMessage
		for _, m := range now[f].Messages {
			if m.Severity == 2 {
				messages = append(messages, m)
			}
		}
		after := fixed[f].Messages
		brokenMsg := ""
		for _, m := range after {
			if m.Fatal {
				brokenMsg = m.Message
				break
			}
		}
		rules := NewCounter()
		for _, m := range messages {
			rules.Add(m.rule(), 1)
		}
		left := NewCounter()
		for _, m := range after {
			if m.Severity == 2 && !m.Fatal {
				left.Add(m.rule(), 1)
			}
		}
		// A finding "no fixer closes": its rule came through the dry run with
		// every one of its findings still there. In a file the fixer breaks
		// the dry run says nothing useful, so fall back to the two rules that
		// never have a fixer.
		untouched := map[string]bool{}
		if brokenMsg != "" {
			for _, r := range NodeRules {
				untouched[r] = true
			}
		} else {
			for _, k := range rules.Keys() {
				if left.Get(k) >= rules.Get(k) {
					untouched[k] = true
				}
			}
		}
		row := AreaRow{File: f, Env: environment(f, source), Errors: len(messages), Rules: rules,
			Broken: brokenMsg, Left: left, Exact: len(exactRe.FindAllStringIndex(source, -1)),
			Hooks: len(hookRe.FindAllStringIndex(source, -1))}
		for _, m := range messages {
			if untouched[m.rule()] {
				text := ""
				if m.Line >= 1 && m.Line <= len(lines) {
					text = strings.TrimSpace(lines[m.Line-1])
				}
				row.Sites = append(row.Sites, Site{Line: m.Line, Rule: ruleShort(m.rule()), Text: text})
			}
		}
		for _, line := range lines {
			if strings.Contains(line, "expect(") {
				row.Expects++
			}
			if caseRe.MatchString(line) {
				row.Cases++
			}
			if strings.Contains(line, "cleanup") {
				row.Cleanup++
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

const areaUsage = "ogsf spec-area --name NAME --label LABEL [--only-with-errors] paths [paths ...]"

// AreaSpec writes the quest spec for a test-lint cleanup group, from
// measurements on the tree as it stands. A path may be a directory (every
// test file under it is in scope) or one test file. With
// --only-with-errors, only the test files under the paths that have a lint
// error today are kept, and each one is named in the contract.
func AreaSpec(argv []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(argv, []string{"name", "label"}, []string{"only-with-errors"})
	if err == nil {
		err = a.require("name", "label")
	}
	if err == nil && len(a.positionals) == 0 {
		err = fmt.Errorf("the following arguments are required: paths")
	}
	if err != nil {
		return usageError(stderr, areaUsage, err)
	}
	name, label, paths := a.values["name"], a.values["label"], a.positionals

	files, err := testFiles(".", paths)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if len(files) == 0 {
		fmt.Fprintln(stdout, "no test files under", pyList(paths))
		return 1
	}
	if a.bools["only-with-errors"] {
		examined := len(files)
		files, err = withErrors(".", files)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		fmt.Fprintf(stdout, "examined %d test files under %s: %d have a lint error and are in scope\n",
			examined, pyList(paths), len(files))
		if len(files) == 0 {
			return 1
		}
		paths = files
	}
	rows, err := measure(".", files)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	total, brokenCount, sitesCount := 0, 0, 0
	for _, r := range rows {
		total += r.Errors
		if r.Broken != "" {
			brokenCount++
		}
		sitesCount += len(r.Sites)
	}
	if total == 0 {
		fmt.Fprintf(stdout, "examined %d test files: 0 lint errors. Nothing to do; no spec written.\n", len(files))
		return 1
	}
	tests := passing(".", files)
	out := filepath.Join(AreaSpecDir, "testing-library-clean-"+name+".md")
	if err := os.MkdirAll(AreaSpecDir, 0o755); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := os.WriteFile(out, []byte(Render(name, label, paths, rows, tests)), 0o644); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintf(stdout, "wrote %s\n", out)
	fmt.Fprintf(stdout, "examined %d test files: %d lint errors, %d the fixer breaks, %d findings no fixer closes | Vitest %s | Jest %s\n",
		len(files), total, brokenCount, sitesCount, tests[0], tests[1])
	return 0
}

// pyList prints a list of strings the way Python prints one: ['a', 'b'].
func pyList(items []string) string {
	quoted := make([]string, len(items))
	for i, item := range items {
		quoted[i] = "'" + item + "'"
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}
