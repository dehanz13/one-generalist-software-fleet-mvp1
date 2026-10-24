// Package spectools holds the tools that measure a codebase first and write
// a quest spec from what they found, so the numbers in a spec are real, plus
// the two that review a test-rewriting quest after the fact:
//
//	ogsf spec-area     (legacy adws/adw_area_spec.py)   a Testing Library lint-cleanup quest
//	ogsf spec-types    (legacy adws/adw_type_spec.py)   a typed-records (TS4111) quest
//	ogsf fire-drill    (legacy adws/adw_break_review.py) break the code, see which tests notice
//	ogsf shape-search  (legacy adws/adw_shape_search.py) list diff shapes a review found weakening
//
// The spec texts are templates taken from the legacy f-strings by
// testdata/extract_templates.py, with the fleet's vocabulary applied
// (testdata/substitutions.json). The golden tests hold Go's output to the
// Python output under those same substitutions.
package spectools

import (
	"embed"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"sort"
	"strings"
)

//go:embed templates/*.tmpl
var templates embed.FS

// template returns an embedded spec template.
func template(name string) string {
	data, err := templates.ReadFile("templates/" + name)
	if err != nil {
		panic("spectools: missing template " + name)
	}
	return string(data)
}

// fill replaces each ⟦name⟧ in a template with its value.
func fill(text string, values map[string]string) string {
	pairs := make([]string, 0, 2*len(values))
	for name, value := range values {
		pairs = append(pairs, "⟦"+name+"⟧", value)
	}
	return strings.NewReplacer(pairs...).Replace(text)
}

// Counter is Python's collections.Counter as these tools use it: counts per
// key, remembering the order keys were first seen, so MostCommon breaks ties
// the way Python does (first seen first).
type Counter struct {
	keys   []string
	counts map[string]int
}

// NewCounter returns an empty counter.
func NewCounter() *Counter { return &Counter{counts: map[string]int{}} }

// CounterOf builds a counter from ordered pairs.
func CounterOf(pairs ...KV) *Counter {
	c := NewCounter()
	for _, p := range pairs {
		c.Add(p.Key, p.Count)
	}
	return c
}

// KV is one key and its count.
type KV struct {
	Key   string
	Count int
}

// Add adds n to key's count.
func (c *Counter) Add(key string, n int) {
	if c.counts == nil {
		c.counts = map[string]int{}
	}
	if _, seen := c.counts[key]; !seen {
		c.keys = append(c.keys, key)
	}
	c.counts[key] += n
}

// Update adds every count of another counter, in its order.
func (c *Counter) Update(other *Counter) {
	if other == nil {
		return
	}
	for _, key := range other.keys {
		c.Add(key, other.counts[key])
	}
}

// Get returns key's count.
func (c *Counter) Get(key string) int {
	if c == nil {
		return 0
	}
	return c.counts[key]
}

// Has reports whether key was ever added.
func (c *Counter) Has(key string) bool {
	if c == nil {
		return false
	}
	_, ok := c.counts[key]
	return ok
}

// Keys returns the keys in first-seen order.
func (c *Counter) Keys() []string {
	if c == nil {
		return nil
	}
	return append([]string(nil), c.keys...)
}

// Total is the sum of every count.
func (c *Counter) Total() int {
	if c == nil {
		return 0
	}
	total := 0
	for _, n := range c.counts {
		total += n
	}
	return total
}

// MostCommon returns every key by count, highest first, ties first-seen first.
func (c *Counter) MostCommon() []KV {
	if c == nil {
		return nil
	}
	out := make([]KV, 0, len(c.keys))
	for _, key := range c.keys {
		out = append(out, KV{key, c.counts[key]})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Count > out[j].Count })
	return out
}

// GlobEscape is Python's glob.escape: each of `*`, `?` and `[` is wrapped in
// brackets, so `app/r/[code]/x` becomes `app/r/[[]code]/x`, a pattern that
// matches the path itself and not `app/r/c/x`.
func GlobEscape(path string) string {
	var out strings.Builder
	for _, r := range path {
		switch r {
		case '*', '?', '[':
			out.WriteString("[" + string(r) + "]")
		default:
			out.WriteRune(r)
		}
	}
	return out.String()
}

// Fnmatch is Python's fnmatch.fnmatch on a POSIX system: `*` matches
// anything, `/` included; `?` one character; `[...]` a class, `[!...]` its
// complement; a `[` with no closing `]` is a literal bracket.
func Fnmatch(name, pattern string) bool {
	re, err := regexp.Compile(fnmatchRegexp(pattern))
	if err != nil {
		return false
	}
	return re.MatchString(name)
}

func fnmatchRegexp(pattern string) string {
	var out strings.Builder
	out.WriteString(`(?s)^`)
	runes := []rune(pattern)
	for i := 0; i < len(runes); {
		c := runes[i]
		i++
		switch c {
		case '*':
			out.WriteString(`.*`)
		case '?':
			out.WriteString(`.`)
		case '[':
			j := i
			if j < len(runes) && runes[j] == '!' {
				j++
			}
			if j < len(runes) && runes[j] == ']' {
				j++
			}
			for j < len(runes) && runes[j] != ']' {
				j++
			}
			if j >= len(runes) {
				out.WriteString(`\[`)
				continue
			}
			stuff := runes[i:j]
			i = j + 1
			negate := len(stuff) > 0 && stuff[0] == '!'
			if negate {
				stuff = stuff[1:]
			}
			if len(stuff) == 0 {
				if negate {
					out.WriteString(`.`) // "[!]" matches any one character
				} else {
					out.WriteString(`[^\x00-\x{10FFFF}]`) // "[]" never matches
				}
				continue
			}
			out.WriteString("[")
			if negate {
				out.WriteString("^")
			}
			for k, r := range stuff {
				switch {
				case r == '-' && k > 0 && k < len(stuff)-1:
					out.WriteRune('-') // a range
				case r == '\\' || r == ']' || r == '[' || r == '^' || r == '-':
					out.WriteString(`\` + string(r))
				default:
					out.WriteRune(r)
				}
			}
			out.WriteString("]")
		default:
			out.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	out.WriteString(`$`)
	return out.String()
}

// args is a small argparse: `--flag value`, `--flag=value` and boolean
// flags may come before, between or after positionals, as Python's did.
type args struct {
	values      map[string]string
	bools       map[string]bool
	positionals []string
}

// parseArgs reads argv against the named value flags and boolean flags.
func parseArgs(argv []string, valueFlags, boolFlags []string) (*args, error) {
	isValue := map[string]bool{}
	for _, f := range valueFlags {
		isValue[f] = true
	}
	isBool := map[string]bool{}
	for _, f := range boolFlags {
		isBool[f] = true
	}
	out := &args{values: map[string]string{}, bools: map[string]bool{}}
	for i := 0; i < len(argv); i++ {
		arg := argv[i]
		if arg == "--" {
			out.positionals = append(out.positionals, argv[i+1:]...)
			break
		}
		if !strings.HasPrefix(arg, "--") || arg == "--" {
			out.positionals = append(out.positionals, arg)
			continue
		}
		name, value, hasValue := strings.Cut(strings.TrimPrefix(arg, "--"), "=")
		switch {
		case isBool[name]:
			if hasValue {
				return nil, fmt.Errorf("--%s takes no value", name)
			}
			out.bools[name] = true
		case isValue[name]:
			if !hasValue {
				if i+1 >= len(argv) {
					return nil, fmt.Errorf("--%s needs a value", name)
				}
				i++
				value = argv[i]
			}
			out.values[name] = value
		default:
			return nil, fmt.Errorf("unknown flag --%s", name)
		}
	}
	return out, nil
}

// require checks that every named value flag was given.
func (a *args) require(names ...string) error {
	var missing []string
	for _, name := range names {
		if _, ok := a.values[name]; !ok {
			missing = append(missing, "--"+name)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("the following arguments are required: %s", strings.Join(missing, ", "))
	}
	return nil
}

// usageError prints a usage line and an error, argparse style, and returns 2.
func usageError(stderr io.Writer, usage string, err error) int {
	fmt.Fprintln(stderr, "usage: "+usage)
	fmt.Fprintln(stderr, "error: "+err.Error())
	return 2
}

// run executes a command and returns its stdout, stderr and exit code.
// A command that cannot start reports exit 127 with the reason as stderr.
func run(dir string, stdin io.Reader, name string, argv ...string) (string, string, int) {
	cmd := exec.Command(name, argv...)
	cmd.Dir = dir
	cmd.Stdin = stdin
	var stdout, stderr strings.Builder
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	if err == nil {
		return stdout.String(), stderr.String(), 0
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return stdout.String(), stderr.String(), exit.ExitCode()
	}
	return stdout.String(), err.Error(), 127
}

// pyHead is Python's text[:n]: the first n characters, never bytes.
func pyHead(text string, n int) string {
	runes := []rune(text)
	if len(runes) <= n {
		return text
	}
	return string(runes[:n])
}

// quoteAll wraps each item in single quotes and joins them with spaces, as
// the legacy specs build shell word lists.
func quoteAll(items []string) string {
	quoted := make([]string, len(items))
	for i, item := range items {
		quoted[i] = "'" + item + "'"
	}
	return strings.Join(quoted, " ")
}

// backticked wraps each item in backticks and joins them with ", ".
func backticked(items []string) string {
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = "`" + item + "`"
	}
	return strings.Join(out, ", ")
}
