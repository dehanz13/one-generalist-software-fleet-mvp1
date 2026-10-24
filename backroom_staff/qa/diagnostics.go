package qa

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// Diagnostics counts each problem identity, `file|rule|message`, so a second
// copy of an existing problem is a new problem. (Legacy: Counter[str].)
type Diagnostics map[string]int

// Total is the number of problems.
func (d Diagnostics) Total() int {
	n := 0
	for _, c := range d {
		n += c
	}
	return n
}

// Elements lists every identity once per occurrence, sorted, like
// Counter.elements() with a stable order.
func (d Diagnostics) Elements() []string {
	keys := make([]string, 0, len(d))
	for k := range d {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out []string
	for _, k := range keys {
		for i := 0; i < d[k]; i++ {
			out = append(out, k)
		}
	}
	return out
}

var (
	eslintError = regexp.MustCompile(`^\s*\d+:\d+\s+error\s+(.+?)\s{2,}(\S+)\s*$`)
	tscError    = regexp.MustCompile(`^(.+?)\(\d+,\d+\): error (TS\d+): (.+)$`)
)

// Parsers are the output formats the progressive gate can read.
var Parsers = []string{"eslint", "tsc"}

// ParseDiagnostics reads a check's COMPLETE output (the tail handed to the
// builder cannot measure a large repo). It refuses an unfamiliar failure
// format: a crash must never be counted as zero errors.
func ParseDiagnostics(parser, output string, passed bool) (Diagnostics, error) {
	if parser != "eslint" && parser != "tsc" {
		return nil, fmt.Errorf("no diagnostic parser for %s", parser)
	}
	if passed {
		return Diagnostics{}, nil
	}
	found := Diagnostics{}
	file := ""
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if parser == "eslint" {
			if (strings.HasPrefix(line, "/") || strings.HasPrefix(line, "./")) && !strings.HasPrefix(line, "//") {
				file = strings.TrimSpace(line)
			}
			if m := eslintError.FindStringSubmatch(line); m != nil && file != "" {
				found[file+"|"+m[2]+"|"+strings.TrimSpace(m[1])]++
			}
			continue
		}
		if m := tscError.FindStringSubmatch(line); m != nil {
			found[m[1]+"|"+m[2]+"|"+strings.TrimSpace(m[3])]++
		}
	}
	if len(found) == 0 {
		return nil, fmt.Errorf("%s failed but no diagnostics could be parsed", parser)
	}
	return found, nil
}

// NewDiagnostics are the identities in current beyond the baseline,
// extra duplicate occurrences included (Counter subtraction).
func NewDiagnostics(current, baseline Diagnostics) Diagnostics {
	added := Diagnostics{}
	for k, n := range current {
		if extra := n - baseline[k]; extra > 0 {
			added[k] = extra
		}
	}
	return added
}

// CapturedOutputText turns whatever a command left behind into text: bytes
// are decoded with each invalid byte replaced (U+FFFD), text passes through,
// nothing becomes "". (Legacy: quality_subprocess.captured_output_text, which
// existed because a Python timeout could hand back bytes.)
func CapturedOutputText(output any) string {
	switch v := output.(type) {
	case nil:
		return ""
	case string:
		return v
	case []byte:
		var b strings.Builder
		for len(v) > 0 {
			r, size := utf8.DecodeRune(v)
			if r == utf8.RuneError && size <= 1 {
				b.WriteRune(utf8.RuneError)
				v = v[1:]
				continue
			}
			b.WriteRune(r)
			v = v[size:]
		}
		return b.String()
	}
	return fmt.Sprint(output)
}
