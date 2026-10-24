# Upcoming Matches and the Scheduler

Plan work with dates, let the Scheduler start it, and queue "run this now" requests. Load this when the founder says sprint, ticket, plan the week, schedule, Upcoming Matches, `ogsf scheduler`, `ogsf request`, or asks why a ticket did not start.

The founder's docs page is `docs/upcoming.md` (and `docs/guide/plan-a-sprint.md` step by step); this cookbook is the procedure.

## Write tickets

Tickets are Markdown in `set_pieces/upcoming/*.md`, committed like specs; `set_pieces/upcoming/README.md` (stamped by `ogsf incorporate`) is the format's home. Draft them **with** the founder — the dates, the set piece and `mode: auto` are the founder's decisions, never yours.

```md
---
sprint: Sprint 14
timezone: Europe/London
---

## KICK-7 · Add a match timer
date: 2026-10-20
time: 09:30
set piece: run-heroic
mode: auto

Add a match timer: start, stop, and minutes played on /timer.
```

The parser's rules (read `backroom_staff/upcoming` before inventing a field — an unknown key is an error):

| Part | Rule |
|---|---|
| front matter | optional, between `---`: `sprint:`, `timezone:` (IANA) |
| heading | `## <ID> · <Title>`: `KICK-7`-style id (letters, dash, number); separator `·` `-` `–` `—` or `:`; ids unique across all files |
| `date:` | required, `YYYY-MM-DD` |
| `time:` | optional `HH:MM`; else `upcoming.default_time` (default `09:00`) |
| `set piece:` | required: any set piece command |
| `mode:` | `auto` (the Scheduler starts it when due) or `manual` (default) |
| `player:` | `ask` only |
| `spec:` | a quest spec path; when present it **replaces** the prompt (text under the ticket is ignored). The file must exist, or the ticket is marked `skipped` with a note and never launched: write and commit the spec, then `ogsf upcoming run <id>` |
| `timezone:` | per ticket, overrides the file's and the config's |
| prompt | after a blank line, up to the next `##` |

Prose outside a ticket heading is ignored. A played ticket keeps its status (editing it does not replay it); removing one that never ran marks it `skipped`. Write the prompt the way `how_to_prompt_for_the_founder.md` says — a ticket's prompt is a set-piece prompt.

Then check every ticket reads, and show the founder the result:

```bash
ogsf upcoming            # every ticket: id, due time, set piece, mode, status; and any ticket it could not read, with why
```

## Run tickets

```bash
ogsf upcoming run KICK-7     # play one ticket now (auto or manual), in the foreground
ogsf scheduler               # long-running: every poll_seconds, and straight after a match, start at most one
ogsf scheduler --once        # one round, then exit (test, or cron)
```

The Scheduler's order each round: the earliest due `auto` ticket, then a request made on this Mac, then one from the cloud. **One match at a time.** Ctrl-C stops it at once — a match in progress gets the same signal and is recorded as a turnover — so stop it between matches when you can. Launch `ogsf scheduler` in the background and observe it with `observe.md` — do not sit in a loop polling it.

Before you start it, check the working tree with the founder: tickets run on the branch that is checked out, and `run-heroic`/`run-mythic` tickets pass the kickoff checklist (clean tree, feature branch; a quest spec needs `feature/<spec stem>`). A refused ticket is marked with the reason and nothing runs.

## Requests

A request is "run this now", from `ogsf request`, Matchday Live's **Run now**, or the Claude connector.

```bash
ogsf request "where is auth handled?" --set-piece scout-opposition [--machine studio-imac]
ogsf request --ticket KICK-7          # play a ticket the founder wrote
ogsf request "summarise the repo" --set-piece ask --player ranger
ogsf requests                         # this Mac's queue, newest first, with status and any refusal reason
```

Who may start work — say this to the founder before turning anything on:

- Requests run only where `scheduler.accept_remote: true` (default `false`) and `ogsf scheduler` is running.
- A request **by set piece name** runs only if the set piece is in `scheduler.allowed_set_pieces` (default `[ask, scout-opposition, team-talk]`, the ones that commit nothing).
- A request **for a ticket** may run whatever set piece the ticket names. If the Scheduler already played it (an `auto` ticket that came due first), the request takes that match's result with a note; a ticket still running is refused, with the match id.
- Every match still passes its kickoff checklist. A refused request is `refused`, with the reason.

Changing `accept_remote` or `allowed_set_pieces` is a config change under `set_pieces/boardroom/` — the founder's decision, made with `update_config.md`, never on your own initiative.

## Statuses

Ticket: `scheduled` → `due` → `queued` → `running` → `touchdown` | `turnover`, or `skipped` with a note. Request: `queued` → `claimed` → `running` → `touchdown` | `turnover`, or `refused` | `cancelled`. The match that played a ticket carries its `ticket_id`; Matchday Live's **Upcoming Matches** (`#/upcoming`) links both ways.

## Linear

`kind: linear` under `upcoming.sources` is reserved: it is reported as "arrives later; use markdown for now". Do not promise a Linear sync; offer to copy issues into a Markdown file with their Linear ids as ticket ids.

## Report

Tell the founder: which tickets read and which did not (with the parser's reason), what is due next and when, whether the Scheduler is running and on which branch, and for a request its status and any refusal reason verbatim.
