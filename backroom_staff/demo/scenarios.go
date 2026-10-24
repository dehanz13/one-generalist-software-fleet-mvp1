package demo

import (
	"time"

	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/club"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/highlights"
	"github.com/dehanz13/one-generalist-software-fleet-mvp1/backroom_staff/matchfeed"
	setpieces "github.com/dehanz13/one-generalist-software-fleet-mvp1/set_pieces"
)

func sec(n float64) time.Duration { return time.Duration(n * float64(time.Second)) }

// Typical spend per role, roughly what the legacy sample runs recorded.
var (
	rangerSpend    = spend{in: 3_800, out: 900, cacheRead: 21_000, cacheWrite: 4_200, reasoning: 200, cost: 0.018}
	playmakerSpend = spend{in: 8_900, out: 3_600, cacheRead: 64_000, cacheWrite: 14_500, reasoning: 1_900, cost: 0.214}
	builderSpend   = spend{in: 14_200, out: 6_800, cacheRead: 238_000, cacheWrite: 26_000, reasoning: 2_700, cost: 0.612}
	fixSpend       = spend{in: 5_100, out: 2_300, cacheRead: 121_000, cacheWrite: 6_400, reasoning: 900, cost: 0.183}
	safetySpend    = spend{in: 7_400, out: 2_100, cacheRead: 83_000, cacheWrite: 11_800, reasoning: 1_200, cost: 0.161}
	bardSpend      = spend{in: 6_100, out: 1_900, cacheRead: 9_800, cacheWrite: 0, reasoning: 600, cost: 0.014}
	correctionTurn = spend{in: 900, out: 300, cacheRead: 96_000, cacheWrite: 1_100, reasoning: 100, cost: 0.041}
)

func script(players map[string][]club.Turn) *club.Script { return &club.Script{Players: players} }

func scenarios() []scenario {
	return []scenario{
		// 0
		{command: "ask", story: "one player, one prompt", day: 0, at: "14:00",
			args: setpieces.Args{Prompt: "In one line: what does this repository do?", Player: "ranger"},
			script: func(*tourRun) *club.Script {
				return script(map[string][]club.Turn{"ranger": {turn(
					`{"status": "touchdown", "summary": "Kickabout is a tiny five-a-side scoreboard: addGoal and leader in src/score.ts, render in src/scoreboard.ts, served at /score by src/server.ts.", "artifacts": [], "notes_for_next_player": ""}`,
					rangerSpend, sec(9), read("README.md", 700), ls("src", 400), read("src/server.ts", 600))}})
			}},
		// 1
		{command: "scout-opposition", story: "read-only recon with findings", day: 0, at: "14:20",
			via: "request", request: &matchfeed.RequestRow{RequestedBy: "page", Kind: "set_piece", SetPiece: "scout-opposition"},
			args: setpieces.Args{Prompt: "Where is the score rendered, and where would a /health endpoint go?"},
			script: func(*tourRun) *club.Script {
				return script(map[string][]club.Turn{"ranger": {turn(
					analystReport("render() in src/scoreboard.ts formats the score; routes live in src/server.ts's createServer callback.",
						finding("src/scoreboard.ts", "render(score) joins each team and its goals and appends who leads"),
						finding("src/server.ts", "the request handler answers /score; a /health branch belongs beside it"),
						finding("scripts/test.sh", "the suite already checks /health when src/health.ts exists")),
					rangerSpend, sec(14),
					grep("render", "src", "src/scoreboard.ts:3:export function render(score: any): string {\nsrc/server.ts:2:import { render } from \"./scoreboard\";", 900),
					read("src/scoreboard.ts", 600), read("src/server.ts", 500), read("scripts/test.sh", 500),
					write("{{torch_pass_dir}}/ranger_findings.md", "# Findings\n\n- `src/scoreboard.ts`: render(score) builds the line.\n- `src/server.ts`: the request handler; add /health beside /score.\n- `scripts/test.sh`: checks /health when src/health.ts exists.\n", 800))}})
			}},
		// 2
		{command: "scout-opposition", story: "a read-only player writes to the repo: rolled back, objective lost", day: 0, at: "14:45",
			args: setpieces.Args{Prompt: "List every TODO in the codebase. Change nothing."},
			script: func(*tourRun) *club.Script {
				return script(map[string][]club.Turn{"ranger": {turn(
					analystReport("No TODO comments in src/ or scripts/; notes kept in NOTES.md for later.", finding("src", "no TODO, FIXME or XXX comments")),
					rangerSpend, sec(8),
					bash("grep -rn 'TODO\\|FIXME' src scripts || echo 'no matches'", 700),
					write("NOTES.md", "# Notes\n\nNo TODOs found on the first pass.\n", 500),
					write("{{torch_pass_dir}}/ranger_findings.md", "# Findings\n\nNo TODO, FIXME or XXX comments in src/ or scripts/.\n", 400))}})
			}},
		// 3
		{command: "team-talk", story: "a spec only, kept in specs/", day: 0, at: "15:30",
			ticket: "KICK-101", title: "Plan the /health endpoint", via: "tick",
			args: setpieces.Args{Prompt: "Plan a /health endpoint that answers ok."},
			script: func(*tourRun) *club.Script {
				plan := "# Plan: a /health endpoint\n\n1. Create `src/health.ts` exporting `health()` that returns `\"ok\"`.\n2. In `src/server.ts`, answer `/health` with `health()` before the 404.\n3. Verify: `sh scripts/test.sh` runs the /health check once src/health.ts exists.\n"
				return script(map[string][]club.Turn{"playmaker": {turn(
					talkReport("Two-file plan: src/health.ts and one branch in src/server.ts.", "health-endpoint", "implement", "",
						"Add spec for the /health endpoint", "Keep the 404 last; the suite already checks /health."),
					playmakerSpend, sec(38), planSteps("health-endpoint", plan, read("src/server.ts", 600), read("scripts/test.sh", 500))...)}})
			}},
		// 4
		{command: "qa", story: "strict qa: lint and typecheck are red, so the referee's objective is lost", day: 0, at: "16:10",
			args: setpieces.Args{Prompt: "Is the repo green before we start the week?"}},
		// 5
		{command: "attack", story: "the builder claims a file it never wrote; the official review sends it back once", day: 1, at: "14:05",
			args: setpieces.Args{Prompt: "Add an Unreleased CHANGELOG entry for the scoreboard."},
			script: func(*tourRun) *club.Script {
				return script(map[string][]club.Turn{"builder": {
					turn(attackReport("Added the Unreleased entry.", "docs(changelog): note the scoreboard", "",
						"CHANGELOG.md", "docs/CHANGELOG.md"),
						builderSpend, sec(41), read("CHANGELOG.md", 400),
						edit("CHANGELOG.md", "## Unreleased\n", "## Unreleased\n\n- A scoreboard for five-a-side games: goals, the leader, /score.\n", 900)),
					turn(attackReport("Added the Unreleased entry; only CHANGELOG.md changed.", "docs(changelog): note the scoreboard", "",
						"CHANGELOG.md"), correctionTurn, sec(6), bash("git status --short", 300)),
				}})
			}},
		// 6
		{command: "talk-attack", story: "playmaker → builder → ship", day: 1, at: "15:00",
			ticket: "KICK-102", title: "Add the /health endpoint", via: "tick",
			args: setpieces.Args{Prompt: "Add a /health endpoint that answers ok."},
			script: func(*tourRun) *club.Script {
				plan := "# Plan: /health\n\n1. `src/health.ts`: `export function health(): string { return \"ok\"; }`\n2. `src/server.ts`: answer `/health` before the 404.\n"
				return script(map[string][]club.Turn{
					"playmaker": {turn(talkReport("Add src/health.ts and route /health in src/server.ts.", "health", "implement", "",
						"Add spec for /health", "Route it before the 404."), playmakerSpend, sec(44), planSteps("health", plan, read("src/server.ts", 500))...)},
					"builder": {turn(attackReport("Added health() and the /health route.", "feat(server): answer /health with ok", "sh scripts/test.sh covers /health",
						"src/health.ts", "src/server.ts"), builderSpend, sec(52),
						read("{{torch_pass_dir}}/plan.md", 400),
						write("src/health.ts", "/** What /health answers while the server is up. */\nexport function health(): string {\n  return \"ok\";\n}\n", 900),
						edit("src/server.ts", "import { render } from \"./scoreboard\";\n", "import { health } from \"./health\";\nimport { render } from \"./scoreboard\";\n", 600),
						edit("src/server.ts", "  if (req.url === \"/score\") {\n", "  if (req.url === \"/health\") {\n    res.end(health());\n    return;\n  }\n  if (req.url === \"/score\") {\n", 700),
						bash("sh scripts/test.sh || true", 1800))},
				})
			}},
		// 7
		{command: "bard", story: "a write-up from the diff, never from memory", day: 1, at: "16:30",
			args: setpieces.Args{Prompt: "Document the /health endpoint.", Base: "main"},
			script: func(*tourRun) *club.Script {
				doc := "# /health\n\n`GET /health` answers `ok` while the server is up (`src/health.ts`, routed in `src/server.ts`).\n\nVerify: `sh scripts/test.sh` includes \"/health answers ok\".\n"
				return script(map[string][]club.Turn{"bard": {turn(bardReport("Wrote up /health from the last commit's diff.", "health-endpoint",
					"Document the /health endpoint", "src/health.ts", "src/server.ts"), bardSpend, sec(21),
					read("{{torch_pass_dir}}/changes.diff", 800),
					write("{{torch_pass_dir}}/document.md", doc, 900),
					bash(`mkdir -p app_docs && cp "{{torch_pass_dir}}/document.md" "app_docs/{{match_id}}_health-endpoint.md"`, 300))}})
			}},
		// 8
		{command: "attack-var", story: "the suite stays red after the build; extra time repairs it", day: 2, at: "14:10",
			ticket: "KICK-103", title: "Fix addGoal", via: "run",
			args: setpieces.Args{Prompt: "addGoal does not add the goal. Fix it."},
			script: func(*tourRun) *club.Script {
				return script(map[string][]club.Turn{"builder": {
					turn(attackReport("addGoal now counts from zero for a new team.", "fix(score): count a new team's first goal", "",
						"src/score.ts"), builderSpend, sec(48), read("src/score.ts", 500),
						edit("src/score.ts", "[team]: score[team] }", "[team]: score[team] ?? 0 }", 700)),
					turn(attackReport("addGoal adds one goal: score[team] + 1, from one for a new team.",
						"fix(score): add one goal in addGoal\n\naddGoal returned the team's score unchanged, so no goal ever counted; it now adds one, starting at one for a team with no goals yet.",
						"", "src/score.ts"), fixSpend, sec(24), bash("cat {{torch_pass_dir}}/qa/03_test_1/command.log", 300),
						edit("src/score.ts", "[team]: score[team] ?? 0 }", "[team]: team in score ? score[team] + 1 : 1 }", 600),
						bash("sh scripts/test.sh", 1700)),
				}})
			}},
		// 9
		{command: "attack-review", story: "the safety officer rejects once; the builder revises; approved", day: 2, at: "15:20",
			ticket: "KICK-104", title: "Record goals with POST /goal", via: "tick",
			args: setpieces.Args{Prompt: "Add POST /goal?team=<name> that records a goal for Reds or Blues only."},
			script: func(*tourRun) *club.Script {
				return script(map[string][]club.Turn{
					"builder": {
						turn(attackReport("Added POST /goal, recording a goal with addGoal.", "feat(server): record goals with POST /goal", "",
							"src/server.ts"), builderSpend, sec(63), read("src/server.ts", 600),
							edit("src/server.ts", "  res.statusCode = 404;\n", "  if (req.method === \"POST\" && req.url?.startsWith(\"/goal\")) {\n    const team = new URL(req.url, \"http://x\").searchParams.get(\"team\") ?? \"\";\n    Object.assign(score, addGoal(score, team));\n    res.end(render(score));\n    return;\n  }\n  res.statusCode = 404;\n", 900),
							edit("src/server.ts", "import { render } from \"./scoreboard\";\n", "import { render } from \"./scoreboard\";\nimport { addGoal } from \"./score\";\n", 400)),
						turn(attackReport("POST /goal now refuses any team but Reds and Blues with a 400.",
							"feat(server): record goals with POST /goal\n\nOnly Reds and Blues are accepted; any other team answers 400 and changes nothing.", "",
							"src/server.ts"), fixSpend, sec(29), bash("cat {{torch_pass_dir}}/review.md", 300),
							edit("src/server.ts", "    Object.assign(score, addGoal(score, team));",
								"    if (team !== \"Reds\" && team !== \"Blues\") {\n      res.statusCode = 400;\n      res.end(\"unknown team\");\n      return;\n    }\n    Object.assign(score, addGoal(score, team));", 700)),
					},
					"safety_officer": {
						turn(varReport("2 of 3 requirements met: an unknown team is recorded too.", false,
							[]string{"POST /goal?team=Greens records a goal; the ask allows Reds or Blues only"},
							met("POST /goal records a goal", "src/server.ts: addGoal(score, team)"),
							met("the response shows the new score", "src/server.ts: res.end(render(score))"),
							unmet("only Reds or Blues", "no check on team before addGoal")),
							safetySpend, sec(47), read("src/server.ts", 600), bash("git diff --stat", 300),
							write("{{torch_pass_dir}}/review.md", "# Review\n\nBlocking: any team name is recorded.\n", 500)),
						turn(varReport("3 of 3 requirements met.", true, nil,
							met("POST /goal records a goal", "src/server.ts: addGoal(score, team)"),
							met("the response shows the new score", "src/server.ts: res.end(render(score))"),
							met("only Reds or Blues", "src/server.ts: 400 for any other team")),
							safetySpend, sec(33), read("src/server.ts", 500),
							write("{{torch_pass_dir}}/review.md", "# Review\n\nApproved: all three requirements met.\n", 400)),
					},
				})
			}},
		// 10
		{command: "play", story: "a playbook written as data: ranger → builder", day: 2, at: "17:00",
			args: setpieces.Args{Prompt: "Make the README say how to run the server.", Playbook: "review_docs"},
			before: func(*tourRun) error {
				_, err := setpieces.WritePlaybook("review_docs", []string{"ranger", "builder"}, true)
				return err
			},
			script: func(*tourRun) *club.Script {
				return script(map[string][]club.Turn{
					"ranger": {turn(analystReport("The README names the tests but not how to start the server.",
						finding("README.md", "only `sh scripts/test.sh` is shown"), finding("src/server.ts", "exports `server`; nothing listens")),
						rangerSpend, sec(11), read("README.md", 400), read("src/server.ts", 400),
						write("{{torch_pass_dir}}/ranger_findings.md", "# Findings\n\nREADME lacks a run line; src/server.ts exports server only.\n", 300))},
					"builder": {turn(attackReport("README now shows how to run the server.", "docs(readme): show how to run the server", "",
						"README.md"), fixSpend, sec(27), read("README.md", 300),
						edit("README.md", "    sh scripts/test.sh     # the unit checks\n", "    sh scripts/test.sh     # the unit checks\n    node -e 'require(\"./dist/server\").server.listen(3000)'   # serve /score and /health\n", 500))},
				})
			}},
		// 11
		{command: "run-normal", story: "spec → build → test → ship", day: 3, at: "14:00",
			ticket: "KICK-105", title: "Report the server's uptime", via: "tick",
			args: setpieces.Args{Prompt: "Track how long the server has been up, in whole seconds."},
			script: func(*tourRun) *club.Script {
				plan := "# Plan: uptime\n\n1. `src/uptime.ts`: remember the start and return whole seconds since.\n2. Verify with `sh scripts/test.sh`.\n"
				return script(map[string][]club.Turn{
					"playmaker": {turn(talkReport("One module, src/uptime.ts, measured from import time.", "uptime", "implement", "",
						"Add spec for uptime", ""), playmakerSpend, sec(35), planSteps("uptime", plan)...)},
					"builder": {turn(attackReport("Added uptimeSeconds() in src/uptime.ts.", "feat(uptime): report whole seconds since start", "",
						"src/uptime.ts"), builderSpend, sec(39),
						write("src/uptime.ts", "const started = Date.now();\n\n/** Whole seconds since the server module loaded. */\nexport function uptimeSeconds(): number {\n  return Math.floor((Date.now() - started) / 1000);\n}\n", 700),
						bash("sh scripts/test.sh", 1500))},
				})
			}},
		// 12
		{command: "ask", story: "the provider runs out of credits: match abandoned, exit 75", day: 3, at: "15:40",
			args: setpieces.Args{Prompt: "Summarise this week's changes for the club newsletter.", Player: "ranger"},
			script: func(*tourRun) *club.Script {
				t := turn("", rangerSpend, sec(3), bash("git log --oneline -8", 500))
				t.ProviderError = "You have no credits remaining."
				return script(map[string][]club.Turn{"ranger": {t}})
			}},
		// 13
		{command: "post-match", piece: "scout-opposition", story: "a ranger reads the abandoned match's highlights", day: 3, at: "16:05",
			before: bundleFor(12),
			prompt: func(t *tourRun) string {
				return highlights.PostMortemPrompt(highlights.Path(t.result.Outcomes[12].MatchID))
			},
			script: func(t *tourRun) *club.Script {
				bundle := highlights.Path(t.result.Outcomes[12].MatchID)
				report := analystReport("The match stopped at the provider, not at a review: no credits after one tool call.",
					finding(bundle, "objective answer: error 'pi provider error: You have no credits remaining.'"),
					finding("set_pieces/boardroom/club.config.yaml", "the ranger has no fallback model; the account decision is the founder's"))
				report.Artifacts = []string{"{{torch_pass_dir}}/post_mortem.md"}
				return script(map[string][]club.Turn{"ranger": {turn(report,
					rangerSpend, sec(16), bash("head -40 "+bundle, 600),
					write("{{torch_pass_dir}}/post_mortem.md", "# Post-mortem\n\n1. Stopped by the provider (no credits) after one tool call; nothing was judged wrong.\n2. Spend: one turn.\n3. Recommendation: top up, then rerun the same ask.\n", 900))}})
			}},
		// 14
		{command: "run-heroic", story: "spec, build, test, review, write-up: three commits", day: 4, at: "14:00",
			ticket: "KICK-106", title: "A match timer", via: "request", request: &matchfeed.RequestRow{RequestedBy: "page", Kind: "ticket"},
			args: setpieces.Args{Prompt: "Add a match timer: start, stop, and minutes played on /timer."}, raw: "Add a match timer: start, stop, and minutes played on /timer.",
			before: func(*tourRun) error { return git("checkout", "-q", "-b", "feature/match-timer") },
			script: func(*tourRun) *club.Script {
				plan := "# Plan: match timer\n\n1. `src/timer.ts`: start(), stop(), minutesPlayed().\n2. `src/server.ts`: GET /timer answers minutesPlayed().\n3. Verify: `sh scripts/test.sh`.\n"
				doc := "# Match timer\n\n`src/timer.ts` keeps the kick-off time; `GET /timer` answers the minutes played.\n"
				return script(map[string][]club.Turn{
					"playmaker": {turn(talkReport("Timer module plus a /timer route.", "match-timer", "implement", "",
						"Add spec for the match timer", ""), playmakerSpend, sec(52), planSteps("match-timer", plan, read("src/server.ts", 500))...)},
					"builder": {turn(attackReport("Added src/timer.ts and GET /timer.", "feat(timer): show minutes played on /timer", "",
						"src/timer.ts", "src/server.ts"), builderSpend, sec(71),
						write("src/timer.ts", "let kickOff: number | null = null;\n\n/** Starts the clock. */\nexport function start(): void {\n  kickOff = Date.now();\n}\n\n/** Stops the clock. */\nexport function stop(): void {\n  kickOff = null;\n}\n\n/** Whole minutes since kick-off, 0 before it. */\nexport function minutesPlayed(): number {\n  return kickOff === null ? 0 : Math.floor((Date.now() - kickOff) / 60000);\n}\n", 900),
						edit("src/server.ts", "  if (req.url === \"/score\") {\n", "  if (req.url === \"/timer\") {\n    res.end(String(minutesPlayed()));\n    return;\n  }\n  if (req.url === \"/score\") {\n", 700),
						edit("src/server.ts", "import { createServer } from \"node:http\";\n", "import { createServer } from \"node:http\";\nimport { minutesPlayed } from \"./timer\";\n", 400),
						bash("sh scripts/test.sh", 1600))},
					"safety_officer": {turn(varReport("3 of 3 requirements met.", true, nil,
						met("start and stop the clock", "src/timer.ts: start(), stop()"),
						met("minutes played", "src/timer.ts: minutesPlayed()"),
						met("served on /timer", "src/server.ts: /timer branch")),
						safetySpend, sec(38), read("src/timer.ts", 400), read("src/server.ts", 400),
						write("{{torch_pass_dir}}/review.md", "# Review\n\nApproved.\n", 300))},
					"bard": {turn(bardReport("Wrote up the match timer.", "match-timer", "Document the match timer", "src/timer.ts", "src/server.ts"),
						bardSpend, sec(19), read("{{torch_pass_dir}}/changes.diff", 600),
						write("{{torch_pass_dir}}/document.md", doc, 500),
						bash(`mkdir -p app_docs && cp "{{torch_pass_dir}}/document.md" "app_docs/{{match_id}}_match-timer.md"`, 300))},
				})
			}},
		// 15
		{command: "run-mythic", story: "the strict difficulty: a stray file fails the scope check, extra time removes it, the progressive gate passes",
			day: 4, at: "15:30", ticket: "KICK-107", title: "A lint-clean scoreboard", via: "tick", raw: "specs/demo-quests/scoreboard-lint-clean.md",
			args:   setpieces.Args{Prompt: lintQuest},
			before: writeQuest("scoreboard-lint-clean", lintQuest),
			script: func(*tourRun) *club.Script {
				plan := "# Plan: a lint-clean scoreboard\n\n1. Remove both `console.log` calls from `render`.\n2. Type `render(score: Score)` with `Score` from ./score.\n3. Note it under Unreleased in CHANGELOG.md.\n"
				clean := "import { leader, Score } from \"./score\";\n\nexport function render(score: Score): string {\n  const lead = leader(score);\n  const line = Object.entries(score).map(([team, goals]) => team + \" \" + goals).join(\" · \");\n  return lead ? line + \" (\" + lead + \" lead)\" : line;\n}\n"
				return script(map[string][]club.Turn{
					"playmaker": {turn(talkReport("Three edits in two files; render's output is unchanged.", "scoreboard-lint-clean", "implement", "",
						"Add spec for a lint-clean scoreboard", "Only src/scoreboard.ts and CHANGELOG.md are in scope."),
						playmakerSpend, sec(46), planSteps("scoreboard-lint-clean", plan, read("src/scoreboard.ts", 500), bash("sh scripts/lint.sh || true", 900))...)},
					"builder": {
						turn(attackReport("render is lint-clean and typed.",
							"refactor(scoreboard): drop debug logging and type render\n\nRemoved the two console.log calls from render and typed its score as Score; what render returns is unchanged.",
							"", "src/scoreboard.ts", "CHANGELOG.md"), builderSpend, sec(66),
							write("src/scratch.ts", "// scratch: render without the logs, to compare output\n", 300),
							write("src/scoreboard.ts", clean, 900),
							edit("CHANGELOG.md", "## Unreleased\n", "## Unreleased\n\n- The scoreboard no longer prints debug lines.\n", 400),
							bash("sh scripts/lint.sh && sh scripts/typecheck.sh", 1400)),
						turn(attackReport("Removed the stray scratch file.", "remove the stray scratch file", "", "src/scoreboard.ts"),
							correctionTurn, sec(9), remove("src/scratch.ts", 200)),
					},
				})
			}},
		// 16
		{command: "run-mythic", story: "the playmaker finds the work already done: ruled noop, not accepted", day: 4, at: "17:10",
			raw: "specs/demo-quests/scoreboard-leader.md", args: setpieces.Args{Prompt: leaderQuest},
			before: writeQuest("scoreboard-leader", leaderQuest),
			script: func(*tourRun) *club.Script {
				plan := "# Plan: say who is ahead\n\nNothing to build: `render` in src/scoreboard.ts already appends \"(<team> lead)\".\n"
				return script(map[string][]club.Turn{"playmaker": {turn(
					talkReport("The scoreboard already names the leader.", "scoreboard-leader", "noop",
						"src/scoreboard.ts:6 returns line + \" (\" + lead + \" lead)\"; sh scripts/test.sh checks leader",
						"Add spec for the leader line", ""),
					playmakerSpend, sec(27), planSteps("scoreboard-leader", plan, read("src/scoreboard.ts", 500))...)}})
			}},
		// 17
		{command: "run-mythic", story: "the same match id again: strict re-verification only, no players", day: 4, at: "17:45",
			raw: "specs/demo-quests/scoreboard-leader.md", args: setpieces.Args{Prompt: leaderQuest}, matchID: "@16"},
	}
}
