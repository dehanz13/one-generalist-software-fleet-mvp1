package demo

// The sample repository the tour plays in: "kickabout", a tiny scoreboard
// for five-a-side games. Its qa checks are small shell scripts that print
// exactly what ESLint and tsc print, so the progressive gate's parsers read
// them the way they read the real tools. Nothing here needs npm or a network.

var sampleFiles = map[string]string{
	"README.md": `# Kickabout

A tiny scoreboard for five-a-side games: add goals, show the score, serve it over HTTP.

    sh scripts/test.sh     # the unit checks
`,
	"src/score.ts": `export type Score = Record<string, number>;

/** Adds one goal for a team. */
export function addGoal(score: Score, team: string): Score {
  return { ...score, [team]: score[team] };
}

/** The team ahead, or null on a draw. */
export function leader(score: Score): string | null {
  const [first, second] = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!first || (second && second[1] === first[1])) return null;
  return first[0];
}
`,
	"src/scoreboard.ts": `import { leader } from "./score";

export function render(score: any): string {
  console.log("rendering", score);
  const lead = leader(score);
  console.log("leader", lead);
  const line = Object.entries(score).map(([team, goals]) => team + " " + goals).join(" · ");
  return lead ? line + " (" + lead + " lead)" : line;
}
`,
	"src/server.ts": `import { createServer } from "node:http";
import { render } from "./scoreboard";

const score = { Reds: 0, Blues: 0 };

export const server = createServer((req, res) => {
  if (req.url === "/score") {
    res.end(render(score));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});
`,
	"scripts/lint.sh": `#!/bin/sh
# A stand-in for ESLint: every console statement in src/ is an error,
# printed the way ESLint's stylish formatter prints one.
status=0
for f in src/*.ts; do
  hits=$(grep -n 'console\.' "$f" || true)
  [ -z "$hits" ] && continue
  echo "$(pwd)/$f"
  printf '%s\n' "$hits" | while IFS=: read -r line rest; do
    col=$(printf '%s' "$rest" | awk '{ print index($0, "console") }')
    printf '  %s:%s  error  Unexpected console statement  no-console\n' "$line" "$col"
  done
  status=1
done
[ $status -eq 0 ] && echo "no problems"
exit $status
`,
	"scripts/typecheck.sh": `#!/bin/sh
# A stand-in for tsc --noEmit: a parameter typed any is an error,
# printed the way tsc prints one.
status=0
for f in src/*.ts; do
  grep -n ': any' "$f" | while IFS=: read -r line rest; do
    printf "%s(%s,%s): error TS7006: Parameter implicitly has an 'any' type.\n" "$f" "$line" 17
  done
  grep -q ': any' "$f" && status=2
done
exit $status
`,
	"scripts/test.sh": `#!/bin/sh
# A stand-in for the unit suite: one check per behaviour, one line each.
pass=0; fail=0
check() { if eval "$2"; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }
check "addGoal adds one goal" "grep -q 'score\[team\] + 1' src/score.ts"
check "leader names the team ahead" "grep -q 'export function leader' src/score.ts"
check "/score answers" "grep -q '\"/score\"' src/server.ts"
if [ -f src/health.ts ]; then check "/health answers ok" "grep -q 'ok' src/health.ts"; fi
echo "Tests  $pass passed, $fail failed"
[ $fail -eq 0 ]
`,
	"scripts/build.sh": `#!/bin/sh
# A stand-in for the production build.
echo "built dist/ (4 files) in 0.4s"
`,
	"CHANGELOG.md": `# Changelog

## Unreleased
`,
}

// demoConfig is the shipped template with the scripted club and the
// sample's qa scripts.
const qaChecks = `qa:
  checks:
    - name: lint
      area: frontend
      operation: lint
      argv: [sh, scripts/lint.sh]
      timeout_seconds: 180
      diagnostics: eslint
    - name: typecheck
      area: frontend
      operation: typecheck
      argv: [sh, scripts/typecheck.sh]
      timeout_seconds: 300
      diagnostics: tsc
    - name: test
      area: frontend
      operation: test
      argv: [sh, scripts/test.sh]
      timeout_seconds: 1800
    - name: build
      area: frontend
      operation: build
      argv: [sh, scripts/build.sh]
      timeout_seconds: 600
`

// The quest the strict difficulty plays: clean the scoreboard's lint.
const lintQuest = "# Quest: a lint-clean scoreboard\n\n" +
	"The scoreboard prints debug lines with `console.log`, and `render` takes `any`.\n" +
	"Remove both without changing what `render` returns.\n\n" +
	"```ogsf\n" +
	"difficulty: run-mythic\n" +
	"precondition: |\n" +
	"  sh scripts/lint.sh > /dev/null; test $? -ne 0\n" +
	"writes:\n" +
	"  - src/scoreboard.ts\n" +
	"  - CHANGELOG.md\n" +
	"checks:\n" +
	"  - name: no console statement is left in the scoreboard\n" +
	"    run: \"! grep -n 'console\\\\.' src/scoreboard.ts\"\n" +
	"```\n"

// The quest that turns out to be done already: render already names the
// team ahead, so the playmaker rules noop and nothing is built.
const leaderQuest = "# Quest: say who is ahead\n\n" +
	"After the score, the scoreboard should name the team that is ahead.\n\n" +
	"```ogsf\n" +
	"difficulty: run-mythic\n" +
	"precondition: |\n" +
	"  true\n" +
	"writes:\n" +
	"  - src/scoreboard.ts\n" +
	"```\n"
