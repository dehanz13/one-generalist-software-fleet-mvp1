package spectools

import (
	"fmt"
	"io"
	"regexp"
	"strings"
)

// The shapes a review has found weakening before. Go's regexp has no
// lookahead or backreference, so the three legacy patterns that used one are
// re-expressed: a quote-matched string is spelled out once per quote
// character, and `data-(?!hp=)` becomes "match, then refuse the attribute
// `hp`" (shape_test.go holds each one to lines it must and must not find).
var (
	shapePositionTaken  = regexp.MustCompile(`querySelectorAll\([^)]*\)\s*\[\d+\]|firstElementChild|lastElementChild|\.children\[\d+\]|childNodes\[\d+\]`)
	shapePositionKept   = regexp.MustCompile(`firstElementChild|lastElementChild|children\[|querySelectorAll`)
	shapeTagAttribute   = regexp.MustCompile(`querySelector(All)?(<[^>]*>)?\(\s*[\x60'"][a-z][a-z0-9]*\[`)
	shapeScoped         = regexp.MustCompile(`querySelector(All)?(<[^>]*>)?\(\s*[\x60'"][^\x60'"]*\s+\[`)
	shapeAria           = regexp.MustCompile(`querySelector(?:All)?(?:<[^>]*>)?\(\s*(?:\x60[^\x60]*\[aria-|'[^']*\[aria-|"[^"]*\[aria-)`)
	shapeAlternatives   = regexp.MustCompile(`querySelector(?:All)?(?:<[^>]*>)?\(\s*(?:\x60[^\x60]*,[^\x60]*\x60|'[^']*,[^']*'|"[^"]*,[^"]*")`)
	shapeTestID         = regexp.MustCompile(`data-testid=`)
	shapeHook           = regexp.MustCompile(`querySelector(?:All)?(?:<[^>]*>)?\(\s*[\x60'"]\[data-hp=["']?([\w-]+)["']?\][^\x60'"]*[\x60'"]`)
	shapeDataAttribute  = regexp.MustCompile(`querySelector(?:All)?(?:<[^>]*>)?\(\s*[\x60'"]\[data-([\w-]+)=`)
	shapeSelectorString = regexp.MustCompile(`querySelector(All)?(<[^>]*>)?\(\s*[\x60'"]([^\x60'"]+)[\x60'"]`)
	shapeSpaceBetween   = regexp.MustCompile(`\S\s+\S`)
	shapeTagBracket     = regexp.MustCompile(`[a-z]\[`)

	shapeZeroValue     = regexp.MustCompile(`toHaveValue\(\s*0\s*\)`)
	shapeNotChecked    = regexp.MustCompile(`\.not\s*\.toBe(Checked|PartiallyChecked)\(`)
	shapeEmptyCamel    = regexp.MustCompile(`toHaveStyle\(\{\s*[a-z]+[A-Z]\w*:\s*""`)
	shapeStyleMatcher  = regexp.MustCompile(`toHaveStyle\(\{[^}]*expect\.`)
	shapeParent        = regexp.MustCompile(`parentElement|parentNode`)
	shapeTextSelector  = regexp.MustCompile(`By(Text|LabelText|Title|AltText)\([^)]*selector:`)
	shapeTextFunction  = regexp.MustCompile(`By(Text|LabelText|Title|AltText)\(\s*\(`)
	shapeMarkup        = regexp.MustCompile(`innerHTML|outerHTML|toContainHTML`)
	shapeNullish       = regexp.MustCompile(`\?\?\s*null`)
	shapeToHaveClass   = regexp.MustCompile(`toHaveClass\(`)
	shapeClassEquality = regexp.MustCompile(`className\)?\s*\)?\.(toBe|toEqual)\(`)
	shapeAnySelector   = regexp.MustCompile(`querySelector(All)?\(`)
	shapeRoleQuery     = regexp.MustCompile(`(get|query|find)(All)?ByRole\(`)
	shapeHiddenTrue    = regexp.MustCompile(`hidden:\s*true`)
	shapeBareTag       = regexp.MustCompile(`querySelector(All)?(<[^>]*>)?\(\s*[\x60'"][a-z][a-z0-9]*[\x60'"]\s*\)`)
	shapeAnchorByTag   = regexp.MustCompile(`closest\(\s*["'\x60]a["'\x60]\s*\)|querySelectorAll?\(\s*["'\x60]a["'\x60]\s*\)`)
	shapeLinkByRole    = regexp.MustCompile(`ByRole\(\s*["']link`)
	shapeAnchoredMatch = regexp.MustCompile(`toMatch\(/\^`)
	shapeAnchor        = regexp.MustCompile(`/\^`)
)

// hunk is one hunk of a -U0 diff: its file and its removed and added lines,
// each stripped.
type hunk struct {
	file    string
	removed []string
	added   []string
}

// shapeHit is one place worth reading: the shape, the file's base name, the line.
type shapeHit struct {
	kind, file, text string
}

// parseHunks reads a `git diff -U0`, exactly as legacy did: a `+++ b/` line
// names the file, a `--- ` line is skipped, `@@` opens a hunk, and inside a
// hunk every `-` and `+` line is kept.
func parseHunks(diff string) []*hunk {
	var hunks []*hunk
	var file string
	var cur *hunk
	for _, line := range splitLines(diff) {
		switch {
		case strings.HasPrefix(line, "+++ b/"):
			file = line[6:]
			continue
		case strings.HasPrefix(line, "--- "):
			continue
		case strings.HasPrefix(line, "@@"):
			cur = &hunk{file: file}
			hunks = append(hunks, cur)
			continue
		}
		if cur == nil {
			continue
		}
		if strings.HasPrefix(line, "-") {
			cur.removed = append(cur.removed, strings.TrimSpace(line[1:]))
		} else if strings.HasPrefix(line, "+") {
			cur.added = append(cur.added, strings.TrimSpace(line[1:]))
		}
	}
	return hunks
}

// shapes lists every candidate in the hunks, in legacy's order.
func shapes(hunks []*hunk) []shapeHit {
	var hits []shapeHit
	for _, h := range hunks {
		parts := strings.Split(h.file, "/")
		base := parts[len(parts)-1]
		add := func(kind, text string) { hits = append(hits, shapeHit{kind, base, pyHead(text, 118)}) }
		rem := strings.Join(h.removed, "\n")
		added := strings.Join(h.added, "\n")
		has := func(text, sub string) bool { return strings.Contains(text, sub) }

		// G: positions, scoped/tag selectors, zero value
		for _, l := range h.removed {
			if shapePositionTaken.MatchString(l) && !shapePositionKept.MatchString(added) {
				add("position the original took", l)
			}
			if shapeTagAttribute.MatchString(l) && !has(added, "querySelector") {
				add("tag+attribute selector gone", l)
			}
			if shapeScoped.MatchString(l) && !has(added, "querySelector") {
				add("scoped selector gone", l)
			}
			// An element found by an ARIA attribute or by its id, with no such read in what replaced it.
			if shapeAria.MatchString(l) && !has(added, "querySelector") {
				add("a lookup by an ARIA attribute gone", l)
			}
			if has(l, "getElementById(") && !has(added, "getElementById(") {
				add("a read by id gone", l)
			}
			// A selector that lists alternatives, replaced by something that is not a selector.
			if shapeAlternatives.MatchString(l) && !has(added, "querySelector") {
				add("a selector with alternatives gone", l)
			}
			// A marker on a fixture the test hands in, dropped.
			if shapeTestID.MatchString(l) && !has(added, "data-testid") {
				add("a fixture's own marker dropped", l)
			}
			// A hook the original selected by, with no test id for it in what replaced it.
			for _, m := range shapeHook.FindAllStringSubmatch(l, -1) {
				testID := regexp.MustCompile(`TestId\(\s*[\x60'"]` + regexp.QuoteMeta(m[1]))
				if !testID.MatchString(added) && !has(added, "querySelector") {
					add("a hook lookup with no test id in its place", l)
				}
			}
			if dataAttributeNotHook(l) && !has(added, "querySelector") {
				add("a lookup by an element's own data attribute gone", l)
			}
			// A scope before a tag that carries the attribute: `tbody tr[data-you]`.
			if m := shapeSelectorString.FindStringSubmatch(l); m != nil &&
				shapeSpaceBetween.MatchString(m[3]) && shapeTagBracket.MatchString(m[3]) && !has(added, "querySelector") {
				add("scope before a tag with an attribute gone", l)
			}
		}
		for _, l := range h.added {
			if shapeZeroValue.MatchString(l) {
				add("toHaveValue(0)", l)
			}
			if shapeNotChecked.MatchString(l) {
				add(".not.toBeChecked() passes for a missing state", l)
			}
			// C
			if shapeEmptyCamel.MatchString(l) || shapeStyleMatcher.MatchString(l) {
				add("style assertion that may not fail", l)
			}
			// D
			if has(l, "toContainElement") && shapeParent.MatchString(rem) {
				add("toContainElement for parentElement", l)
			}
			// E
			if shapeTextSelector.MatchString(l) || shapeTextFunction.MatchString(l) {
				add("text query with selector/function", l)
			}
			if shapeMarkup.MatchString(l) && !shapeMarkup.MatchString(rem) {
				add("markup search", l)
			}
			// F
			if shapeNullish.MatchString(l) && !shapeNullish.MatchString(rem) {
				add("?? null added", l)
			}
			// B
			if shapeToHaveClass.MatchString(l) && shapeClassEquality.MatchString(rem) && !has(added, "exact") {
				add("className equality -> toHaveClass without exact", l)
			}
		}
		firstRemoved := ""
		if len(h.removed) > 0 {
			firstRemoved = h.removed[0]
		}
		firstRole := ""
		for _, l := range h.added {
			if has(l, "ByRole") {
				firstRole = l
				break
			}
		}
		// A: role query where a tag/attribute read was
		if shapeAnySelector.MatchString(rem) && shapeRoleQuery.MatchString(added) &&
			!shapeHiddenTrue.MatchString(added) && !has(added, "querySelector") {
			add("role query where a tag/attribute read was", firstRemoved+"  =>  "+firstRole)
		}
		// A read by a bare tag with a role query in its place. `hidden: true`
		// answers one difference (an element hidden from readers) and not the
		// other: a `<div role="button">` has the role and not the tag.
		if shapeBareTag.MatchString(rem) && shapeRoleQuery.MatchString(added) && !has(added, "querySelector") {
			add("a read by bare tag, a role in its place", firstRemoved+"  =>  "+firstRole)
		}
		if shapeAnchorByTag.MatchString(rem) && shapeLinkByRole.MatchString(added) {
			add("anchor by tag -> link by role", firstRemoved)
		}
		// H: anchors
		for _, l := range h.removed {
			if shapeAnchoredMatch.MatchString(l) && !shapeAnchor.MatchString(added) {
				add("anchored pattern lost its anchor", l)
			}
		}
	}
	return hits
}

// dataAttributeNotHook is legacy's `\[data-(?!hp=)([\w-]+)=`: a lookup by a
// data attribute other than the data-hp hook. Every match on the line is
// tried, because Python's search moved on past a hook to a later lookup.
func dataAttributeNotHook(line string) bool {
	for _, m := range shapeDataAttribute.FindAllStringSubmatch(line, -1) {
		if m[1] != "hp" {
			return true
		}
	}
	return false
}

// scanDiff prints the candidates in one diff text under a label.
func scanDiff(diff, label string, out io.Writer) {
	hits := shapes(parseHunks(diff))
	files := map[string]bool{}
	for _, h := range hits {
		files[h.file] = true
	}
	fmt.Fprintf(out, "== %s: %d candidates in %d files\n", label, len(hits), len(files))
	for _, h := range hits {
		fmt.Fprintf(out, "   [%s] %s: %s\n", h.kind, h.file, h.text)
	}
}

// ShapeSearch lists places in a diff of test files that have a shape a
// review has found weakening before. Candidates for reading, not findings.
// Run it over every open branch, and over merged quests, whenever a review
// names a shape nobody had tried:
//
//	ogsf shape-search "<label>=<base>...<branch>" ["<label>=<merge>^1..<merge>" ...]
//
// When a new shape is named, add its pattern here before searching.
func ShapeSearch(argv []string, stdout, stderr io.Writer) int {
	for _, arg := range argv {
		label, rng, ok := strings.Cut(arg, "=")
		if !ok {
			return usageError(stderr, `ogsf shape-search "<label>=<range>" ...`,
				fmt.Errorf("%q is not <label>=<range>", arg))
		}
		diff, _, _ := run(".", nil, "git", "diff", "-U0", rng, "--", "*.test.tsx", "*.test.ts")
		scanDiff(diff, label, stdout)
	}
	return 0
}

// splitLines is Python's str.splitlines(): it breaks on \n, \r\n, \r and the
// other Unicode line boundaries, and leaves no empty last line.
func splitLines(text string) []string {
	var lines []string
	start := 0
	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		switch runes[i] {
		case '\n', '\v', '\f', '\x1c', '\x1d', '\x1e', '\u0085', ' ', ' ':
			lines = append(lines, string(runes[start:i]))
			start = i + 1
		case '\r':
			lines = append(lines, string(runes[start:i]))
			if i+1 < len(runes) && runes[i+1] == '\n' {
				i++
			}
			start = i + 1
		}
	}
	if start < len(runes) {
		lines = append(lines, string(runes[start:]))
	}
	return lines
}
