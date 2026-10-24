# Observability reference

What the match log holds, which events a match writes, and how Matchday Live reads them. The authoritative, field-by-field contract — every table's columns, every payload, the HTTP API, the live stream and the relay — is `wiki/DATA-CONTRACT.md` in the fleet's repository. This page summarises it for an orchestrator; when the two differ, the contract wins.

## One shape, three places

1. **The engine** writes every match to `set_pieces/clubhouse/match_log.db` (SQLite, WAL, a 5-second busy wait) on the Mac that runs it, and every event to `matches/{match_id}/match_feed.jsonl`.
2. **`ogsf var`** serves that log on `http://127.0.0.1:4600` with the Matchday Live API and page.
3. **Matchday Live on Vercel** serves the same API from Supabase; each Mac's relay sends its rows there with a fleet token.

The page never knows which of the three it talks to. The database is private; **the API is the public contract.**

## Tables

| Table | One row per | Notes |
|---|---|---|
| `matches` | match | `setpiece_name` (every set piece run under the id, joined with " + "), `ask`, `status` (`running` \| `touchdown` \| `turnover`), `founder`, `project`, `machine`, totals, `archived` (review triage, set from the page only), `updated_at` |
| `objectives` | objective | `objective_id` = `<match_id>_<seq>_<name>`; `kind`, `owner`, `description`, `status`, `attempt`, `retries`, `error` |
| `events` | event | see below; SQLite `rowid` is the cursor |
| `match_reports` | reply a player sent | `report_type`, `payload_json`, `valid`, `attempt` |
| `official_reviews` | review run | `review`, `passed`, `violations_json`, `checks_json` (`[{item, ok, note}]` — the evidence), `attempt` |
| `processes` | process | `kind` `setpiece` (ogsf itself) or `player` (a club child), `pid`, `command`; `ended_at` NULL = believed alive |
| `club_sessions` | player per match | `club`, `model`, `color`, `session_id`, `context_tokens`, `context_window` |
| `team_talks` | player per match | the exact `system` and `user` prompts sent |
| `relay_outbox` | queued row (local only) | what the relay has yet to send |

**Derived, never stored:** objective durations, match progress, lane layout (kind + owner), and usage read/written (summed from `raider_end` payloads).

**Status invariants:** an objective is `running` on entry; only a clean exit writes `touchdown` (a player objective also needs a parsed report, green reviews and no breach); everything else resolves to `turnover`.

## Event types

| Type | Name | When |
|---|---|---|
| `objective_start` · `objective_end` | objective | an objective opens / closes (payload `{kind, owner, description}` / `{status}`) |
| `raider_start` · `raider_end` | player | a club session starts / the player's turn closes (`raider_end` carries the objective's summed `usage`, `cost`, `context_tokens`, `context_window`) |
| `ability_cast` | `bash: ls -la`, or `qa:<check>` | a tool call returned, one event per real call, or a qa check ran — the one event that spans time (`started_at` and `ended_at`) |
| `trade` | player | a report is handed on (`{artifacts, summary}`) |
| `gear_check_pass` · `gear_check_fail` | review | an official review ran (`{attempt, violations, checks}`) |
| `log` | objective, or `console` | a console line (`{message, level}`) or an objective's `Log` |
| `error` | objective, `permission_breach`, or `not_accepted` | an objective failed; a breach was rolled back; `Finish` refused acceptance (`{reason}`) |

**Spend is itemised per objective.** `raider_end.usage` carries tokens and dollars per component — input, output, cache read, cache write — summed across every send the objective made, so a retried objective shows what all its attempts cost. `reasoning_tokens` is the thinking share **of** output, never a fifth component.

**Context is occupancy, not spend.** `total_tokens` bills every turn and only grows; `context_tokens` is how full the window was after the player's last valid turn — what Matchday Live's context bar measures against `context_window`.

**Streaming is by construction.** The club's stream is read line by line and each tool call becomes an event the moment it returns, while the player is still working — never batched at the end.

## A hung match emits nothing

No events, no tokens, no output: that is exactly when you need the pid. `processes` is the only table that answers "what is this match running, and how do I stop it" — `ogsf on-pitch <match_id>`. A match stopped by SIGINT or SIGTERM finalizes its own record: the match lands on `turnover` with its process rows closed, instead of reading `running` forever.

## Reading the log

- **From the terminal:** `ogsf matches | passages | live-feed | on-pitch`; `sqlite3` read-only for anything else. Follow events with a cursor: `where rowid > ?`.
- **From the page:** the API (`/api/matches`, `/api/matches/:id`, `/events?after=`, `/reports`, `/reviews`, `/processes`, `/players/:player/team-talks`) and `GET /api/live`, a server-sent-event stream (`events`, `match`, `matches`, `ping`) whose message id is the cursor, so a reconnect resumes without a gap. The browser never polls.
- **Through the relay:** every write is also queued in `relay_outbox` in the same transaction, so a row is either written AND queued, or neither; the relay sends the queue in order and deletes what the cloud accepted.
