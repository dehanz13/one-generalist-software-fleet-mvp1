# Update team talks

Change what a player is told. A player's team talks are two files in `set_pieces/clubhouse/team_talks/{player}/`, named in the config under `team_talks.system` and `team_talks.user`. They are the founder's: edit them there.

## The two files, and what goes in each

**`system.md` — who the player is.** Static identity: a Purpose (one sentence, the same as the config's `purpose`), Instructions, and a `## Club rules` section holding exactly `{{club_rules}}`. Nothing about one task.

**`user.md` — the task shape.** One `###` heading per incoming value, then the task, then the output contract:

````markdown
# Scouting Task

## Variables

### prompt

{{prompt}}

### previous_report

{{previous_report}}

### torch_pass_dir

{{torch_pass_dir}}

## Task

Find what `prompt` asks about. Write findings into `torch_pass_dir`, then emit your match report JSON.

## Match report

Respond with ONLY valid JSON matching `AnalystReport` — no prose before or after:

```json
{
  "status": "touchdown",
  "summary": "<one sentence on what you found>",
  "findings": [
    { "file": "src/server.ts", "note": "<why this file matters>" }
  ],
  "artifacts": ["<torch_pass_dir>/ranger_findings.md"]
}
```
````

The shape belongs to the *use*, not the identity, which is why it lives in `user.md`.

## The placeholders

| Placeholder | Becomes |
|---|---|
| `{{prompt}}` | the founder's ask, as the set piece received it |
| `{{previous_report}}` | the previous player's match report (or a code-built one: a `QaReport` with verbatim failures, a `ChangesReport` with the diff path), as indented JSON, or `(none)` |
| `{{torch_pass_dir}}` | this match's torch pass, `set_pieces/clubhouse/matches/<match_id>/torch_pass` |
| `{{club_rules}}` | the project's club rules from the config, rendered as instructions |

They are replaced in that order. The exact text sent is kept, before it is sent, in `matches/<match_id>/<player>/team_talks/` and in the match log's `team_talks` table, so Matchday Live can show it from any machine.

## Keep the synced triad

The `## Match report` JSON is one of three places one contract lives: the Go report type, this JSON example, and the `ReportType` at each call site. A field renamed here and not in Go means the player sends what the prompt asked for, the parser rejects what the type expects, and every call burns correction rounds before it lands — a slow, silent tax. Change all three together (`add_set_piece.md`).

Two values the code relies on:

- `status` is `touchdown` when the player finished its job and `turnover` only when it could not. A report that parses with `turnover` fails the objective: a player declaring its own failure is not a successful objective. For the safety officer, `status` says the review *ran*; the verdict is `approved`.
- The playmaker's `ruling` is `implement`, `noop` or `blocked`. `noop` and `blocked` end the match at the spec, before the builder spends a token, so the prompt must say when each applies and ask for the evidence in `ruling_reason`.

## Rules that keep players honest

- **Every player's `system.md` carries `{{club_rules}}`.** A rule rendered into a variable no template uses reaches nobody; a test holds the shipped prompts to it.
- **Say what the official reviews will check.** `ball_in_play` opens every declared artifact: ask for the paths the player ACTUALLY wrote, `_v2` suffix and all. `replay_matches_report` checks every `changed_files` entry exists.
- **Keep the builder's hands off git.** The builder never commits, stashes, resets or checks out: the set piece compares its diff with the commit the build started from and ships once, after the gate. A commit of its own hides the diff (and the strict difficulty undoes it).
- **Tell the builder the plan is not stray.** `specs/` is always in scope, and a file it did not create is never deleted to "tidy" the tree.
- **Judge commands by exit status, never by scanning output for words.** `error` inside passing output is text.
- **Name tools by their bare names** (`go`, `npm`, `uv`): players inherit the founder's environment.

## After the change

Run the smallest set piece that uses the player (`ogsf ask "<a tiny real request>" --player <name>`), then read what was sent (`matches/<match_id>/<player>/team_talks/`) and what came back (`match_report.json`). Corrections in the match (`⟳ … retry` lines, `gear_check_fail` events) mean the prompt and the report type disagree.
