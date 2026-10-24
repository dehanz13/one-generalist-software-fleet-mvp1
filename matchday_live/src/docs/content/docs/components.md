# The components

This page walks through every part of the fleet: what it is, where it lives,
and why it exists. If you only want to *use* the fleet, the
[Guide](guide/install.md) is shorter. Read this when you want to know what
is going on underneath, or when something surprises you.

## The shape of a match

Before the parts, the motion. Here is one `ogsf run-heroic` match, drawn as a
sequence: who hands what to whom, in order. Notice that the players never
talk to each other directly. Plain code sits in the middle of every
exchange, hands each player the previous report, and checks every reply.

![A match, step by step](diagrams/match-sequence.svg)

Three things in that picture are worth slowing down for:

1. **The red loop near the top.** The playmaker's first reply failed an
   official review. The correction went back into the *same* conversation,
   so the playmaker kept everything it had already read. A cold restart
   would have paid for all of that reading again.
2. **The referee is code.** Committing, running the qa checks and diffing
   are not jobs for a model. The referee lifeline is the `qa`, `contract` and
   `gitops` packages.
3. **Extra time is bounded.** When the tests come back red, the builder gets
   the failures word for word and tries again, at most three rounds. A loop
   that could run forever would be a loop that could spend forever.

## On your Mac

### `ogsf`, the one binary

Everything runs through one Go program, `ogsf` (`cmd/ogsf/`). Its commands
fall into five groups, which `ogsf --help` prints:

| Group | Commands |
|---|---|
| Set pieces | `ask`, `scout-opposition`, `team-talk`, `talk-attack`, `attack`, `attack-var`, `attack-review`, `run-normal`, `run-heroic`, `run-mythic`, `bard`, `qa`, `play` |
| Watch and diagnose | `matches`, `passages`, `live-feed`, `on-pitch`, `highlights-match`, `post-match`, `var`, `relay status`, `relay push` |
| Plan and schedule | `upcoming`, `upcoming run`, `scheduler`, `request`, `requests` |
| Set up | `incorporate`, `onboard`, `write-playbook`, `demo` |
| Spec tools | `spec-area`, `spec-types`, `fire-drill`, `shape-search` |

`ogsf` reads a `.env` file at the root of your repository on start, so keys
and relay settings work without exporting them. A variable already set in
your shell wins.

### Set pieces

A *set piece* is one runnable chain of objectives, one command each
(`set_pieces/setpiece_*.go`). There are thirteen, from a single question
(`ogsf ask`) to the strict, contract-checked quest (`ogsf run-mythic`).
[The set pieces](set-pieces.md) describes each one and when to reach for it.

Set pieces stay thin on purpose. A set piece decides the *order* of
objectives and whether the match is *accepted*; everything else lives in
`backroom_staff/`, so two set pieces that both "build, then test" share one
implementation of building and one of testing.

### The match runner

The `match` package is the engine every set piece stands on. It binds the
config, the match id, each player's club session, the match feed and the
console once, and offers one primitive: run an *objective*. An objective
records its start, runs, records its end, and becomes a touchdown or a
turnover. A player objective also runs the player call: render the team
talk, send it through the club, parse the reply, run the official reviews,
check the restricted area. [Players and match reports](players.md) shows
that loop in a diagram.

Every set piece ends in one call, `Finish(accepted, reason)`, which decides
the exit code, the match status and the closing banner together, so the
three can never disagree.

### Players and clubs

A *player* is a configured role: a name, a purpose, a model, a thinking
level, its tools, what it may change (`writes`), and its team talks. The
shipped roster has five: **playmaker** (plans), **builder** (changes code),
**ranger** (finds things, changes nothing), **safety officer** (reviews,
changes nothing) and **bard** (writes documentation). You can add your own.

A *club* is the program that actually runs a player's model. Today that is
**pi**, run with your own provider keys, or **scripted**, which plays
recorded replies so the tests and `ogsf demo` spend nothing. `claude_code`
is accepted by the config and refused at validation until its driver exists.
The fleet never holds a provider key: pi does.

### The referee: plain code that judges

The referee is not one package but several, each owning a kind of check:

| Package | What it decides |
|---|---|
| `officialreview` | whether a match report's claims are true (files exist, are not empty, changed as claimed) |
| `restrictedarea` | whether a player changed only what it may; rolls back the rest |
| `qa` | runs your lint, typecheck, test and build commands, with time limits; the progressive gate |
| `contract` | reads a quest spec's ` ```ogsf ` block and checks it: scope, precondition, the spec's own checks |
| `kickoff` | the kickoff checklist: refuses a match before it spends a token |
| `ruling` | ends a match at the spec when the playmaker rules `noop` or `blocked` |
| `gitops`, `changes`, `commitmsg` | commits, diffs, and commit headers that pass Conventional Commits |
| `abandoned` | tells a provider outage (exit 75) apart from bad work (exit 1) |

[Safety and checks](safety.md) explains each in depth.

### The club config

`set_pieces/boardroom/club.config.yaml` describes the fleet for *this*
repository: the `project` block (its name and club rules), `defaults` for
every player, the `players`, the `qa` checks, the match log location, and
the `upcoming` and `scheduler` sections. `ogsf incorporate` stamps a
commented copy; from then on it is yours. Everything under
`set_pieces/boardroom/` is in the restricted area, so no player can edit the
rules it is judged by.

### The clubhouse: the match's own files

Each match has a folder, `set_pieces/clubhouse/matches/<match_id>/`, with a
sub-folder per player and a `torch_pass/` folder where players leave files
for each other (the playmaker's `plan.md`, for example). The raw match feed
(`match_feed.jsonl`), the saved reports and the exact team talks sent are
there too. This folder is runtime: every player may always write there,
even a read-only one.

### The match log

`set_pieces/clubhouse/match_log.db` is a SQLite file (WAL mode, so readers
never block the writer) holding every match on this Mac: matches,
objectives, events, match reports, official reviews, processes, club
sessions, team talks, Upcoming Matches and requests. Each row is written
the moment it happens. [The match log](match-log.md) lists every table.

### `ogsf var`

`ogsf var` serves [Matchday Live](matchday-live.md) on
`http://127.0.0.1:4600`, built into the binary, reading this Mac's match
log. It listens on your Mac only, and pushes new rows to the page as
server-sent events, so a match you are running appears as it runs.

### The relay

When `.env` holds `CLUB_RELAY_URL` and `CLUB_RELAY_TOKEN`, every row the
match feed writes is also queued in a `relay_outbox` table, and the relay
sends the queue to your Matchday Live deployment every second while a match
runs, plus once more when it ends. A Mac that is offline keeps the rows and
sends them later; `ogsf relay push` sends them by hand. The match never
waits for the network.

### Upcoming Matches and the Scheduler

*Upcoming Matches* are planned tickets with a date, written as Markdown in
`set_pieces/upcoming/*.md`. `ogsf scheduler` is a long-running process that
starts each `auto` ticket when it is due and, if you allow it, runs the
requests made from Matchday Live or the Claude app. One match at a time,
always. [Upcoming Matches and the Scheduler](upcoming.md) has the details.

### The spec tools

Four commands that measure a codebase before you write a quest spec, so the
numbers in the spec are real: `spec-area` and `spec-types` write quest specs
from measurements, `fire-drill` reviews a test-rewriting quest after the
fact, and `shape-search` finds code with a given shape.

### The demo

`ogsf demo` runs a tour of every set piece and command, for real, through
the same engine, against a throwaway repository, with every player on the
scripted club. No token is spent and nothing outside the tour's folder
changes. `ogsf demo --serve` opens Matchday Live on the result.

## In your cloud (optional)

### Matchday Live on Vercel

The same page as `ogsf var`, deployed to your own Vercel account, with an
API that reads Supabase instead of a SQLite file. It answers the same
paths with the same JSON, so the page never needs to know which one it is
talking to. It is protected by a password you set, and it also hosts the
Claude connector. See [Matchday Live](matchday-live.md).

### Supabase

A Postgres database that mirrors the match logs of every Mac you connect.
The cloud is a mirror, never the source: each Mac's own `match_log.db` is
the record, so losing the cloud loses nothing.

### The Claude connector

A remote MCP server at `https://<your app>/api/mcp`. Add it to the Claude
app as a custom connector, sign in with your page password, and you can ask
for reports, look at matches and queue work. See
[Remote control](remote.md).

## Around the fleet

### The Claude Code plugin

`plugin/` teaches Claude Code to run and observe the fleet through the
`ogsf` binary: launch set pieces, write playbooks, retune players, read
matches, plan sprints, and pull reports. It never does a player's work
itself. Install it with `claude --plugin-dir ./modernized/plugin` for one
session (more in `plugin/README.md`).

### Templates

`templates/` is what `ogsf incorporate` stamps into a repository: the club
config, the players' team talks, the subagent enchantment, the spec tools'
helpers, `.env.sample`, and the `.gitignore` lines for the runtime files.
