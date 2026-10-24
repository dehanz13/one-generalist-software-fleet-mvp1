// Package clubrules turns the project's club rules into the section every
// player's system prompt carries, because a rule a player is not told about
// is one it will "fix". (Legacy: adw_modules/project.py.)
//
// A rule is a CLAIM about the project, not a switch that changes it. Setting
// `rtl_cleanup: global` tells the players the setup file registers the
// cleanup; it does not register it.
//
// To add a rule: one field on boardroom.ClubRules, one entry in Instructions
// with a sentence per allowed value.
package clubrules

import (
	"fmt"
	"strings"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/boardroom"
)

// Instructions maps rule → value → what a player must do because of it.
// Imperative, and specific enough to act on without opening another file.
var Instructions = map[string]map[string]string{
	"rtl_cleanup": {
		"manual": "Testing Library cleanup is MANUAL in this project. Nothing unmounts " +
			"between tests on its own, so every test file that renders must call " +
			"`cleanup()` (usually `afterEach(cleanup)`, imported from " +
			"`@testing-library/react`). Keep every existing `cleanup()` call and add " +
			"one to any new test file that renders. The lint rule " +
			"`testing-library/no-manual-cleanup` is off on purpose: never re-enable " +
			"it, and never delete a cleanup call to satisfy a linter.",
		"global": "Testing Library cleanup is GLOBAL in this project: the test setup file " +
			"registers it for every test file. Do not add `cleanup()` calls to test " +
			"files, and remove the ones in files you touch. The lint rule " +
			"`testing-library/no-manual-cleanup` is on and must stay on.",
	},
}

// RuleOrder is the order rules are rendered in.
var RuleOrder = []string{"rtl_cleanup"}

// AllowedValues lists every value a rule accepts, taken from the config's own
// check, for the test that every value has an instruction.
var AllowedValues = map[string][]string{"rtl_cleanup": boardroom.RTLCleanupValues}

func value(rules boardroom.ClubRules, rule string) string {
	switch rule {
	case "rtl_cleanup":
		return rules.RTLCleanup
	}
	return ""
}

// SelectionInstruction is how a test finds an element here. The order is the
// same in every project; the test id attribute, and how it is switched on,
// are what differ.
func SelectionInstruction(attribute, testIDImport string) string {
	switchOn := ""
	if testIDImport != "" {
		switchOn = fmt.Sprintf(" A test file that calls `getByTestId` first imports "+
			"`%s` for its side effect, which is what makes "+
			"`%s` the test id in that file.", testIDImport, attribute)
	}
	return "Select an element by what it is, trying in this order: (1) its role with " +
		"its accessible name; (2) `within(...)` a role-bearing region that narrows " +
		"it; (3) the text a player reads; (4) last, `getByTestId`, where the test " +
		fmt.Sprintf("id is the `%s` attribute.%s Step 4 is for an element with ", attribute, switchOn) +
		"no role at all, or one of several that share a role with no name between " +
		"them, and the test says which in a comment beside the call. NEVER select " +
		"by position (`getAllByRole(...)[1]`, \"the second one\"): it passes lint " +
		"and names the wrong element after a reorder nobody would notice. Never " +
		"add a role or a name to a component only so that a test can find it."
}

// Text is the "Club rules" body for a player's system prompt. Every rule is
// rendered, defaults included: a player reading "(none)" must be able to
// trust that there really are none.
func Text(cfg *boardroom.Config) (string, error) {
	rules := cfg.Project.ClubRules
	var lines []string
	for _, rule := range RuleOrder {
		v := value(rules, rule)
		instruction, ok := Instructions[rule][v]
		if !ok {
			return "", fmt.Errorf("project.club_rules.%s: no instruction written for value %q. "+
				"Add it to backroom_staff/clubrules Instructions", rule, v)
		}
		lines = append(lines, fmt.Sprintf("- **%s: %s** — %s", rule, v, instruction))
	}
	lines = append(lines, fmt.Sprintf("- **test_id_attribute: %s** — %s",
		rules.TestIDAttribute, SelectionInstruction(rules.TestIDAttribute, rules.TestIDImport)))
	for _, note := range rules.Notes {
		if strings.TrimSpace(note) != "" {
			lines = append(lines, "- "+strings.TrimSpace(note))
		}
	}
	name := cfg.Project.Name
	if name == "" {
		name = "this repository"
	}
	return fmt.Sprintf("These hold for %s and override general habit:\n\n", name) + strings.Join(lines, "\n"), nil
}
