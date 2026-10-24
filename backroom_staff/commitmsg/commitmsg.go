// Package commitmsg makes commit headers that always parse under
// @commitlint/config-conventional. (Legacy: adw_modules/commit_message.py.)
//
// Repos that enforce Conventional Commits reject anything that does not match
// a strict shape, and players do not reliably write conformant headers
// (missing type, sentence-case subject, trailing period). Every set piece that
// ships normalises the header defensively, so a match never fails on a
// formatting rule at its last step, after every official review passed. The
// enforced rules are the ones config-conventional leaves at `error`:
// type-enum/case/empty, scope-case (we emit `ogsf-<match>`), subject-empty,
// subject-case, subject-full-stop, and header-max-length 100. The body and
// footer are untouched.
package commitmsg

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ConventionalTypes are the types commitlint accepts.
var ConventionalTypes = map[string]bool{
	"feat": true, "fix": true, "docs": true, "chore": true, "refactor": true, "test": true,
	"perf": true, "build": true, "ci": true, "revert": true, "style": true,
}

var conventional = regexp.MustCompile(`^([a-z]+)(?:\([^)]+\))?!?: `)

// HeaderMaxLength is commitlint's header-max-length.
const HeaderMaxLength = 100

func lowercaseFirst(s string) string {
	if s == "" {
		return s
	}
	r, size := utf8.DecodeRuneInString(s)
	return string(unicode.ToLower(r)) + s[size:]
}

// normaliseSubject enforces subject-case (lower first letter) and
// subject-full-stop (strip trailing periods).
func normaliseSubject(subject string) string {
	s := lowercaseFirst(strings.TrimSpace(subject))
	for strings.HasSuffix(s, ".") {
		s = strings.TrimRightFunc(s[:len(s)-1], unicode.IsSpace)
	}
	return s
}

// HasBody is whether a message says more than its subject line.
func HasBody(message string) bool {
	subject, rest, _ := strings.Cut(strings.TrimSpace(message), "\n")
	return subject != "" && strings.TrimSpace(rest) != ""
}

// KeepTheFuller picks the message to commit when an iterate objective
// reports after the build. A quest's commit says what the whole quest did; a
// builder asked to fix one thing tends to report the one thing (a build once
// wrote four thousand characters about 13 files and its fix wrote "fix nav
// sheet test typecheck regression", and that line was committed). So a later
// message with a body wins; a later subject-only message is appended to the
// earlier one as its last paragraph instead of replacing it.
func KeepTheFuller(earlier, later string) string {
	earlier, later = strings.TrimSpace(earlier), strings.TrimSpace(later)
	if earlier == "" || HasBody(later) {
		if later != "" {
			return later
		}
		return earlier
	}
	if later == "" || !HasBody(earlier) {
		if later == "" {
			return earlier
		}
		return later
	}
	subject, _, _ := strings.Cut(later, "\n")
	return earlier + "\n\nAfter the quality gate reported a failure: " + strings.TrimSpace(subject)
}

// Normalise returns a message guaranteed to parse under config-conventional.
func Normalise(message, defaultType, matchID string) string {
	lines := splitLines(message)
	head := lines[0]
	rest := strings.Join(lines[1:], "\n")

	if m := conventional.FindStringSubmatchIndex(head); m != nil && ConventionalTypes[head[m[2]:m[3]]] {
		prefixEnd := m[1]
		subject := normaliseSubject(head[prefixEnd:])
		if subject == "" {
			subject = "ogsf commit"
		}
		head = head[:prefixEnd] + subject
	} else {
		subject := normaliseSubject(head)
		if subject == "" {
			subject = "ogsf run commit"
		}
		scope := "ogsf-" + firstN(matchID, 8)
		head = defaultType + "(" + scope + "): " + subject
	}
	if utf8.RuneCountInString(head) > HeaderMaxLength {
		head = strings.TrimRightFunc(string([]rune(head)[:HeaderMaxLength]), unicode.IsSpace)
	}
	if rest != "" {
		return head + "\n" + rest
	}
	return head
}

// splitLines is Python's str.splitlines() for \n, \r\n and \r, with legacy's
// `or [""]`: a trailing line break does not make an empty last line.
func splitLines(s string) []string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	lines := strings.Split(s, "\n")
	if len(lines) > 1 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func firstN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
