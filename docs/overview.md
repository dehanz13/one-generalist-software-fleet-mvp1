# What OGSF is

**One Generalist Software Fleet (OGSF)** turns a written request into
finished, committed work in your own repository. You describe what you want;
a team of AI *players* plans it, builds it, tests it and writes it up; and
plain code, not a model, decides at every step whether the work may go on.

The idea under all of it is simple: **the player proposes, the code
disposes.** A model is good at reading a codebase and writing a change. It is
not a reliable judge of whether its own change is finished, whether it
touched only what it was allowed to, or whether the tests really passed. So
OGSF never asks it to be. The order of work, the checks, the retries and the
final verdict are ordinary Go code that does the same thing every time.

![The fleet's components](diagrams/components.svg)

## Where it came from

OGSF is built on **[Super Simple Software Factory](https://github.com/disler/super-simple-software-factory)
by IndyDevDan** (MIT licence). The design is his: plain code owns the order
of work, and agents are bounded steps inside it. Everything below rests on
that idea, and renaming the parts does not change who designed them.

Danniel added the parts that make a run refuse to waste money or ship
something unverified:

- the **kickoff checklist**, which refuses a match before it spends a token;
- the **quest contract**, the part of a spec a machine can hold a match to;
- the **ruling stop**, which ends a match when the planner finds nothing to build;
- the **progressive gate**, where only *new* lint and type problems fail a quest;
- the **commit normaliser**, so every commit message passes the repository's own rules;
- **match abandoned**, which tells a provider outage apart from bad work;
- the **spec tools** (`spec-area`, `spec-types`, `fire-drill`, `shape-search`).

This Go version adds **Matchday Live** (watch every match live, on your Mac
or from anywhere), the **relay** that mirrors your matches to the cloud, the
**scripted club** (a demo and tests that spend no tokens), **Upcoming
Matches** and the **Scheduler** (planned work that runs itself), and the
**Claude connector** (drive the fleet from the Claude app).

## How a match goes, in one paragraph

You run a *set piece*, such as `ogsf run-heroic "add a match timer"`. That
starts a *match*: a recorded run made of *objectives* in a fixed order. Some
objectives belong to players (the playmaker writes a spec, the builder
changes the code, the safety officer reviews it, the bard documents it).
Others belong to the *referee*, which is plain code: it runs your lint,
type-check, test and build commands, checks the spec's contract and makes
the git commits. Each player hands back a typed *match report*; the next
player gets it as its starting point. Every reply is checked by *official
reviews* before anything moves on, and a reply that fails is corrected in
the same conversation. When the match ends you get an exit code you can
script against and a full record you can replay.

## Why it is shaped this way

A few beliefs explain most of the design. They are worth holding on to,
because they tell you what to expect when something goes wrong.

- **A known command is not a judgement call.** If you can write the
  command down (`npm test`, `go vet`), it runs as code. Players are for the
  parts that need reading and deciding.
- **A failure is information, not an ending.** A red test suite does not
  fail the test objective (that objective did its job); it becomes a report
  that goes back to the builder, word for word. Only running out of *extra
  time* fails the match.
- **Permission is checked after the fact.** A player with a shell can run
  anything, so OGSF does not pretend a tool list is a sandbox. It compares
  the working tree before and after each player and rolls back anything the
  player was not allowed to change.
- **Every step leaves a row.** Each objective, tool call, report and review
  is written to `match_log.db` the moment it happens. That record is what
  Matchday Live shows, what the reports are computed from, and what you read
  when a match surprises you.

## The words it uses

The fleet speaks a football vocabulary that Danniel picked. The full table,
with every legacy name and its Go name, is in
[`wiki/VOCABULARY.md`](../../wiki/VOCABULARY.md). These are the ones you
will meet first:

| Word | What it means | Plain-English equivalent |
|---|---|---|
| set piece | a runnable chain of objectives, one command each | a workflow |
| match | one run of a set piece, with an id | a run, a session |
| objective | one step of a match: `spec`, `build`, `qa` … | a phase |
| difficulty | how strict a set piece is: `run-normal`, `run-heroic`, `run-mythic` | a lane |
| founder | you, the person who asks | the engineer |
| player | a configured AI role: playmaker, builder, ranger, safety officer, bard | an agent |
| club | the program that runs a player's model (`pi`, or `scripted`) | the coding agent |
| head coach · player · referee | who owns an objective: you, a model, or plain code | engineer · agent · code |
| match report | the typed JSON a player hands back | an envelope |
| official review | code that checks a match report's claims | a gate |
| torch pass | the folder where players leave files for the next one | a context hand-off |
| team talk | what a player is told: its system and user prompt | a prompt |
| touchdown · turnover | an objective or match passed · did not | success · failure |
| extra time | the bounded repair loop, at most 3 rounds | the fix loop |
| quest | one slice of a larger piece of work, with its own spec | a slice |
| ruling | the playmaker's verdict: `implement`, `noop` or `blocked` | a verdict |
| line of scrimmage | the lint and type problems that existed before the build | a baseline |
| kickoff checklist | checks that refuse a match before it starts | preflight |
| restricted area | paths no player may change unless it names them | protected files |
| match log | `match_log.db`, the record of every match | the trace database |
| Matchday Live | the page that shows matches live | the visualiser |
| `ogsf var` | serves Matchday Live from this Mac | `obs` |

## Where to go next

- New here? Start with the [Guide](guide/install.md): install, a first
  match, and your own workflows.
- Want the parts in detail? Read [the components](components.md), then
  [the set pieces](set-pieces.md).
- Want to know why a match stopped? See
  [safety and checks](safety.md) and [troubleshooting](guide/troubleshooting.md).
