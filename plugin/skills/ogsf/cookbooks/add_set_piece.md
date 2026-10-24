# Add a set piece (contributors, Go)

A new set piece is Go code in the fleet's own source tree, compiled into `ogsf`. Reach for this when a playbook is not enough: the chain needs referee objectives (qa, a scope check, a diff, a commit), a bounded loop, a stronger official review, or its own acceptance rule. Otherwise write a playbook (`create_playbook.md`).

Where things live in the source tree:

| Path | Owns |
|---|---|
| `set_pieces/setpieces.go` | `SetPiece`, `Args`, `Deps` (every effect a set piece has on the world), the shared steps (`start`, `askObjective`, `specObjective`, `testObjective`, `buildCall`, `shipObjective`, `record`) and `MaxExtraTime` |
| `set_pieces/setpiece_<command>.go` | one set piece each, registered in `init()` |
| `set_pieces/reviews.go` | the official reviews a set piece can name |
| `backroom_staff/match` | the match, `Params`, `Handle`, `Call`, `Finish`; the player-call loop |
| `backroom_staff/reports` | every match report type |
| `backroom_staff/officialreview` | the official reviews |
| `backroom_staff/qa`, `contract`, `changes`, `gitops`, `ruling`, `kickoff`, `commitmsg` | the referee machinery |
| `backroom_staff/demo/scenarios.go` | the tour `ogsf demo` plays: every set piece once |

## Step 1 — Design the chain

The same four questions as a playbook, answered in code:

1. **Which players, in what order?** Each player call names its report type: `TalkReport` (playmaker), `AttackReport` (builder), `AnalystReport` (ranger), `VarReport` (safety officer), `BardReport` (bard), `GenericReport` (anything else).
2. **Where does code act?** qa, scope checks, diffs and commits each get their own **referee** objective, never buried inside a player objective. Running the suite is one of these: `d.RunTests(m)`, handed back to the builder as `qa.AsReport(result, "tests")`. Capturing a diff is one: `d.CaptureChanges(m, base)` → `changes.AsReport(...)`.
3. **Does anything loop?** Repair loops are bounded by a constant (`MaxExtraTime = 3`), never by prompt prose.
4. **What must each call prove?** Pick official reviews by name: `ball_in_play`, `ball_not_flat`, `replay_matches_report`, `decision_stands`, `json_parses`.

## Step 2 — Write it

`set_pieces/setpiece_review_docs.go`:

```go
package setpieces

import (
	"github.com/<module>/backroom_staff/match"
	"github.com/<module>/backroom_staff/reports"
)

// review-docs: the ranger finds stale documentation; the builder rewrites it.
func init() {
	register(SetPiece{
		Command:  "review-docs",
		File:     "setpiece_review_docs.go",
		Summary:  "find and fix stale docs: ogsf review-docs \"the README's run section\"",
		Chain:    "head_coach(ask) → ranger(scout_opposition) → builder(build)",
		Required: []string{"ranger", "builder"},          // validated before anything spawns
		Run:      runReviewDocs,
	})
}

func runReviewDocs(d *Deps, a Args) (int, error) {
	_, m, err := start(d, a, "review-docs", []string{"ranger", "builder"})
	if err != nil {
		return 1, err
	}
	if err := askObjective(m, a.Prompt); err != nil {     // the founder's ask comes first, always
		return 1, err
	}
	var found reports.Report
	if err := m.Objective(match.Params{Name: "scout_opposition", Kind: match.Player, Owner: "ranger",
		Description: "Find every stale passage the request names, and say where each is wrong"},
		func(h match.Handle) error {
			found, err = h.Call(match.Call{ReportType: "AnalystReport", Prompt: a.Prompt,
				Reviews: reviews("ball_in_play")})
			return err
		}); err != nil {
		return 1, err
	}
	if _, err := buildCall(m, match.Params{Name: "build", Kind: match.Player, Owner: "builder", Retries: 1,
		Description: "Rewrite only the passages the ranger named"}, a.Prompt, found, "replay_matches_report"); err != nil {
		return 1, err
	}
	return m.Finish(true, ""), nil
}
```

## Non-negotiables

- **`Required` and validation.** Declare every player the set piece calls; `start` validates them (and their team talks and models) before the first objective. A player missing from `Required` passes validation and dies mid-match.
- **Every player call names a report type**, and it comes back typed. No untyped hand-overs.
- **`Previous` carries the chain.** The upstream report lands in the next player's `user.md` as `{{previous_report}}`; bulky context moves through torch-pass files the report declares.
- **The founder's `ask` objective comes first**, always: it is the match's input record.
- **Objective ownership.** `match.Player` → `Owner` is a player from the config (it selects the club, model, tools, team talks AND the lane). `match.HeadCoach` → `m.Founder()`. `match.Referee` → a short actor label (`qa`, `contract`, `git`).
- **Names unique within a match** (`test_1`, `iterate_1`): Matchday Live keys on them.
- **Every description earns its place.** `match.Params.Validate` refuses a blank description and one that only restates the name, before the objective opens. Write `"Put the spec on record before any code exists to blur it"`, not `"Ship the spec"`.
- **`Retries: N`** on a player objective = extra official-review correction rounds, sent into the same club session. Malformed JSON is corrected separately and always (`JSONFixAttempts = 2` in `backroom_staff/match`), even with `Retries: 0`.
- **Every set piece ends in `m.Finish(accepted, reason)`.** A test objective that ran a red suite succeeded at its job; pass `accepted` so the exit code, the match status and the banner are decided together. A failed objective returns its error; the CLI turns a match abandoned into exit 75 and a signal into 128 + n.
- **Shipping is a referee objective with a fallback message.** `TalkReport`, `AttackReport` and `BardReport` each carry a `commit_message` the player writes **for its own work product**; use `shipMessage(report, type, m.ID())`, which falls back to the summary and normalises the header for commitlint, and never reuse one player's sentence for another's diff.
- **Effects go through `Deps`.** Git, qa, the contract and change capture are fields on `Deps`, so a test can script them; never call `gitops` or `qa` directly from a set piece.
- **Stay thin.** Sequencing and acceptance only. Parsing, subprocesses, retry mechanics and reusable checks belong in `backroom_staff/`. A function with more than four parameters takes a struct (`match.Params`, `match.Call` are the pattern). Never `fmt.Println` in a set piece: `h.Log(...)` and the console write the terminal and the match log together.

## Add a report type (the synced triad)

1. **The type** in `backroom_staff/reports/reports.go`: embed `MatchReport`, add only the fields the call needs, a `TypeName()`, a case in `New`, and checks in `Validate` for any enumerated field.
2. **The `## Match report` JSON** in the player's `user.md`, showing exactly that shape (`update_team_talks.md`).
3. **Every call site** passing `ReportType: "<Name>"` — `grep -rn '"<Name>"' set_pieces` finds them.

Change all three in one commit. Renaming or removing a field is the same triad edit.

## Add an official review

A review is a `Review{Name, Check}` in `backroom_staff/officialreview`, where `Check(report) *Result` records **one check per item it looked at** (`r.Check(item, ok, note)`); violations are derived from the failed checks. Register it by name in `set_pieces/reviews.go`.

- **Verify claims, never predict.** Check what the report declared: paths exist, files are not empty, claimed changes exist, a ruling agrees with its own findings.
- **Quantity as properties, not counts** — "every declared artifact exists", never "exactly three".
- **Record checks, don't fail early.** Check every item even after one fails: the player fixes more per correction round when it sees every failure at once.
- **Write a note on passing checks too** ("exists, 2.1KB"); on a failed check the note is what the player is told, so phrase it as the problem.
- **Don't review the unreviewable.** Plan quality and code taste are the safety officer's job, or a human's.

## Test it

- **Control flow, with no model and no command**: follow `set_pieces/strict_flow_test.go`. A fake `match.Runner` records objective names and hands back scripted reports; `Deps` fields return scripted qa and contract results; the test asserts the ORDER of objectives, what each player was handed, what was committed, and the exit code.
- **End to end, for real**: add a scenario to `backroom_staff/demo/scenarios.go` with a scripted club turn per player call. The tour runs it against the throwaway repository through the real engine (config, match log, reviews, restricted area, qa, git), and `backroom_staff/demo/tour_test.go` asserts how it ends. `ogsf demo` then shows it, and its export becomes Matchday Live's demo.
- `go vet ./...` and `go test ./...` green; `gofmt -l .` empty.
