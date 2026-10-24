# The match log and its data contract

Every match leaves a complete record, written as it happens. That record has
one shape in three places:

1. **On the Mac that ran it**, in `set_pieces/clubhouse/match_log.db`
   (SQLite, in WAL mode so readers never block the writer), plus a raw
   `match_feed.jsonl` in the match's folder.
2. **Through `ogsf var`**, which serves that file as an HTTP API on
   `http://127.0.0.1:4600`.
3. **In your cloud**, where Matchday Live on Vercel serves the same API from
   Supabase, filled by each Mac's relay.

The page never knows which of the three it is reading: same paths, same
JSON. The database is private; **the API is the public contract**. The full
contract, column by column, is [`wiki/DATA-CONTRACT.md`](../../wiki/DATA-CONTRACT.md).

## The tables

| Table | One row per | Worth knowing |
|---|---|---|
| `matches` | match | set piece, the ask, status, founder, project, machine, start and end, total tokens and cost, and (since version 2) the `ticket_id` it played |
| `objectives` | objective | its order (`seq`), kind (head coach, player or referee), owner, description, status, attempts, error |
| `events` | thing that happened | objective and player starts and ends, every tool call (`ability_cast`), hand-overs (`trade`), review results, logs and errors |
| `match_reports` | reply a player gave | the report type, its JSON, whether it was valid, which attempt |
| `official_reviews` | review run | passed or not, the violations and every check |
| `processes` | child process | its pid and command, so `ogsf on-pitch` can say what is alive |
| `club_sessions` | player in a match | club, model, colour, session id, how full its context window got |
| `team_talks` | player in a match | the exact system and user prompt it was sent |
| `upcoming_matches` | planned ticket | date, time, zone, due time, set piece, mode, status, the match that played it |
| `requests` | "run this now" | who asked (page, connector, cli), what, for which Mac, its status |
| `relay_outbox` | row waiting to be relayed | emptied as the relay sends |

Every time is an ISO-8601 UTC string with milliseconds, written by the
engine, so sorting text sorts time.

## Events

`events.type` says what happened; `payload_json` holds the details.

| Type | Name | Payload, in short |
|---|---|---|
| `objective_start` · `objective_end` | the objective | kind, owner, description · touchdown or turnover |
| `raider_start` · `raider_end` | the player | model, thinking, colour, tools · tokens, cost, usage, context use |
| `ability_cast` | `bash: ls -la`, or `qa:<check>` | a tool call (args, ok, a result snippet, duration) or a qa check (command, exit code, passed) |
| `trade` | the player | what it handed to the next one |
| `gear_check_pass` · `gear_check_fail` | the review | attempt, violations, checks |
| `log` | the objective, or `console` | console lines and logged values |
| `error` | the objective, `permission_breach` or `not_accepted` | what went wrong |

`usage` on a `raider_end` breaks tokens down the way the provider counted
them: input (excluding cache reads), output, cache reads, cache writes,
reasoning (the thinking share *of* output, never added to it), and each
one's cost. [Reports](measures.md) explains why those distinctions matter.

## The API

The same on `ogsf var` and on Vercel. JSON, never cached, and every error
is `{"error": "<what to do next>"}`.

| Method · path | Answer |
|---|---|
| `GET /api/health` | which source this is, how many matches, which store |
| `GET /api/matches` | every match with its objectives and players |
| `GET /api/matches/:id` | one match: row, token usage, objectives, players |
| `POST /api/matches/:id/archive` | archive or unarchive it |
| `GET /api/matches/:id/events?after=<cursor>` | its events, from a cursor |
| `GET /api/matches/:id/reports` · `/reviews` · `/processes` | the rest of its record |
| `GET /api/matches/:id/players/:player/team-talks` | exactly what that player was told |
| `GET /api/live` | server-sent events: new events, changed matches, a ping every 15 s |
| `GET /api/report-facts?since=&until=` | every row a report needs for a period |
| `GET /api/upcoming` | Upcoming Matches, by due time |
| `GET /api/requests` · `POST /api/requests` | the requests, and making one |

The live stream carries a cursor as each message's id, so a dropped
connection resumes exactly where it stopped. The page is never asked to
poll.

## Inspecting from the terminal

| Command | Shows |
|---|---|
| `ogsf matches` | the last ten matches |
| `ogsf passages <match_id>` | a match's objectives, in order |
| `ogsf live-feed <match_id>` | its latest 25 events |
| `ogsf on-pitch <match_id>` | what it has alive right now, with pids |
| `ogsf highlights-match <match_id>` | one text file with the whole record: rows, events, qa logs, reports |
| `ogsf post-match <match_id>` | sends the ranger to read those highlights and recommend changes |
