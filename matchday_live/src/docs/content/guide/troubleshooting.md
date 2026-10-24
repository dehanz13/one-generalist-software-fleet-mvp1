# Troubleshooting

When a match surprises you, the record already knows why. Start from the
exit code, then read the match.

## Exit codes

| Code | What happened | What to do |
|---|---|---|
| `0` | accepted | nothing |
| `1` | not accepted: a review, the suite, the contract or a ruling said no; or an error before the match could start | read the closing banner, then `ogsf passages <match_id>` |
| `2` | the kickoff checklist refused; nothing ran, nothing was spent | the banner lists each check; fix the one that failed, or `--skip-kickoff` if you know better |
| `75` | match abandoned: the model provider failed (no credits, a rate limit, an outage). No review was red | check your provider account; run the same command again later |
| `128+n` | stopped by signal `n`: `130` is Ctrl-C, `143` is a `kill` | the match is recorded up to the moment it stopped |

## Reading a match

```sh
ogsf matches                         # find the match id
ogsf passages <match_id>             # which objective failed, and its error
ogsf live-feed <match_id>            # the last 25 events
ogsf highlights-match <match_id>     # the whole record in one text file
ogsf post-match <match_id>           # the ranger reads it and recommends changes
```

On Matchday Live, open the match and click the failed objective: you see
the report the player handed back, every official review with each check,
and the exact team talk it was sent. Most turnovers explain themselves
there.

## Configuration mistakes

These all fail in the first second, before any player spawns, and name
every problem at once:

| Message | Cause | Fix |
|---|---|---|
| `player "x" is not defined in the config — available: [...]` | a set piece or playbook names a player your config lacks | add the player, or fix the name |
| `player "x": system team talk not found: …` | the `team_talks` path is wrong or the file is missing | `ogsf incorporate` stamps the starters; check the path |
| `model pattern "…" not found in pi --list-models` | pi does not know that model, or is not signed in for that provider | write the model as `provider/model-id`; check `pi --list-models` and your key |
| `model pattern "…" is ambiguous` | a bare model name matches more than one provider | add the provider: `anthropic/…` |
| `club "claude_code" is not implemented yet (pi or scripted)` | the `claude_code` club has no driver yet | use `club: pi` |
| `qa check "x": operation "y" is not lint, typecheck, build or test` | a typo in `qa.checks` | use one of the four |
| a playbook step "only restates its name" | a step's `description` repeats the step | write one sentence on what the step is for |

A missing provider key does **not** fail at startup (the fleet never reads
keys; pi does). It fails when that player first runs, with pi's own
message in the objective's error.

## The kickoff checklist refused

| Check | Usual fix |
|---|---|
| working tree clean | commit or stash what is there: it would ride along in `git add -A` |
| on a feature branch | `git switch -c feature/<name>`: the plan commit must not land on `main`, `develop` or `release/*` |
| spec matches branch | a quest spec runs from `feature/<spec file name without .md>` |
| spec committed | commit the spec first: the match is held to the committed text |
| quest not already merged | it already landed; there is nothing to do |
| difficulty matches | run the set piece the contract names |
| work remains | the precondition says the work is done already |

## The relay

| Symptom | Cause | Fix |
|---|---|---|
| `ogsf relay status` says no relay | `CLUB_RELAY_URL` or `CLUB_RELAY_TOKEN` missing | add both to the repository's `.env` |
| `Matchday Live answered 401 …: this fleet token is unknown or revoked` | the token is wrong or was revoked | mint a new token on Connections |
| `… This deployment has no database yet: set DATABASE_URL …` | the deployment has no `DATABASE_URL` | set it in Vercel and redeploy, then **Apply the schema** on Connections |
| `relay: … (rows stay queued …)` | the Mac was offline | nothing is lost: `ogsf relay push` sends the rest |
| matches from before the relay are missing | the relay only sends new rows | `ogsf relay push --all` backfills the whole log |
| the page shows nothing from a Mac | the page reads another source | **Connections → What this page reads → This deployment** |

## Matchday Live

- **The page says it cannot reach a fleet.** `ogsf var` must be running,
  and a page on another origin needs `ogsf var --allow-origin <that origin>`.
- **Signed out every week.** The sign-in cookie lasts seven days by design.
- **The demo instead of my data.** A link with `?demo`, or Connections set to
  the demo recording. Choose another source on Connections.

## The Scheduler

- **A ticket never starts.** `ogsf upcoming` shows its status and any
  problem reading it. Only `mode: auto` tickets start by themselves, and
  only when due; check `time:` and the zone (`timezone:` in the file or
  `upcoming.timezone`).
- **A request stays queued.** The Mac needs `scheduler.accept_remote: true`,
  `ogsf scheduler` running, and (for a request from the cloud) its relay
  set up. A request by set piece name must be in `allowed_set_pieces`.
- **A request was refused.** `ogsf requests` (or `request_status` in the
  Claude app) shows the reason.
- **Nothing happens while a match runs.** One match at a time, always: the
  next starts when this one ends.
