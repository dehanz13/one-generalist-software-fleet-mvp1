# Hand-over reference

The match report schema, the two-channel output contract, the corrections loop and the match directory layout: how context moves between players in code, not in conversation.

## Two output channels, exactly

A player may produce output in two ways and no others:

1. **Files** written into the torch pass (`{{torch_pass_dir}}`): plans, findings, reviews, write-ups for the players that follow.
2. **A final valid-JSON reply**: its match report, and nothing else.

Code does the rest: parse the reply against the report type the call declared, keep it as `match_report.json` and in the match log's `match_reports` table, and hand it to the next player's user prompt as `{{previous_report}}`.

## The match report schema

Every report shares the base:

```json
{
  "status": "touchdown",           // or "turnover" — the only required field
  "summary": "",                   // one sentence: what happened
  "artifacts": [],                 // paths written, usually inside the torch pass
  "notes_for_next_player": ""      // what the next player must know
}
```

`status` is load-bearing: a report that parses but says `turnover` fails the objective. A player declaring its own failure is not a successful objective.

| Type | Player | Extra fields |
|---|---|---|
| `GenericReport` | any | none |
| `TalkReport` | playmaker | `commit_message` (for the PLAN file itself), `ruling` (`implement` \| `noop` \| `blocked`), `ruling_reason` |
| `AttackReport` | builder | `changed_files`, `commit_message` (for the code) |
| `AnalystReport` | ranger | `findings: [{file, note}]` — `file` required in each |
| `VarReport` | safety officer | `approved` (the verdict; `status` only says the review ran), `findings: [{requirement, met, evidence}]` — `requirement` and `met` required in each, `blocking` |
| `BardReport` | bard | `document_path`, `documented_files`, `commit_message` (for the write-up) |
| `ChangesReport` | built by code | `base`, `changed_files`, `insertions`, `deletions`, `stat`, `diff_path` |
| `QaReport` | built by code | `passed`, `failures` (verbatim command output, never summarised) |

`ChangesReport` and `QaReport` are adapters: a deterministic result shaped as a report, so a captured diff reaches the bard, and a failing check reaches the builder, through the same door a player's report uses. The receiving player cannot tell the difference, which is the point.

**Each `commit_message` describes its own player's work product, never the next one's.** A set piece that ships per step (`run-heroic`) ships the spec, the code and the write-up as three commits, each in the words of the player that made it. Headers are normalised for commitlint before shipping (a conventional type, a lower-case subject, no full stop, at most 100 characters; the body untouched).

The report is a **manifest of claims**. Official reviews verify them after the fact: declared artifacts exist and are not empty, claimed changed files exist, a ruling agrees with its own findings.

## The typed-output rule

**Every player call names a concrete report type**, and the final reply is parsed against exactly that type. The user prompt asks for the shape; the type enforces it. They travel as a pair, which is what lets one player serve many calls. Report types live in code, never in the config.

Parsing takes the first fenced block that starts with `{`, else the outermost braces, so prose around the object is tolerated — but the prompt still asks for bare JSON, and every failed attempt is kept as an invalid report row (`valid = 0`, with the last 2,000 characters of the reply).

## The corrections loop

**A bad reply is not a restart.** The harness re-prompts the **same club session**, context intact:

1. **JSON fixes.** A reply that does not parse or validate gets "not valid JSON for the required structure (…) — respond with ONLY a JSON object with these fields: …", at most twice (`JSONFixAttempts`). Always, even on an objective with `Retries: 0`.
2. **Official review corrections.** Every review runs on the parsed report, and each one is recorded (`official_reviews`, plus a `gear_check_pass` / `gear_check_fail` event with every check). Violations go back as one correction ("Your previous response failed validation: …"), at most `Retries` times, and each correction's reply is parsed again with its own JSON fixes. Exhausted, the objective fails.
3. **The write boundary.** After every send is done, the restricted area is enforced (`references/config.md`). A breach is rolled back and fails the objective; it is never re-prompted.

A cold restart would throw away the context that produced the near-miss. Running a player and continuing it are the same call: Pi's `--session-id` creates or continues.

## Injecting the previous report

| Placeholder | Value |
|---|---|
| `{{prompt}}` | the founder's ask, as the set piece received it |
| `{{previous_report}}` | the upstream report as indented JSON, or `(none)` |
| `{{torch_pass_dir}}` | this match's torch pass |
| `{{club_rules}}` | the config's club rules, rendered (system prompts) |

The rendered prompts are kept before they are sent: as files and in the `team_talks` table.

## The match directory

```
set_pieces/clubhouse/matches/{match_id}/
├── match_feed.jsonl        every event, appended as it happens (the raw record)
├── club_sessions.json      player → club session id + model + club
├── torch_pass/             the ONE place players write files for the players that follow
│   ├── plan.md · ranger_findings.md · review.md · document.md · post_mortem.md
│   ├── changes.diff        a captured diff, for the bard
│   └── qa/{seq}_{check}/command.log   every qa check's full output
└── {player}/
    ├── team_talks/         the exact prompts sent (system.md + user.md)
    ├── club_sessions/      the club's own session state
    ├── raw_output.jsonl    the club's full JSONL stream, appended live
    └── match_report.json   the final valid report, with player, purpose, type and attempt
```

## Resuming a player

`club_sessions.json` is what lets a later set piece under the same `--match-id` rejoin each player's **existing context window**: a player whose recorded model still matches the config resumes its session; one whose model changed starts fresh, and the map is updated. Never a bad resume. The `club_sessions` table in the match log is its queryable mirror, with the context occupancy of the player's last turn.

**Files are the raw record; the match log is the queryable mirror** — and, through the relay, the record Matchday Live shows from any machine.
