# Observe

Watch a match, diagnose a failed one, stop a stuck one, and see the fleet from anywhere. Observing is something you do for a match you launched or one the founder asked about — never a status report nobody requested.

## From the terminal

The match log is `set_pieces/clubhouse/match_log.db` (SQLite, WAL), so reading never blocks a running match. Read it through the binary:

```bash
ogsf matches                     # the last 10 matches: id, status, set piece, ask
ogsf passages <match_id>         # its objectives in order: seq, name, kind, owner, status, attempt
ogsf live-feed <match_id>        # the latest 25 events
ogsf on-pitch <match_id>         # what it has alive right now, with pids
```

Every line a set piece prints is also written to the log as a `log` event, so the terminal and Matchday Live tell the same story by construction — tailing the background process is a valid second view, not a competing source of truth.

When you need more than these show, query the log directly with `sqlite3` (read-only), using the schema in `references/observability.md`:

```bash
# why an objective failed: the official reviews and every check they ran
sqlite3 set_pieces/clubhouse/match_log.db \
  "select attempt, review, passed, checks_json from official_reviews where match_id='a1b2c3d4';"
# what a player actually did, latest ability casts first
sqlite3 set_pieces/clubhouse/match_log.db \
  "select name, started_at, ended_at from events where match_id='a1b2c3d4' and type='ability_cast' order by rowid desc limit 20;"
```

Follow a log on a cursor: keep the highest `rowid` you have seen and query `where rowid > ?`; don't re-read the whole table each pass.

Files are the raw record when you need more than the log: `set_pieces/clubhouse/matches/{match_id}/{player}/raw_output.jsonl` (the club's full stream), `match_report.json` (the parsed final reply), `team_talks/` (exactly what was sent), and `torch_pass/` (what players wrote for each other, the qa `command.log`s, `changes.diff`).

## Matchday Live

```bash
ogsf var                          # http://127.0.0.1:4600, opens a browser
ogsf var --port 4700 --no-open
```

The page is built into the binary and reads this Mac's match log, with every change pushed as it happens (server-sent events — the browser never polls). It lists matches with their objective progress, draws each match as lanes (head coach, each player, referee), and opens any objective: ability casts with their arguments and results, match reports, official reviews with every check, team talks, errors, usage and context, and what is on the pitch. It listens on `127.0.0.1` only and has no login, so it refuses any other origin unless you allow it with `--allow-origin <your Matchday Live URL>` (the relay URL's origin is allowed already).

### From another Mac: the relay and Vercel

The founder's own Matchday Live deployment on Vercel shows every Mac's matches. Its secrets live only in Vercel's environment variables: `DATABASE_URL` (Supabase's transaction pooler string), `MATCHDAY_PASSWORD`, `MATCHDAY_SESSION_SECRET`. A Mac never holds a database credential:

1. On the page: sign in, open **Connections → Fleet machines**, and mint a fleet token. It is shown once.
2. On the Mac, in the repository's `.env` (never committed): `CLUB_RELAY_URL=https://<the deployment>` and `CLUB_RELAY_TOKEN=<the token>`. `CLUB_MACHINE` sets how the Mac is labelled.
3. From then on every match queues its rows in the log's outbox and sends them while it runs (every `var.flush_ms`, default 1 s) and once more at the end. A failed send never stops a match; the rows wait.

```bash
ogsf relay status                 # is a relay set up, and how many rows wait
ogsf relay push                   # send what is queued now
ogsf relay push --all             # queue the whole log first (a backfill of older matches)
```

Revoking the token on the page stops that Mac at its next send. The page's own demo (a recorded tour) needs no backend at all; `ogsf demo --serve` shows the same tour locally.

## Diagnose a finished match

```bash
ogsf highlights-match <match_id>  # one text file: the match row, every objective, every event,
                                  # every qa command.log and every match report
ogsf post-match <match_id>        # a ranger reads that file and writes a post-mortem
```

`post-match` runs `scout-opposition` with a fixed brief: what the match tried, where the money and time went (by objective), which prompts or calls were wasteful, what the fleet should have done, and the top five adjustments ranked by cost. The ranger is read-only in the repository, so the post-mortem lands in the **new** match's `torch_pass/post_mortem.md`. Run `highlights-match` first; `post-match` refuses without the bundle.

## When a match is stuck

A hung club produces no events at all, so the match goes quiet rather than red. Read it in this order:

```bash
ogsf passages <match_id>          # which objective is still `running`
ogsf on-pitch <match_id>          # what it is actually running, with pids
```

`on-pitch` rows are the live ones: the `setpiece` row is the `ogsf` process itself, a `player` row is a club child. If a player row exists but its objective has produced no `ability_cast` events and its `raw_output.jsonl` is empty, the club never got started properly — check that the model resolves and that nothing blocks the child, rather than waiting it out.

To stop it, send SIGTERM (or Ctrl-C) to the **setpiece** pid — check first that its `command` still matches what `on-pitch` recorded, because pids get recycled. The match finalizes itself: it records a turnover, kills the running club or qa check **and their children** (each runs in its own process group), closes its process rows, and exits 128 + the signal. The record never claims work is in flight that is already dead.

## Report

Tell the founder, in order: the set piece and roster, which objective is running (or which failed), objective statuses in sequence, and for a failure the official-review violations or the error verbatim. An objective that shows `turnover` may simply never have completed; `queued` means it never started. A match abandoned (exit 75) is a provider stop, not a verdict on the work — say so.
