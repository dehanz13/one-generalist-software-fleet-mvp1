package spectools

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// TypeSpecDir is where `ogsf spec-types` writes its quests.
const TypeSpecDir = "specs/beta-18-quests"

// ts4111Row is one TS4111 diagnostic, as clubhouse/spec_tools/ts4111_sources.cjs writes it.
type ts4111Row struct {
	File      string  `json:"file"`
	Prop      string  `json:"prop"`
	Type      string  `json:"type"`
	Source    *string `json:"source"`
	Root      string  `json:"root"`
	RootText  string  `json:"rootText"`
	RootFile  string  `json:"rootFile"`
	RootStart int     `json:"rootStart"`
	Write     bool    `json:"write"`
}

func (x ts4111Row) source() string {
	if x.Source == nil {
		return ""
	}
	return *x.Source
}

// srcFile is the file a read's loose type is written in.
func (x ts4111Row) srcFile() string {
	s := x.source()
	if s == "" {
		s = x.Root
	}
	if i := strings.LastIndex(s, ":"); i >= 0 {
		return s[:i]
	}
	return s
}

// UncheckedFieldsHelper is the helper type a typed-records quest creates
// when the repository does not have it yet.
const UncheckedFieldsHelper = `/**
 * A value that came from outside (a request body, a stored row, a parsed
 * file) and has not been checked yet, with the fields this code is about
 * to read off it named.
 *
 * Every field is optional and ` + "`unknown`" + `: naming a field promises nothing
 * about it, so each read still has to be narrowed before it is used. What
 * the names buy is that a field read with a dot is one that was declared,
 * and a misspelt one is an error.
 */
export type UncheckedFields<Field extends string> = {
  readonly [Name in Field]?: unknown;
};
`

const countedCheck = `      count() { perl -0ne 'my $n = () = /%s/g; print $n' ; }
      status=0; n=0
      for f in %s; do
        n=$((n+1))
        b=$(git show "$base:$f" | count); a=$(count < "$f")
        [ "$a" -le "$b" ] || { echo "$f: %s went $b -> $a"; status=1; }
      done
      echo "examined $n files"; exit $status`

const (
	literalKeyPattern = `\[\s*["\x27][A-Za-z_\$][\w\$]*["\x27]\s*\]`
	anyPattern        = `(?::\s*any\b|\bas\s+any\b|<any>|\bany\[\]|\@ts-ignore|\@ts-expect-error|\@ts-nocheck|eslint-disable|as\s+unknown\s+as)`
)

const typesUsage = "ogsf spec-types --src SRC --name NAME --label LABEL [--pilot] paths [paths ...]"

// TypeSpec writes the spec for one group of the typed-records quests, from
// the measurement ts4111_sources.cjs wrote:
//
//	node set_pieces/clubhouse/spec_tools/ts4111_sources.cjs /tmp/src.json
//	ogsf spec-types --src /tmp/src.json --name <slug> --label "group N" <dir-or-file> ...
//
// The rule and the contract are the same for every group; the measured
// table is the group's own.
func TypeSpec(argv []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(argv, []string{"src", "name", "label"}, []string{"pilot"})
	if err == nil {
		err = a.require("src", "name", "label")
	}
	if err == nil && len(a.positionals) == 0 {
		err = fmt.Errorf("the following arguments are required: paths")
	}
	if err != nil {
		return usageError(stderr, typesUsage, err)
	}
	paths := a.positionals

	data, err := os.ReadFile(a.values["src"])
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	var all []ts4111Row
	if err := json.Unmarshal(data, &all); err != nil {
		fmt.Fprintln(stderr, "src:", err)
		return 1
	}
	inScope := func(f string) bool {
		for _, p := range paths {
			if f == p || strings.HasPrefix(f, strings.TrimRight(p, "/")+"/") {
				return true
			}
		}
		return false
	}
	var rows []ts4111Row
	for _, x := range all {
		if !strings.Contains(x.Type, "DOMStringMap") && inScope(x.File) {
			rows = append(rows, x)
		}
	}
	if len(rows) == 0 {
		fmt.Fprintln(stderr, "nothing to do in "+strings.Join(paths, ", "))
		return 1
	}

	fileSet := map[string]bool{}
	for _, x := range rows {
		fileSet[x.File] = true
	}
	files := sortedKeys(fileSet)

	// Sources written in another file of this repository: a helper whose
	// return type or field is the loose one.
	var outsideKeys []string
	outside := map[string][]ts4111Row{}
	for _, x := range rows {
		f := x.srcFile()
		if f != x.File && !strings.HasPrefix(f, "node_modules") && f != "?" {
			key := x.source()
			if _, seen := outside[key]; !seen {
				outsideKeys = append(outsideKeys, key)
			}
			outside[key] = append(outside[key], x)
		}
	}
	sourceSet := map[string]bool{}
	for _, k := range outsideKeys {
		f := k
		if i := strings.LastIndex(k, ":"); i >= 0 {
			f = k[:i]
		}
		if !fileSet[f] {
			sourceSet[f] = true
		}
	}
	sourceFiles := sortedKeys(sourceSet)

	slug := "typed-records-" + a.values["name"]
	spec := TypeSpecDir + "/" + slug + ".md"
	frag := "changelog/unreleased/" + slug + ".md"
	_, _, code := run(".", nil, "git", "cat-file", "-e", "HEAD:lib/unchecked-fields.ts")
	helperExists := code == 0
	q := quoteAll(files)

	type declKey struct {
		file  string
		start int
	}
	byFile := map[string][]declKey{}
	decls := map[string]map[declKey][]ts4111Row{}
	for _, x := range rows {
		if decls[x.File] == nil {
			decls[x.File] = map[declKey][]ts4111Row{}
		}
		key := declKey{x.RootFile, x.RootStart}
		if _, seen := decls[x.File][key]; !seen {
			byFile[x.File] = append(byFile[x.File], key)
		}
		decls[x.File][key] = append(decls[x.File][key], x)
	}
	var table []string
	for _, f := range files {
		keys := append([]declKey(nil), byFile[f]...)
		n := 0
		for _, k := range keys {
			n += len(decls[f][k])
		}
		table = append(table, fmt.Sprintf("\n### `%s` (%d errors, %d declarations)\n", f, n, len(keys)))
		sort.SliceStable(keys, func(i, j int) bool { return decls[f][keys[i]][0].Root < decls[f][keys[j]][0].Root })
		for _, k := range keys {
			xs := decls[f][k]
			propSet := map[string]bool{}
			kind := "read"
			for _, x := range xs {
				propSet[x.Prop] = true
				if x.Write {
					kind = "written to"
				}
			}
			var props []string
			for _, p := range sortedKeys(propSet) {
				props = append(props, "`"+p+"`")
			}
			rootParts := strings.Split(xs[0].Root, ":")
			src := strings.ReplaceAll(pyHead(xs[0].Type, 70), "|", `\|`)
			table = append(table, fmt.Sprintf("- line %s, %s, %d errors, typed `%s`: `%s`\n  fields: %s",
				rootParts[len(rootParts)-1], kind, len(xs), src, pyHead(xs[0].RootText, 90), strings.Join(props, ", ")))
		}
	}

	// `writes` entries are fnmatch patterns: a path under a folder like
	// `[code]` does not match itself unless its brackets are escaped. Group
	// 2's first run was refused three times for this and for nothing else.
	for _, f := range append(append([]string(nil), files...), sourceFiles...) {
		if !Fnmatch(f, GlobEscape(f)) {
			fmt.Fprintf(stderr, "AssertionError: %s\n", f)
			return 1
		}
	}
	writeList := append(append([]string(nil), files...), sourceFiles...)
	if !helperExists {
		writeList = append(writeList, "lib/unchecked-fields.ts")
	}
	writeList = append(writeList, frag)
	var writes []string
	for _, f := range writeList {
		writes = append(writes, "  - "+GlobEscape(f))
	}

	base := "      base=$(git log --diff-filter=A --format=%H -1 -- " + spec + ")\n"
	check3 := fmt.Sprintf(countedCheck, literalKeyPattern, q, "bracket reads with a literal key")
	check4 := fmt.Sprintf(countedCheck, anyPattern, q, "any, suppressions and double casts")
	helperNote := "Create `lib/unchecked-fields.ts` with exactly this content:"
	helperBlock := "```ts\n" + UncheckedFieldsHelper + "```"
	if helperExists {
		helperNote, helperBlock = "The helper file already exists; do not change it.", ""
	}

	sourcesText := ""
	if len(outsideKeys) > 0 {
		lines := []string{
			"\n## Sources in other files: fix these where they are\n",
			"These reads take their type from a helper in another file of this repository. The file is in `writes`. Change the type there, once (a generic parameter that names the fields, a real return type), and the reads below need no cast. The emit check covers the helper's file too.\n",
			"Other files call these helpers and are not in this quest. They must go on compiling exactly as they do today: no new error anywhere, of any kind (the official review compares error identities). So a call that names no fields has to keep the type it has now. A type parameter with a default, or an overload, does that; changing the return type outright does not.\n",
		}
		keys := append([]string(nil), outsideKeys...)
		sort.SliceStable(keys, func(i, j int) bool { return len(outside[keys[i]]) > len(outside[keys[j]]) })
		for _, k := range keys {
			xs := outside[k]
			userSet := map[string]bool{}
			for _, x := range xs {
				userSet[x.File] = true
			}
			users := sortedKeys(userSet)
			shown, more := users, ""
			if len(users) > 6 {
				shown, more = users[:6], ", …"
			}
			lines = append(lines, fmt.Sprintf("- `%s`: %d errors in %d files of this group (%s%s)",
				k, len(xs), len(users), backticked(shown), more))
		}
		sourcesText = strings.Join(lines, "\n") + "\n"
	}

	pilot := ""
	if a.bools["pilot"] {
		pilot = ", the pilot"
	}
	out := fill(template("type_spec.tmpl"), map[string]string{
		"n_files": strconv.Itoa(len(files)), "label": a.values["label"], "pilot": pilot,
		"q": q, "writes": strings.Join(writes, "\n"), "base": base,
		"emit_files": quoteAll(append(append([]string(nil), files...), sourceFiles...)),
		"check3":     check3, "check4": check4, "spec": spec, "slug": slug,
		"n_rows": strconv.Itoa(len(rows)), "helper_note": helperNote, "helper_block": helperBlock,
		"table_text": strings.Join(table, "\n"), "sources_text": sourcesText, "frag": frag,
	})
	if err := os.MkdirAll(filepath.Dir(spec), 0o755); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if err := os.WriteFile(spec, []byte(out), 0o644); err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintln(stdout, spec, len(files), "files", len(rows), "errors", "| helper exists:", pyBool(helperExists))
	return 0
}

func sortedKeys(set map[string]bool) []string {
	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// pyBool prints a boolean as Python does.
func pyBool(b bool) string {
	if b {
		return "True"
	}
	return "False"
}
