import{n as e,t}from"./chevron-right-DqaeVlxU.js";import{t as n}from"./download-DOhgEyIr.js";import{C as r,S as i,_ as a,f as o,h as s,w as c,x as l,y as u}from"./index-DWX8qYWy.js";import{l as d,o as f,s as p,t as m}from"./report-DGdAzc02.js";var h={name:`book-open`,size:24,node:[[`path`,{d:`M12 5v16`,key:`1f6ucr`}],[`path`,{d:`M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z`,key:`1fyvmf`}]]};h.node;var ee=r(h),g={name:`compass`,size:24,node:[[`circle`,{cx:`12`,cy:`12`,r:`10`,key:`1mglay`}],[`path`,{d:`m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z`,key:`9ktpf1`}]]};g.node;var te=r(g),_={name:`link-2`,size:24,node:[[`path`,{d:`M9 17H7A5 5 0 0 1 7 7h2`,key:`8i5ue5`}],[`path`,{d:`M15 7h2a5 5 0 1 1 0 10h-2`,key:`1b9ql8`}],[`line`,{x1:`8`,x2:`16`,y1:`12`,y2:`12`,key:`1jonct`}]]};_.node;var ne=r(_),v={name:`maximize-2`,size:24,node:[[`path`,{d:`M15 3h6v6`,key:`1q9fwt`}],[`path`,{d:`m21 3-7 7`,key:`1l2asr`}],[`path`,{d:`m3 21 7-7`,key:`tjx5ai`}],[`path`,{d:`M9 21H3v-6`,key:`wtvkvv`}]]};v.node;var y=r(v),b={name:`menu`,size:24,node:[[`path`,{d:`M4 5h16`,key:`1tepv9`}],[`path`,{d:`M4 12h16`,key:`1lakjw`}],[`path`,{d:`M4 19h16`,key:`1djgab`}]]};b.node;var re=r(b),x=c(),ie="# The components\n\nThis page walks through every part of the fleet: what it is, where it lives,\nand why it exists. If you only want to *use* the fleet, the\n[Guide](guide/install.md) is shorter. Read this when you want to know what\nis going on underneath, or when something surprises you.\n\n## The shape of a match\n\nBefore the parts, the motion. Here is one `ogsf run-heroic` match, drawn as a\nsequence: who hands what to whom, in order. Notice that the players never\ntalk to each other directly. Plain code sits in the middle of every\nexchange, hands each player the previous report, and checks every reply.\n\n![A match, step by step](diagrams/match-sequence.svg)\n\nThree things in that picture are worth slowing down for:\n\n1. **The red loop near the top.** The playmaker's first reply failed an\n   official review. The correction went back into the *same* conversation,\n   so the playmaker kept everything it had already read. A cold restart\n   would have paid for all of that reading again.\n2. **The referee is code.** Committing, running the qa checks and diffing\n   are not jobs for a model. The referee lifeline is the `qa`, `contract` and\n   `gitops` packages.\n3. **Extra time is bounded.** When the tests come back red, the builder gets\n   the failures word for word and tries again, at most three rounds. A loop\n   that could run forever would be a loop that could spend forever.\n\n## On your Mac\n\n### `ogsf`, the one binary\n\nEverything runs through one Go program, `ogsf` (`cmd/ogsf/`). Its commands\nfall into five groups, which `ogsf --help` prints:\n\n| Group | Commands |\n|---|---|\n| Set pieces | `ask`, `scout-opposition`, `team-talk`, `talk-attack`, `attack`, `attack-var`, `attack-review`, `run-normal`, `run-heroic`, `run-mythic`, `bard`, `qa`, `play` |\n| Watch and diagnose | `matches`, `passages`, `live-feed`, `on-pitch`, `highlights-match`, `post-match`, `var`, `relay status`, `relay push` |\n| Plan and schedule | `upcoming`, `upcoming run`, `scheduler`, `request`, `requests` |\n| Set up | `incorporate`, `onboard`, `write-playbook`, `demo` |\n| Spec tools | `spec-area`, `spec-types`, `fire-drill`, `shape-search` |\n\n`ogsf` reads a `.env` file at the root of your repository on start, so keys\nand relay settings work without exporting them. A variable already set in\nyour shell wins.\n\n### Set pieces\n\nA *set piece* is one runnable chain of objectives, one command each\n(`set_pieces/setpiece_*.go`). There are thirteen, from a single question\n(`ogsf ask`) to the strict, contract-checked quest (`ogsf run-mythic`).\n[The set pieces](set-pieces.md) describes each one and when to reach for it.\n\nSet pieces stay thin on purpose. A set piece decides the *order* of\nobjectives and whether the match is *accepted*; everything else lives in\n`backroom_staff/`, so two set pieces that both \"build, then test\" share one\nimplementation of building and one of testing.\n\n### The match runner\n\nThe `match` package is the engine every set piece stands on. It binds the\nconfig, the match id, each player's club session, the match feed and the\nconsole once, and offers one primitive: run an *objective*. An objective\nrecords its start, runs, records its end, and becomes a touchdown or a\nturnover. A player objective also runs the player call: render the team\ntalk, send it through the club, parse the reply, run the official reviews,\ncheck the restricted area. [Players and match reports](players.md) shows\nthat loop in a diagram.\n\nEvery set piece ends in one call, `Finish(accepted, reason)`, which decides\nthe exit code, the match status and the closing banner together, so the\nthree can never disagree.\n\n### Players and clubs\n\nA *player* is a configured role: a name, a purpose, a model, a thinking\nlevel, its tools, what it may change (`writes`), and its team talks. The\nshipped roster has five: **playmaker** (plans), **builder** (changes code),\n**ranger** (finds things, changes nothing), **safety officer** (reviews,\nchanges nothing) and **bard** (writes documentation). You can add your own.\n\nA *club* is the program that actually runs a player's model. Today that is\n**pi**, run with your own provider keys, or **scripted**, which plays\nrecorded replies so the tests and `ogsf demo` spend nothing. `claude_code`\nis accepted by the config and refused at validation until its driver exists.\nThe fleet never holds a provider key: pi does.\n\n### The referee: plain code that judges\n\nThe referee is not one package but several, each owning a kind of check:\n\n| Package | What it decides |\n|---|---|\n| `officialreview` | whether a match report's claims are true (files exist, are not empty, changed as claimed) |\n| `restrictedarea` | whether a player changed only what it may; rolls back the rest |\n| `qa` | runs your lint, typecheck, test and build commands, with time limits; the progressive gate |\n| `contract` | reads a quest spec's ` ```ogsf ` block and checks it: scope, precondition, the spec's own checks |\n| `kickoff` | the kickoff checklist: refuses a match before it spends a token |\n| `ruling` | ends a match at the spec when the playmaker rules `noop` or `blocked` |\n| `gitops`, `changes`, `commitmsg` | commits, diffs, and commit headers that pass Conventional Commits |\n| `abandoned` | tells a provider outage (exit 75) apart from bad work (exit 1) |\n\n[Safety and checks](safety.md) explains each in depth.\n\n### The club config\n\n`set_pieces/boardroom/club.config.yaml` describes the fleet for *this*\nrepository: the `project` block (its name and club rules), `defaults` for\nevery player, the `players`, the `qa` checks, the match log location, and\nthe `upcoming` and `scheduler` sections. `ogsf incorporate` stamps a\ncommented copy; from then on it is yours. Everything under\n`set_pieces/boardroom/` is in the restricted area, so no player can edit the\nrules it is judged by.\n\n### The clubhouse: the match's own files\n\nEach match has a folder, `set_pieces/clubhouse/matches/<match_id>/`, with a\nsub-folder per player and a `torch_pass/` folder where players leave files\nfor each other (the playmaker's `plan.md`, for example). The raw match feed\n(`match_feed.jsonl`), the saved reports and the exact team talks sent are\nthere too. This folder is runtime: every player may always write there,\neven a read-only one.\n\n### The match log\n\n`set_pieces/clubhouse/match_log.db` is a SQLite file (WAL mode, so readers\nnever block the writer) holding every match on this Mac: matches,\nobjectives, events, match reports, official reviews, processes, club\nsessions, team talks, Upcoming Matches and requests. Each row is written\nthe moment it happens. [The match log](match-log.md) lists every table.\n\n### `ogsf var`\n\n`ogsf var` serves [Matchday Live](matchday-live.md) on\n`http://127.0.0.1:4600`, built into the binary, reading this Mac's match\nlog. It listens on your Mac only, and pushes new rows to the page as\nserver-sent events, so a match you are running appears as it runs.\n\n### The relay\n\nWhen `.env` holds `CLUB_RELAY_URL` and `CLUB_RELAY_TOKEN`, every row the\nmatch feed writes is also queued in a `relay_outbox` table, and the relay\nsends the queue to your Matchday Live deployment every second while a match\nruns, plus once more when it ends. A Mac that is offline keeps the rows and\nsends them later; `ogsf relay push` sends them by hand. The match never\nwaits for the network.\n\n### Upcoming Matches and the Scheduler\n\n*Upcoming Matches* are planned tickets with a date, written as Markdown in\n`set_pieces/upcoming/*.md`. `ogsf scheduler` is a long-running process that\nstarts each `auto` ticket when it is due and, if you allow it, runs the\nrequests made from Matchday Live or the Claude app. One match at a time,\nalways. [Upcoming Matches and the Scheduler](upcoming.md) has the details.\n\n### The spec tools\n\nFour commands that measure a codebase before you write a quest spec, so the\nnumbers in the spec are real: `spec-area` and `spec-types` write quest specs\nfrom measurements, `fire-drill` reviews a test-rewriting quest after the\nfact, and `shape-search` finds code with a given shape.\n\n### The demo\n\n`ogsf demo` runs a tour of every set piece and command, for real, through\nthe same engine, against a throwaway repository, with every player on the\nscripted club. No token is spent and nothing outside the tour's folder\nchanges. `ogsf demo --serve` opens Matchday Live on the result.\n\n## In your cloud (optional)\n\n### Matchday Live on Vercel\n\nThe same page as `ogsf var`, deployed to your own Vercel account, with an\nAPI that reads Supabase instead of a SQLite file. It answers the same\npaths with the same JSON, so the page never needs to know which one it is\ntalking to. It is protected by a password you set, and it also hosts the\nClaude connector. See [Matchday Live](matchday-live.md).\n\n### Supabase\n\nA Postgres database that mirrors the match logs of every Mac you connect.\nThe cloud is a mirror, never the source: each Mac's own `match_log.db` is\nthe record, so losing the cloud loses nothing.\n\n### The Claude connector\n\nA remote MCP server at `https://<your app>/api/mcp`. Add it to the Claude\napp as a custom connector, sign in with your page password, and you can ask\nfor reports, look at matches and queue work. See\n[Remote control](remote.md).\n\n## Around the fleet\n\n### The Claude Code plugin\n\n`plugin/` teaches Claude Code to run and observe the fleet through the\n`ogsf` binary: launch set pieces, write playbooks, retune players, read\nmatches, plan sprints, and pull reports. It never does a player's work\nitself. Install it with `claude --plugin-dir ./modernized/plugin` for one\nsession (more in `plugin/README.md`).\n\n### Templates\n\n`templates/` is what `ogsf incorporate` stamps into a repository: the club\nconfig, the players' team talks, the subagent enchantment, the spec tools'\nhelpers, `.env.sample`, and the `.gitignore` lines for the runtime files.\n",ae='# The match log and its data contract\n\nEvery match leaves a complete record, written as it happens. That record has\none shape in three places:\n\n1. **On the Mac that ran it**, in `set_pieces/clubhouse/match_log.db`\n   (SQLite, in WAL mode so readers never block the writer), plus a raw\n   `match_feed.jsonl` in the match\'s folder.\n2. **Through `ogsf var`**, which serves that file as an HTTP API on\n   `http://127.0.0.1:4600`.\n3. **In your cloud**, where Matchday Live on Vercel serves the same API from\n   Supabase, filled by each Mac\'s relay.\n\nThe page never knows which of the three it is reading: same paths, same\nJSON. The database is private; **the API is the public contract**. The full\ncontract, column by column, is [`wiki/DATA-CONTRACT.md`](../../wiki/DATA-CONTRACT.md).\n\n## The tables\n\n| Table | One row per | Worth knowing |\n|---|---|---|\n| `matches` | match | set piece, the ask, status, founder, project, machine, start and end, total tokens and cost, and (since version 2) the `ticket_id` it played |\n| `objectives` | objective | its order (`seq`), kind (head coach, player or referee), owner, description, status, attempts, error |\n| `events` | thing that happened | objective and player starts and ends, every tool call (`ability_cast`), hand-overs (`trade`), review results, logs and errors |\n| `match_reports` | reply a player gave | the report type, its JSON, whether it was valid, which attempt |\n| `official_reviews` | review run | passed or not, the violations and every check |\n| `processes` | child process | its pid and command, so `ogsf on-pitch` can say what is alive |\n| `club_sessions` | player in a match | club, model, colour, session id, how full its context window got |\n| `team_talks` | player in a match | the exact system and user prompt it was sent |\n| `upcoming_matches` | planned ticket | date, time, zone, due time, set piece, mode, status, the match that played it |\n| `requests` | "run this now" | who asked (page, connector, cli), what, for which Mac, its status |\n| `relay_outbox` | row waiting to be relayed | emptied as the relay sends |\n\nEvery time is an ISO-8601 UTC string with milliseconds, written by the\nengine, so sorting text sorts time.\n\n## Events\n\n`events.type` says what happened; `payload_json` holds the details.\n\n| Type | Name | Payload, in short |\n|---|---|---|\n| `objective_start` · `objective_end` | the objective | kind, owner, description · touchdown or turnover |\n| `raider_start` · `raider_end` | the player | model, thinking, colour, tools · tokens, cost, usage, context use |\n| `ability_cast` | `bash: ls -la`, or `qa:<check>` | a tool call (args, ok, a result snippet, duration) or a qa check (command, exit code, passed) |\n| `trade` | the player | what it handed to the next one |\n| `gear_check_pass` · `gear_check_fail` | the review | attempt, violations, checks |\n| `log` | the objective, or `console` | console lines and logged values |\n| `error` | the objective, `permission_breach` or `not_accepted` | what went wrong |\n\n`usage` on a `raider_end` breaks tokens down the way the provider counted\nthem: input (excluding cache reads), output, cache reads, cache writes,\nreasoning (the thinking share *of* output, never added to it), and each\none\'s cost. [Reports](measures.md) explains why those distinctions matter.\n\n## The API\n\nThe same on `ogsf var` and on Vercel. JSON, never cached, and every error\nis `{"error": "<what to do next>"}`.\n\n| Method · path | Answer |\n|---|---|\n| `GET /api/health` | which source this is, how many matches, which store |\n| `GET /api/matches` | every match with its objectives and players |\n| `GET /api/matches/:id` | one match: row, token usage, objectives, players |\n| `POST /api/matches/:id/archive` | archive or unarchive it |\n| `GET /api/matches/:id/events?after=<cursor>` | its events, from a cursor |\n| `GET /api/matches/:id/reports` · `/reviews` · `/processes` | the rest of its record |\n| `GET /api/matches/:id/players/:player/team-talks` | exactly what that player was told |\n| `GET /api/live` | server-sent events: new events, changed matches, a ping every 15 s |\n| `GET /api/report-facts?since=&until=` | every row a report needs for a period |\n| `GET /api/upcoming` | Upcoming Matches, by due time |\n| `GET /api/requests` · `POST /api/requests` | the requests, and making one |\n\nThe live stream carries a cursor as each message\'s id, so a dropped\nconnection resumes exactly where it stopped. The page is never asked to\npoll.\n\n## Inspecting from the terminal\n\n| Command | Shows |\n|---|---|\n| `ogsf matches` | the last ten matches |\n| `ogsf passages <match_id>` | a match\'s objectives, in order |\n| `ogsf live-feed <match_id>` | its latest 25 events |\n| `ogsf on-pitch <match_id>` | what it has alive right now, with pids |\n| `ogsf highlights-match <match_id>` | one text file with the whole record: rows, events, qa logs, reports |\n| `ogsf post-match <match_id>` | sends the ranger to read those highlights and recommend changes |\n',oe=`# Matchday Live

Matchday Live is the page where you watch the fleet: every match as it
plays, every player's lane, every tool call, report and review, and the
reports that sum it all up. It is one page that can read from three places,
always through the same API.

## The sections

| Section | Address | What it shows |
|---|---|---|
| Matches | \`#/\` | every match, newest first, with its objectives as a strip of touchdowns and turnovers |
| A match | \`#/m/<match_id>\` | the scoreboard, a lane per player, the timeline, the live feed, and each objective's reports, reviews and team talks |
| Daily reports | \`#/days\`, \`#/days/<date>\` | one card per day with matches: totals, cost, players, what went wrong |
| Multi-day report | \`#/report?from=<date>&to=<date>\` | any period, with each player's performance across it; download as PDF or Markdown |
| Upcoming Matches | \`#/upcoming\` | planned tickets by due time, their status, and the requests queue |
| Docs and Guide | \`#/docs\`, \`#/guide\` | these pages |
| Connections | \`#/connections\` | what the page reads, connecting a Mac, the cloud store and its fleet tokens |

Every address is a hash route, so the page works the same on Vercel,
inside the \`ogsf\` binary and from a plain file server.

## Where it reads from

Choose on **Connections → What this page reads**:

| Source | Where the data is | Who answers \`/api\` |
|---|---|---|
| **Demo recording** | a recording bundled with the page | nobody: it is replayed in your browser, as if live |
| **This deployment** | Supabase, or this Mac's match log | the Vercel functions, or \`ogsf var\` |
| **A fleet at an address** | a Mac running \`ogsf var\` | that Mac, read directly |

A link can ask for the demo by itself: add \`?demo\` to the address
(\`https://<your app>/?demo\`). That is the easiest way to show someone the
fleet without a fleet.

## How a row reaches the page

![Matchday Live: how a row reaches the page](diagrams/matchday-live-data-flow.svg)

Read the picture from the match runner down:

1. The engine writes each row to \`match_log.db\` the moment it happens. When
   a relay is set up, the same write also queues a copy in \`relay_outbox\`.
2. **Locally**, \`ogsf var\` reads the file and pushes new rows to the page
   as server-sent events. When the match runs inside the same process, it
   pushes them directly; otherwise it follows the file.
3. **To the cloud**, the relay sends the outbox to \`POST /api/ingest\` every
   second while a match runs (\`var.flush_ms\`, default 1000) and once more,
   for up to five seconds, when it ends. The server upserts each row by its
   primary key, in order, so sending a row twice is harmless.
4. **On Vercel**, \`GET /api/live\` follows Postgres by cursor once a second
   and streams what lands. The cloud closes a stream after about four
   minutes; the browser reconnects by itself and resumes from its cursor.

Because the Mac writes locally first, a match never waits on the network,
and an offline Mac loses nothing: the rows wait in the outbox until the next
send, or until you run \`ogsf relay push\`.

## The relay

A Mac relays only when its \`.env\` (or environment) has both:

\`\`\`sh
CLUB_RELAY_URL=https://<your app>.vercel.app
CLUB_RELAY_TOKEN=<a fleet token minted for this Mac>
\`\`\`

| Command | Does |
|---|---|
| \`ogsf relay status\` | is a relay set up, and how many rows wait |
| \`ogsf relay push\` | send every queued row now |
| \`ogsf relay push --all\` | queue this Mac's whole match log first, then send it (a backfill) |

A batch is at most 500 rows and 4 MB. Set \`CLUB_MACHINE\` to change how this
Mac is labelled on the page (the default is its host name).

## Supabase

The cloud store is a Postgres database on Supabase (the free plan is
enough). Its schema is \`supabase/migrations/\`, and the page applies it for
you from **Connections → Cloud store → Apply the schema**. The API reaches
it through Supabase's transaction pooler (port 6543). It holds the same
tables as a Mac's match log, filled from every Mac you connect, plus the
cloud-only ones: fleet tokens and the requests made on the page.

## Security

Three secrets, set only in Vercel's environment variables:

| Variable | What it is |
|---|---|
| \`DATABASE_URL\` | Supabase's transaction-pooler connection string |
| \`MATCHDAY_PASSWORD\` | the password for the page (and for the Claude connector's sign-in) |
| \`MATCHDAY_SESSION_SECRET\` | 32 or more random characters that sign the sign-in cookie |

Optional:

| Variable | What it is |
|---|---|
| \`MATCHDAY_TIMEZONE\` | the IANA zone (such as \`Europe/London\`) the Claude connector cuts report days in when a request does not name one; default UTC. The page itself always uses the viewer's own zone |
| \`MATCHDAY_CONNECTOR_REDIRECTS\` | extra hosts the connector's sign-in may send a browser back to, comma-separated. Without it: claude.ai, claude.com and localhost only |

- Signing in sets an HttpOnly, Secure, SameSite=Strict cookie for seven
  days. Every \`/api\` route needs it except \`/api/health\`, \`/api/session\`
  (signing in and out) and \`/api/ingest\` (which takes a fleet token).
- A fleet token is shown once when minted and stored only as a SHA-256
  hash. Revoking it on Connections stops that Mac at its next send.
- The page only ever learns the *names* of the variables and whether each
  is set, never their values.
- The demo needs nothing: it is a recording, replayed in the browser.
- Without \`DATABASE_URL\`, a deployment still works and plays the demo.

## The demo recording

The recording is made by \`ogsf demo\` itself: a tour of every set piece,
run through the real engine on the scripted club. So what the demo shows
is what a real fleet looks like, minus the tokens. \`make demo-data\`
regenerates it.
`,se=`# Reports and what they measure

A single match tells you whether one piece of work landed. Reports answer
the questions you can only ask across many: which player costs the most,
which one needs correcting, whether a cheaper model would do, and where the
time goes. Matchday Live has two: the **daily report** (\`#/days\`) and the
**multi-day report** for any period (\`#/report?from=<date>&to=<date>\`), and
both download as PDF or Markdown. The Claude connector answers with the
same Markdown.

Every report is computed from the same rows, by the same code
(\`shared/report.ts\`), on the page and in the connector, never in SQL. So a
report of the demo, of your Mac, and of the cloud agree by construction.

## The measures

### Outcomes

| Measure | What it counts | Why it is useful |
|---|---|---|
| matches · touchdowns · turnovers | matches by how they ended | the headline |
| abandoned | turnovers the provider caused (exit 75) | not a verdict on the work; keep them out of quality judgements |
| touchdown rate | a player's objectives that ended in a touchdown, out of all its objectives | the plainest sign a player is up to its job |
| first-try rate | objectives that passed with **no** corrected reply and every review green on the first attempt | the honest one: a touchdown after two corrections still cost three turns |
| extra time | objectives spent in \`iterate_*\` and \`revise_*\` | how often the first build was not good enough |
| corrected replies | replies that did not parse as the report asked, each corrected in the same session | a team talk that is unclear, or a model that struggles with the format |
| breaches | writes outside a player's fence, rolled back | should be zero; if not, read that player's team talk |
| not accepted | every objective passed, but the set piece's own test did not | the suite or the review stayed red |

### Tokens, three ways

Token counts are easy to misread, so a report shows them three ways:

- **Read**: input tokens plus cache *writes*: raw material the model read
  for the first time.
- **Written**: output tokens: what it generated. Reasoning (thinking) is a
  share *of* output, never added to it.
- **Billed**: what the provider counted, which re-counts cached context on
  every turn. A long session can bill many times what it read, mostly as
  cheap cache reads.

That is why **cache share** matters: cache reads ÷ (input + cache reads +
cache writes) for a player. A high share means most of its context was
served from cache, at a fraction of the price. It is also the quiet payoff
of correcting a reply *in the same session*: the context is still cached.

**Peak context** is the fullest a player's context window got (context
tokens ÷ window size). A player that runs near 100% is one long task away
from losing what it read at the start.

### Cost

Cost per match, per player and per objective, from the cost each club
reports. A player whose **cost per objective** is high and whose first-try
rate is low is the first place to look for savings.

## Per player, from the demo recording

These two charts are drawn live from the demo recording bundled with the
page (\`public/demo/matchday-demo.json\`), through the same report code as
every report. The recording is scripted, so its numbers show the shape of a
real report, not a real bill.

<!-- chart: cost-by-player -->

<!-- chart: tokens-by-player -->

On GitHub these charts do not render: open the Docs on any Matchday Live
deployment (or \`ogsf var\`) to see them, or open the multi-day report on the
demo with \`?demo\`.

## Where the time goes

Before the Go version was written, 32 strict runs of the Python factory
were measured. Building took 55% of the run time, planning 22% and
verifying 13% (source: \`wiki/GO-MIGRATION.md\`, section 5). The source does
not break down the remaining 10%.

<!-- chart: time-split -->

| Share of run time (32 strict runs) | |
|---|---|
| building | 55% |
| planning | 22% |
| verifying | 13% |
| the rest (not broken down in the source) | 10% |

The lesson the migration drew from it: that time is models thinking and
tests running, so a faster language does not make a match faster. Go buys
one file to install, clean control of child processes, and less that can go
wrong at the edges. If you want faster matches, the levers are the ones the
reports show you: a cheaper or faster model where first-try rates allow it,
fewer corrections, and less extra time.
`,ce=`# What OGSF is

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
- the **spec tools** (\`spec-area\`, \`spec-types\`, \`fire-drill\`, \`shape-search\`).

This Go version adds **Matchday Live** (watch every match live, on your Mac
or from anywhere), the **relay** that mirrors your matches to the cloud, the
**scripted club** (a demo and tests that spend no tokens), **Upcoming
Matches** and the **Scheduler** (planned work that runs itself), and the
**Claude connector** (drive the fleet from the Claude app).

## How a match goes, in one paragraph

You run a *set piece*, such as \`ogsf run-heroic "add a match timer"\`. That
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
  command down (\`npm test\`, \`go vet\`), it runs as code. Players are for the
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
  is written to \`match_log.db\` the moment it happens. That record is what
  Matchday Live shows, what the reports are computed from, and what you read
  when a match surprises you.

## The words it uses

The fleet speaks a football vocabulary that Danniel picked. The full table,
with every legacy name and its Go name, is in
[\`wiki/VOCABULARY.md\`](../../wiki/VOCABULARY.md). These are the ones you
will meet first:

| Word | What it means | Plain-English equivalent |
|---|---|---|
| set piece | a runnable chain of objectives, one command each | a workflow |
| match | one run of a set piece, with an id | a run, a session |
| objective | one step of a match: \`spec\`, \`build\`, \`qa\` … | a phase |
| difficulty | how strict a set piece is: \`run-normal\`, \`run-heroic\`, \`run-mythic\` | a lane |
| founder | you, the person who asks | the engineer |
| player | a configured AI role: playmaker, builder, ranger, safety officer, bard | an agent |
| club | the program that runs a player's model (\`pi\`, or \`scripted\`) | the coding agent |
| head coach · player · referee | who owns an objective: you, a model, or plain code | engineer · agent · code |
| match report | the typed JSON a player hands back | an envelope |
| official review | code that checks a match report's claims | a gate |
| torch pass | the folder where players leave files for the next one | a context hand-off |
| team talk | what a player is told: its system and user prompt | a prompt |
| touchdown · turnover | an objective or match passed · did not | success · failure |
| extra time | the bounded repair loop, at most 3 rounds | the fix loop |
| quest | one slice of a larger piece of work, with its own spec | a slice |
| ruling | the playmaker's verdict: \`implement\`, \`noop\` or \`blocked\` | a verdict |
| line of scrimmage | the lint and type problems that existed before the build | a baseline |
| kickoff checklist | checks that refuse a match before it starts | preflight |
| restricted area | paths no player may change unless it names them | protected files |
| match log | \`match_log.db\`, the record of every match | the trace database |
| Matchday Live | the page that shows matches live | the visualiser |
| \`ogsf var\` | serves Matchday Live from this Mac | \`obs\` |

## Where to go next

- New here? Start with the [Guide](guide/install.md): install, a first
  match, and your own workflows.
- Want the parts in detail? Read [the components](components.md), then
  [the set pieces](set-pieces.md).
- Want to know why a match stopped? See
  [safety and checks](safety.md) and [troubleshooting](guide/troubleshooting.md).
`,le='# Players, clubs and match reports\n\n## Players\n\nA player is a role, written down in `club.config.yaml`. One player, one\nprompt, one purpose: the playmaker only plans, the builder only builds. A\nnarrow role is easier to prompt, easier to check, and easier to swap for a\ncheaper model when it turns out to be easy.\n\n| Player | Purpose | May change | Report it hands back |\n|---|---|---|---|\n| playmaker | turn a request into a plan the builder can follow without asking | `specs/` only | `TalkReport` (with a ruling) |\n| builder | implement the plan exactly; report every changed file | anything outside the restricted area | `AttackReport` |\n| ranger | find and report where things live | nothing | `AnalystReport` |\n| safety officer | confirm what was built is what was asked | nothing | `VarReport` (approved or not) |\n| bard | write up the change, from the diff | documentation only | `BardReport` |\n\nThere is no tester player on purpose. Running a test suite is a known\ncommand, so it is a referee objective over your `qa.checks`, not a model\'s\njob. A model is only asked to *repair* what the suite reports.\n\n### What a player is made of\n\nEach entry under `players:` can set:\n\n| Key | What it does |\n|---|---|\n| `name` | how set pieces and playbooks refer to it |\n| `purpose` | one line; it is also shown on Matchday Live |\n| `model` | always `provider/model-id`, such as `anthropic/claude-sonnet-5-5`; a bare name is ambiguous across providers |\n| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max` |\n| `color` | the player\'s lane colour on Matchday Live (hex) |\n| `tools` | the club\'s tools it may call: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, plus any an enchantment adds |\n| `writes` | what it may change in the repository; leave it out for "anything outside the restricted area" |\n| `enchantments` | pi extensions loaded for it, such as the subagent tools |\n| `team_talks` | its `system.md` and `user.md` prompt files |\n\nAnything a player leaves out comes from `defaults:`. The shipped defaults\nput every player on `anthropic/claude-sonnet-5-5` at `medium` thinking, with\nthe ranger on `anthropic/claude-haiku-4-5` and the bard on\n`openai/gpt-5-mini`; change them to whatever your keys and budget allow.\n\n### Tools are not a sandbox\n\n`tools:` says what a player *can call*. It cannot make "this player changes\nnothing" true: `bash` runs anything, including `git checkout`, and `write`\nreaches any path. That is why `writes:` exists, and why it is enforced\nafter every call rather than trusted. See the restricted area in\n[safety and checks](safety.md#the-restricted-area).\n\n### Team talks\n\nA *team talk* is what a player is told: `system.md` (who it is, how it\nworks) and `user.md` (the task shape, with the match report it must hand\nback). They live in `set_pieces/clubhouse/team_talks/<player>/`, and the\nexact text sent in each match is kept, so Matchday Live can show you\nprecisely what a player was asked. The project\'s `club_rules` become a\n"Club rules" section in every system prompt.\n\n## Clubs and models\n\nA *club* is the program that runs a player\'s model. The fleet starts it,\nhands it the team talk and reads what it says back; it never calls a model\nprovider itself and never holds a key.\n\n| Club | What it is |\n|---|---|\n| `pi` | the real one: the pi coding agent, with your own Anthropic or OpenAI keys from `.env` |\n| `scripted` | plays recorded replies instead of a model; the tests and `ogsf demo` use it, so no token is spent |\n| `claude_code` | accepted by the config, refused at validation until its driver is written |\n\nEach player keeps **one session per match**. A correction, a JSON fix or a\nsecond objective for the same player goes into the same session, with\neverything it already read still in context.\n\n## Match reports\n\nPlayers hand each other work through *match reports*: typed JSON, never\nfree text. Every report has the same base, and each type adds its own\nfields:\n\n| Report | Extra fields |\n|---|---|\n| every report | `status` (touchdown or turnover), `summary`, `artifacts`, `notes_for_next_player` |\n| `TalkReport` | `commit_message`, `ruling` (`implement`, `noop`, `blocked`), `ruling_reason` |\n| `AttackReport` | `changed_files`, `commit_message` |\n| `AnalystReport` | `findings: [{file, note}]` |\n| `VarReport` | `approved`, `findings: [{requirement, met, evidence}]`, `blocking` |\n| `BardReport` | `document_path`, `documented_files`, `commit_message` |\n| `GenericReport` | nothing extra |\n| `ChangesReport` (built by code) | `base`, `changed_files`, `insertions`, `deletions`, `stat`, `diff_path` |\n| `QaReport` (built by code) | `passed`, `failures` |\n\nThe next player receives the previous report as its starting point, and\nfiles go through the match\'s `torch_pass/` folder. That is the whole\nhand-over: nothing is passed through a model\'s memory.\n\n## Official reviews and corrections\n\nA report is a set of claims ("I changed these files", "the plan is at\nspecs/timer.md"). *Official reviews* are code that checks those claims, one\ncheck per item, so a failure says exactly what was wrong:\n\n| Review | Checks |\n|---|---|\n| `ball_in_play` | every artifact the report names exists |\n| `ball_not_flat` | no named file is empty |\n| `json_parses` | every named `.json` file parses |\n| `replay_matches_report` | every file the report says it changed did change |\n| `decision_stands` | a safety officer\'s approval agrees with its own findings |\n| `tests_pass(cmd)` | a shell command exits 0 |\n\nEvery player call goes through three checks, in this order:\n\n![The three checks on every player call](diagrams/correction-loops.svg)\n\n1. **Does the reply parse?** If it is not valid JSON for its report type,\n   the parse error goes back into the same session, at most twice\n   (`JSONFixAttempts = 2`).\n2. **Do the official reviews pass?** If not, every violation goes back into\n   the same session as one correction ("Your previous response failed\n   validation: …"), as many times as the objective allows (usually one).\n3. **Did it change only what it may?** If not, those paths are rolled back\n   and the objective fails. There is no correction here, on purpose: a write\n   has already happened, and asking nicely does not undo it.\n\nEach attempt is recorded, valid or not, so a report on Matchday Live can\ncount *corrected replies* per player. A player that needs many corrections\nis telling you its team talk or its model needs attention.\n',ue=`# Remote control

You will not always be at the Mac that runs the fleet. There are two ways
to drive it from the Claude app (on a phone, a tablet or claude.ai), and
they suit different jobs.

![Two ways to drive the fleet from the Claude app](diagrams/remote-control.svg)

## 1 · Claude Code Remote Control

Claude Code's own Remote Control connects the Claude app, or claude.ai/code,
to a Claude Code session **running on your Mac**. The session keeps running
locally the whole time: your files, your shell, the \`ogsf\` binary and the
OGSF plugin are all there. The app is a window into it.

That makes it the most capable path: anything you could type at the Mac,
you can type from your phone. "Run \`ogsf run-heroic\` on the timer spec and
tell me when it lands" works, and so does "read the last match's
highlights and tell me why it turned over".

What it needs (from Claude Code's documentation, checked on 2026-10-17):

- A Pro, Max, Team or Enterprise plan, signed in to Claude Code through
  claude.ai (\`/login\`). API keys are not supported. On Team and Enterprise,
  an Owner must first turn Remote Control on in the Claude Code admin
  settings.
- The Mac stays on and the \`claude\` process keeps running.
- It is not available through Amazon Bedrock, Google Cloud's Agent
  Platform or Microsoft Foundry, or with \`ANTHROPIC_BASE_URL\` pointing
  somewhere other than \`api.anthropic.com\`.

How to start it, in your repository:

| Where | How |
|---|---|
| a terminal, as a server for the app | \`claude remote-control\` (add \`--name "OGSF"\` to name the session) |
| a normal session you can also drive remotely | \`claude --remote-control\` (or \`--rc\`) |
| a session already running | \`/remote-control\` (or \`/rc\`) |

Then open the session URL, scan the QR code it shows, or find the session
by name in the Claude app (tap **Code**) or at claude.ai/code.

Your Mac only makes outbound HTTPS calls; it never opens a port. While a
session is connected, its transcript is stored on Anthropic's servers to
keep your devices in sync; execution and file access stay on your Mac.

## 2 · The Matchday Live connector

Your Matchday Live deployment is also a remote MCP server, at
\`https://<your app>/api/mcp\`. Add it to the Claude app as a **custom
connector** and you can talk to the fleet without any Mac being on a
Claude Code session.

Its tools:

| Tool | Does |
|---|---|
| \`fleet_status\` | what is running, the last match, waiting requests, the next tickets, and each Mac with when it was last seen |
| \`list_matches\` · \`get_match\` | the matches, and one in full |
| \`daily_report\` · \`multi_day_report\` | the reports, in Markdown, with player performance |
| \`list_upcoming\` | Upcoming Matches and their status |
| \`queue_request\` · \`queue_ticket\` | ask a Mac to run a set piece, or a ticket |
| \`request_status\` · \`cancel_request\` | follow or cancel a request |

The connector cannot run anything itself. \`queue_request\` writes a row in
the cloud's requests table; a Mac's Scheduler claims it only if that Mac's
config says \`scheduler.accept_remote: true\`, and a request by set piece
name runs only if the set piece is in \`scheduler.allowed_set_pieces\`. The
kickoff checklist still applies. Out of the box no Mac accepts remote
requests at all, and once you turn them on, the default list allows only
the set pieces that commit nothing, plus tickets you wrote yourself. The
Mac, not the phone, has the last word.

Signing in is OAuth 2.1 with PKCE. A client identifies itself by its
Client ID Metadata Document URL (what the Claude app does by default) or by
dynamic registration. The consent page asks for your \`MATCHDAY_PASSWORD\`,
the same password as the page, and sends the browser back only to
claude.ai, claude.com or localhost; \`MATCHDAY_CONNECTOR_REDIRECTS\` in Vercel
(comma-separated hosts) allows another.

From Claude Code, the same connector is one command in your repository:

\`\`\`sh
claude mcp add --transport http matchday https://<your app>/api/mcp
\`\`\`

then \`/mcp\` inside Claude Code to sign in.

[Connect the Claude app](guide/claude-app.md) walks through both paths.

## Which one?

| You want to | Use |
|---|---|
| steer real work, read code, fix a failed match | Remote Control |
| check on the fleet, read a report, queue a known kind of job | the connector |
| hand the fleet a sprint and walk away | neither: write tickets and run \`ogsf scheduler\` ([Upcoming Matches](upcoming.md)) |
`,de=`# Safety and checks

The fleet lets models change your code. Everything on this page exists
because a model, at some point, did something it was not asked to: deleted
a plan it found "unexpected", reverted the very check it was about to be
judged by, or carried on building for minutes after the planner already
knew there was nothing to build. Each check below is the answer to one of
those moments, and each one is plain code.

## What players can and cannot do

Be clear about the starting point: **players run with your shell's
permissions.** A player with \`bash\` can run any command you could. OGSF does
not sandbox that. What it does instead is check, after every player call,
what actually changed, and undo what should not have.

- \`tools\` is a capability list, not a fence.
- \`writes\` (per player) and \`restricted_area\` (for everyone) are the fence,
  enforced after the fact.
- Contract checks and qa commands are shell commands from your config and
  your specs. **Read a repository's \`set_pieces/boardroom/club.config.yaml\`
  before you run its set pieces**, the same way you would read a Makefile.
- Every command has a time limit, and a limit stops the command's whole
  process group, not only the parent.

## The restricted area

Before a player runs, the match fingerprints every path the working tree
differs on. After it runs, it compares. Any path that appeared, vanished or
changed is checked against what that player may change:

1. the match's own runtime folder (\`set_pieces/clubhouse/matches/…\`), which
   every player may always write, so even a read-only player can hand back
   its report;
2. the player's own \`writes:\` list;
3. never the \`restricted_area\` (by default \`set_pieces/boardroom/\` and
   \`set_pieces/playbooks/\`), unless the player names it in its own \`writes\`.

A path outside that is rolled back, and the objective fails with every path
named. Comparing change-sets, rather than watching writes, catches the
subtle case: a file that was modified before the call and is clean after it
has been *reverted*, and a reversion is a modification.

Why is there no correction for this, when there is one for a bad report?
Because a correction asks a player to redo its work. A write outside the
fence has already happened; the honest response is to undo it and say so.

## qa and the progressive gate

\`qa.checks\` in the config lists the commands that judge the code: by
default \`npm run lint\`, \`npm run typecheck\`, \`npm run test\` and
\`npm run build\`, each with a time limit. They run in the order listed (fast
first, by convention), and a build waits while any typecheck is failing,
because the build would run the same typecheck and cannot pass.

There are two ways to judge them:

- **Strict**: every check must exit 0. \`ogsf qa\` and the test objectives of
  \`run-normal\` and \`run-heroic\` work this way.
- **Progressive**: used by \`run-mythic\`. A check that names a \`diagnostics\`
  parser (\`eslint\` or \`tsc\`) passes if it introduced **no new problem**
  compared with the line of scrimmage, the measurement taken before the
  build. Tests and build still need a clean exit.

A *problem* is identified by its file, rule and message, and counted, so a
second copy of an existing problem is a new problem. An equal total with
different problems is red. That is what makes a large clean-up possible one
quest at a time: each quest is judged on whether it moved the codebase
forward, not on whether it fixed everything at once.

<!-- chart: progressive-gate -->

| Case | Before (line of scrimmage) | After | New problems | Gate |
|---|---|---|---|---|
| a quest that only removes problems | 847 | 721 | 0 | green |
| same total, one problem swapped for another | 847 | 847 | 1 | red |
| fewer in total, but one new | 847 | 800 | 1 | red |

The 847 → 721 case is the example the gate's own console line uses
(\`lint: 847→721 (-126)\`, in \`backroom_staff/qa/qa.go\`); the other two rows
apply the rule from the same file to the same starting count.

The parser refuses output it does not recognise: a crash must never be
counted as zero errors. A check with no parser is judged on its exit code
alone, in both modes.

## The quest contract

A spec is prose for players, and prose cannot refuse anything. So a quest
spec may carry one fenced block the harness reads itself:

\`\`\`\`md
\`\`\`ogsf
difficulty: run-mythic      # the set piece this quest must run under
precondition: |             # exit 0 = work REMAINS. Run before any player.
  test "$(npx eslint components/contact --format json | jq '[.[].errorCount]|add')" -gt 0
writes:                     # every path the match may change
  - components/contact/*
checks:                     # must exit 0 on the built tree, before the gate
  - name: touched files are lint-clean
    run: git diff --name-only HEAD -- '*.test.tsx' | xargs npx eslint --no-warn-ignored
\`\`\`
\`\`\`\`

Each field exists because of something that went wrong without it:

| Field | Why |
|---|---|
| \`difficulty\` | a spec once named a difficulty that ran tests only, for a quest judged on its lint count |
| \`precondition\` | a quest was dispatched a second time after it had already merged |
| \`writes\` | the safety officer was the only scope check, and a judgement is not a glob |
| \`checks\` | an acceptance criterion written as prose is checked by whoever remembers to |

A spec with no block is still valid. Everything treats a missing block as
"nothing declared" and says so, rather than reporting a pass it did not
earn.

## The kickoff checklist

\`run-heroic\` and \`run-mythic\` run the kickoff checklist before anything
else, against the prompt exactly as you typed it:

| Check | Applies to |
|---|---|
| working tree clean: nothing stray would ride along in \`git add -A\` | every kickoff |
| on a feature branch, not \`main\`, \`develop\` or \`release/*\` | every kickoff |
| spec matches branch: the quest's file name and the branch agree | a prompt under \`specs/*-quests/\` |
| spec committed: tracked and unmodified | a quest spec |
| quest not already merged (asks \`gh\`; skipped if \`gh\` is missing) | a quest spec |
| the contract's difficulty, and its precondition says work remains | a quest spec with a contract |

A refusal exits with code 2 and spends nothing. \`--skip-kickoff\` overrides
it when you know better, and is recorded.

## The ruling stop

The playmaker is the first player to look at the tree, and its
\`TalkReport\` carries a ruling: \`implement\`, \`noop\` (already done) or
\`blocked\` (cannot be done as asked). In \`run-mythic\`, anything but
\`implement\` ends the match at the spec. The plan's copy under \`specs/\` is
removed (it describes no work), the record keeps it in the torch pass, and
the exit code is 1, because a quest that produced nothing is something you
need to see.

## Match abandoned

When the model provider fails (no credits left, a rate limit, an outage),
the objective is still recorded as a turnover, but the match exits with
**75** instead of 1 and says plainly that no review was red. A provider
error is not a verdict on the work, and a script that dispatches quests in
a row needs to tell the two apart.

## The commit normaliser

Every set piece that ships passes its commit header through \`commitmsg\`,
which makes it parse under \`@commitlint/config-conventional\`: a type, a
lower-case subject, no trailing period, a sane length. Players do not
reliably write conformant headers, and failing a match at its very last
step, after every check passed, over a capital letter would be absurd.
When an \`iterate\` changes the story, the fuller message is kept rather than
replaced.

## What the cloud can see

- \`ogsf var\` listens on \`127.0.0.1\` only, and answers another origin only
  when you allow it with \`--allow-origin\`.
- The relay sends to the URL in your \`.env\`, with a revocable fleet token,
  and nothing else. The page never sees your provider keys: the fleet never
  had them.
- Matchday Live's secrets live only in Vercel's environment; see
  [Matchday Live](matchday-live.md#security).
`,fe=`# The set pieces

A set piece is one command that runs one fixed chain of objectives. There
are thirteen. They differ in two ways: **which players take part**, and
**what has to be true before the match is accepted**. Picking one is
mostly a question of how much checking the work deserves.

Every set piece takes a prompt: either the request itself in quotes, or a
path to a Markdown file holding it (\`ogsf run-heroic specs/timer.md\`).

## All thirteen

| Command | Objectives, in order | Accepted when | Commits |
|---|---|---|---|
| \`ogsf ask\` | ask → answer (any player, \`--player\`, default builder) | every objective passes | none |
| \`ogsf scout-opposition\` | ask → scout_opposition (the ranger, read-only) | every objective passes | none |
| \`ogsf team-talk\` | ask → spec | every objective passes | none |
| \`ogsf attack\` | ask → build | every objective passes | none |
| \`ogsf talk-attack\` | ask → spec → build → ship | every objective passes | one |
| \`ogsf attack-var\` | ask → build → (test → iterate) up to 3 rounds | the suite is green | none |
| \`ogsf attack-review\` | ask → build → (review → revise) up to 3 rounds | the safety officer approves | none |
| \`ogsf run-normal\` | ask → spec → build → (test → iterate) up to 3 → ship | the suite is green | one |
| \`ogsf run-heroic\` | kickoff → ask → spec → ship_spec → build → tests → review → retest → ship_build → changes → document → ship_docs | green suite and an approval | three |
| \`ogsf run-mythic\` | kickoff → ask → spec → [ruling stop] → benchmark → build → (scope_check → qa → iterate) up to 3 → ship | contract clean, progressive gate green | one |
| \`ogsf bard\` | ask → changes → document (\`--base\`, default \`main\`) | every objective passes | none |
| \`ogsf qa\` | ask → qa (every check, strictly) | every check exits 0 | none |
| \`ogsf play <playbook>\` | ask → each player in your playbook, report to report | every objective passes | none |

"Commits: none" means the set piece leaves its changes in your working tree
for you to read and commit. The four set pieces that ship (\`talk-attack\`,
\`run-normal\`, \`run-heroic\`, \`run-mythic\`) commit only what passed, and their
commit messages are normalised to Conventional Commits.

## Which one to reach for

**To look, not touch.** \`scout-opposition\` sends the ranger to find where
things live ("where is auth handled?"). It can read and run commands but
changes nothing in the repository. \`ask\` is a single question or small task
for any one player; it is the cheapest real match there is, which makes it
the right first match on a new setup.

**To think before building.** \`team-talk\` stops after the playmaker's spec,
so you can read the plan before anyone writes code. Run it when the request
is fuzzy and you want to see how it was understood.

**To build and decide for yourself.** \`attack\` builds and stops, leaving the
change uncommitted. \`attack-var\` adds the test loop: good for "make this
failing test pass". \`attack-review\` adds the safety officer's review loop
instead: good when *is this what I asked for* matters more than the suite.

**The everyday difficulty.** \`run-normal\` plans, builds, tests with extra
time and commits only a green result. It is the default for ordinary work
in a repository with a test suite.

**Real work whose shape is not obvious.** \`run-heroic\` adds the kickoff
checklist, commits the spec first, has the safety officer review the build
(and the builder revise once if needed), retests after a revision, and has
the bard document the change. You get three commits: the spec, the code,
the docs. If the tests or the review never come clean, nothing but the spec
commit lands.

**Large work cut into quests.** \`run-mythic\` is the strict difficulty, for a
quest with a written spec under \`specs/<area>-quests/\`. The spec carries a
contract the machine checks. The match can stop at the plan, measures the
lint and type problems that exist *before* the build, and fails only on new
ones. Use it for refactors, lint and type clean-ups, and anything you will
run many times in a row. [Write a quest](guide/your-workflows.md#a-quest-with-a-contract)
shows how.

**After the fact.** \`bard\` documents the change between \`--base\` and now.
\`qa\` runs every check in your config strictly, with no player involved:
handy before a release.

**Your own chain.** \`play\` runs a *playbook*: a list of players you wrote,
each handed the previous one's report. See
[your own workflows](guide/your-workflows.md).

## run-normal and run-heroic

Colour shows who owns each objective: orange is you, violet the playmaker,
teal the builder, grey plain code, red the safety officer, pink the bard.

![run-normal and run-heroic](diagrams/difficulty-normal-heroic.svg)

A detail that matters when you read a match: a red test run does **not**
fail the test objective. The objective did its job, which was to find out.
The failure becomes a report, the builder gets it word for word in an
\`iterate\` objective, and the suite runs again. Only running out of extra
time turns the match into a turnover.

## run-mythic

![run-mythic, the strict difficulty](diagrams/difficulty-mythic.svg)

What each stop is for:

- **Kickoff checklist.** A clean tree, a feature branch (never \`main\`,
  \`develop\` or \`release/*\`), a spec that matches the branch name, is
  committed, and has not already merged; then the contract's own checks:
  the difficulty it names is \`run-mythic\`, and its \`precondition\` command
  says work remains. Any "no" and the match never starts (exit 2).
- **Ruling stop.** The playmaker is the first to look at the tree, and it
  can say \`noop\` (already done) or \`blocked\` (cannot be done as asked).
  Either one ends the match before a token is spent on building. The exit
  is still 1: a dispatched quest that produced nothing is something you
  need to see, not a quiet success.
- **Line of scrimmage.** The \`benchmark\` objective records every lint and
  type diagnostic that exists before the builder starts. The gate later
  compares against it.
- **Scope check.** Cheap and decisive checks first: the repository's own
  pre-commit hook, the contract's \`writes\` scope (every changed path must
  match), and the contract's \`checks\` commands. If any fails, the slow gate
  is skipped for that round and the failure goes straight to the builder.
- **Progressive gate.** Lint and type-check pass if they introduced no
  *new* diagnostic; tests and build must exit 0. See
  [safety and checks](safety.md#qa-and-the-progressive-gate).
- **Re-verifying.** Running \`run-mythic\` again with the \`--match-id\` of a
  failed match does not rebuild: it runs the strict gate once on the tree as
  it is now (after your manual repair), with no paid players.

## Flags every set piece takes

| Flag | Meaning |
|---|---|
| \`--config <path>\` | another club config (default \`$CLUB_CONFIG\`, then \`set_pieces/boardroom/club.config.yaml\`) |
| \`--match-id <id>\` | join or pin a match id instead of minting one |
| \`--player <name>\` | \`ask\` only: who answers (default \`builder\`) |
| \`--base <ref>\` | \`bard\` only: what the change is measured against (default \`main\`) |
| \`--skip-kickoff\` | \`run-heroic\` and \`run-mythic\`: dispatch even when the checklist refuses |

## Exit codes

Every set piece ends with an exit code you can script against:

| Code | Meaning |
|---|---|
| \`0\` | accepted |
| \`1\` | not accepted (a review, the suite, the contract or a ruling said no), or an error |
| \`2\` | the kickoff checklist refused; nothing ran |
| \`75\` | match abandoned: the model provider failed (no credits, a rate limit, an outage). No review was red; try again later |
| \`128+n\` | stopped by signal \`n\` (\`130\` for Ctrl-C) |
`,pe='# Upcoming Matches and the Scheduler\n\nMost work is not "run this now". It is a list: this sprint\'s tickets, each\nmeant for a day. **Upcoming Matches** is that list, written as Markdown in\nyour repository. **The Scheduler** is the process that plays it: it starts\neach ticket marked `auto` when it is due, one match at a time, and leaves\nthe `manual` ones for you.\n\n![Upcoming Matches and the Scheduler](diagrams/upcoming-scheduler.svg)\n\n## Tickets\n\nTickets live in `set_pieces/upcoming/*.md` (`ogsf incorporate` stamps a\n`README.md` there with the format). A file can hold a whole sprint:\n\n```md\n---\nsprint: Sprint 14\ntimezone: Europe/London\n---\n\n# Sprint 14\n\nAnything that is not under a ticket heading is ignored, so notes like\nthis one are fine.\n\n## KICK-7 · Add a match timer\ndate: 2026-10-20\ntime: 09:30\nset piece: run-heroic\nmode: auto\n\nAdd a match timer: start, stop, and minutes played on /timer.\nKeep the existing styles.\n\n## KICK-8 · Where is auth handled?\ndate: 2026-10-20\nset piece: scout-opposition\n\nFind where authentication is handled and list the files.\n\n## KICK-9 · Contact form lint quest\ndate: 2026-10-21\nset piece: run-mythic\nmode: auto\nspec: specs/contact-quests/01-lint.md\n```\n\nThe rules, which the parser enforces:\n\n| Part | Rule |\n|---|---|\n| front matter | optional, between `---` lines: `sprint:` and `timezone:` (an IANA zone) |\n| heading | `## <ID> · <Title>`: an id like `KICK-7` (letters, a dash, a number), then `·`, `-`, `–`, `—` or `:`, then the title. The id must be unique across every file |\n| `date:` | required, `YYYY-MM-DD`: the day it is to be worked |\n| `time:` | optional, `HH:MM` (24 h); without it, `upcoming.default_time` applies (default `09:00`) |\n| `set piece:` | required: the command it runs (`run-heroic`, `ask`, …) |\n| `mode:` | `auto` (the Scheduler starts it when due) or `manual` (the default: a person does) |\n| `player:` | `ask` only: who answers |\n| `spec:` | a quest spec path, for `run-mythic`; when given it *is* the prompt, and any text under the ticket is ignored. The file must exist: a ticket whose spec is not there yet is marked `skipped` with a note saying so, and is never launched (the kickoff checklist would otherwise read a missing path as plain prompt words); write and commit the spec, then `ogsf upcoming run <id>` |\n| `timezone:` | optional, per ticket, overriding the file\'s and the config\'s |\n| the prompt | after a blank line, everything up to the next `##` heading |\n\nA ticket that cannot be read is listed with the reason, and the others\nstill load. A ticket keeps its status once it has run: editing a played\nticket does not play it again. Removing a ticket that never ran marks it\n`skipped` on the board.\n\n## The config\n\n```yaml\nupcoming:\n  sources:\n    - kind: markdown\n      path: set_pieces/upcoming/*.md\n    # - kind: linear              # designed for; arrives later\n  default_time: "09:00"           # when a ticket with a date and no time is due\n  timezone: ""                    # IANA zone for ticket dates; empty = this Mac\'s\n\nscheduler:\n  poll_seconds: 30\n  accept_remote: false\n  allowed_set_pieces: [ask, scout-opposition, team-talk]\n```\n\n`kind: linear` is reserved: the Linear source is designed for and arrives\nlater. Today it is reported as "arrives later; use markdown for now".\n\n## The commands\n\n| Command | Does |\n|---|---|\n| `ogsf upcoming` | reads every source and lists the tickets, with their status |\n| `ogsf upcoming run <ticket-id>` | plays one ticket now, `auto` or `manual` |\n| `ogsf scheduler` | runs until stopped: every `poll_seconds`, and straight after a match, it starts at most one: the earliest due `auto` ticket, then a request made on this Mac, then one from the cloud. Ctrl-C stops it at once; a match in progress gets the same signal and is recorded as a turnover, like any match stopped by a signal |\n| `ogsf scheduler --once` | one round, then stops (handy in cron or to test) |\n| `ogsf request "<prompt>" --set-piece <name>` | queues a request for this Mac\'s Scheduler (`--player`, `--machine`, or `--ticket <id>` instead of a prompt) |\n| `ogsf requests` | the requests queued on this Mac, newest first |\n\n## Ticket statuses\n\n`scheduled` → `due` → `queued` → `running` → `touchdown` or `turnover`, or\n`skipped` with a note saying why. The match that played a ticket carries\nits `ticket_id`, so Matchday Live links the two both ways, and the\n`upcoming_matches` table is relayed like every other, so the cloud page\nshows the same list.\n\n## Requests: "run this now" from elsewhere\n\nA *request* asks a Mac to run something now. It can come from three\nplaces: **Run now** on Matchday Live, the **Claude connector**\n(`queue_request`, `queue_ticket`), or `ogsf request` on the Mac itself. A\nrequest made on the cloud page lives in Supabase until a Mac\'s Scheduler\nclaims it over the fleet API; one made with `ogsf request` lives in that\nMac\'s own match log.\n\nWho may start work, exactly:\n\n- An **auto ticket** is started by its Mac\'s Scheduler when it is due. You\n  wrote it, in your own repository.\n- A **request** runs only on a Mac whose config says\n  `scheduler.accept_remote: true`. Off by default.\n- A request **by set piece name** may start only the set pieces in\n  `scheduler.allowed_set_pieces`, by default the three that commit nothing:\n  `ask`, `scout-opposition` and `team-talk`.\n- A request **for a ticket** may start any ticket you wrote, whatever its\n  set piece. If the Scheduler already started that ticket by itself (an\n  `auto` ticket that came due first), the request takes that match\'s\n  result, with the match id and a note that it was already played; a\n  request for a ticket that is still running is refused, with the match id\n  in the note.\n- **Every match still passes its kickoff checklist.** A refused request is\n  marked `refused`, with the reason.\n\nThe Scheduler runs one match at a time because a Mac\'s working tree belongs\nto one match: two builders in one checkout would commit each other\'s work.\n',me=`# Connect the Claude app

Two ways, side by side on [Remote control](../remote.md). Set up either or
both.

## A · Claude Code Remote Control

This drives a whole Claude Code session running on your Mac, from the
Claude app or claude.ai/code. Checked against Claude Code's documentation
(code.claude.com/docs/en/remote-control) on 2026-10-17.

**Before you start:** a Pro, Max, Team or Enterprise plan, and Claude Code
signed in through claude.ai (run \`claude\`, then \`/login\`). API keys do not
work for Remote Control. On Team and Enterprise, an Owner must first turn
on Remote Control in the Claude Code admin settings.

1. Start Claude Code in your repository with the OGSF plugin loaded and
   Remote Control on:

   \`\`\`sh
   cd ~/code/my-project
   claude --plugin-dir /path/to/ogsf-fleet/modernized/plugin --remote-control "OGSF"
   \`\`\`

   Or, in a session that is already running, type \`/remote-control\` (or
   \`/rc\`). For a server that waits for the app, run
   \`claude remote-control --name "OGSF"\`; server mode does not carry flags
   such as \`--plugin-dir\` over to its sessions, so install the plugin from
   a marketplace first (see \`plugin/README.md\`).
2. The first time, Claude Code asks you to confirm **Enable Remote
   Control**, and to trust the folder if you have not yet.
3. Open the session on your phone: scan the QR code it shows, open the
   session URL, or open the Claude app, tap **Code**, and pick the session
   by name. Online sessions show a computer icon with a green dot.
4. Talk to it as you would at the Mac: "run the timer request on
   run-heroic", "what did the last match do?", "start the scheduler for an
   hour".

Keep the Mac awake and the \`claude\` process running. If the network drops
or the laptop sleeps, it reconnects by itself when the Mac is back. To stop
sharing, run \`/remote-control\` again and disconnect.

## B · The Matchday Live connector

This needs your [Matchday Live deployment](matchday-live-cloud.md). It does
not need Claude Code, or any Mac to be on a session.

1. In the Claude app, open **Customize → Connectors**, choose **+ Add**,
   then **Add custom connector**. (On Team and Enterprise, an Owner adds it
   under **Organization settings → Connectors**, and members connect to it
   from **Customize → Connectors**.)
2. Name it "Matchday Live" and enter the URL
   \`https://<your app>.vercel.app/api/mcp\`.
3. Continue through the authentication step: the connector uses OAuth, so
   choose to sign in. A Matchday Live page opens; enter your
   \`MATCHDAY_PASSWORD\` and allow access.
4. In a chat, turn the connector on from the **+** menu → **Connectors**,
   and ask: "what is the fleet doing?", "give me this week's report", "which
   tickets are due tomorrow?", "queue a scout-opposition: where is auth
   handled?".

For a queued request to run, the Mac that should take it needs, in its
\`club.config.yaml\`:

\`\`\`yaml
scheduler:
  accept_remote: true
  allowed_set_pieces: [ask, scout-opposition, team-talk]
\`\`\`

and \`ogsf scheduler\` running with its relay set up. A request for a set
piece that is not listed is refused, with the reason; a request for one of
your tickets runs whatever the ticket says. Every match passes its kickoff
checklist. \`request_status\` in the app, or \`ogsf requests\` on the Mac,
shows where a request is.

To disconnect, remove the connector in the app. To cut off every connected
app at once, change \`MATCHDAY_PASSWORD\` in Vercel and redeploy.

The sign-in sends the browser back only to claude.ai, claude.com or
localhost. If a client on another host needs it, set
\`MATCHDAY_CONNECTOR_REDIRECTS\` in Vercel to its host name (comma-separated
for several) and redeploy.

## C · The same connector from Claude Code

Claude Code can use the connector too, in any repository, with no fleet on
that machine:

\`\`\`sh
claude mcp add --transport http matchday https://<your app>.vercel.app/api/mcp
\`\`\`

Then, inside Claude Code, run \`/mcp\` and sign in with your
\`MATCHDAY_PASSWORD\`. Ask it for the week's report or what is due tomorrow
as you would in the app.
`,he=`# Your first real match

Start small. The first match should be cheap, read-only and quick, so that
if a key or a model name is wrong you find out for a few cents. Then make a
real change on a branch.

## 1 · A cheap, read-only match

\`\`\`sh
ogsf ask "In two sentences, what does this repository do?" --player ranger
\`\`\`

\`ask\` is one objective for one player. The ranger runs on a small model and
may change nothing in the repository, so this is about as safe and cheap
as a match gets. You will see the match id, the player starting, its tool
calls as they happen, and a closing banner with the answer, the tokens and
the cost.

If it fails straight away, the message says why: a missing key, a model
pi cannot resolve, or a player the config does not define. See
[troubleshooting](troubleshooting.md).

## 2 · Look at what happened

\`\`\`sh
ogsf matches                     # the last ten matches
ogsf passages <match_id>         # its objectives, in order
ogsf var                         # Matchday Live on http://127.0.0.1:4600
\`\`\`

\`ogsf var\` opens Matchday Live in your browser, reading this Mac's match
log. Open the match and look at three things: the **lanes** (one per
player, with each tool call on it), the **objective panel** (the report the
player handed back, the reviews it passed, and the exact team talk it was
sent), and the **cost and tokens** on the scoreboard. Leave \`ogsf var\`
running in its own terminal: every match you start from now on appears on
the page as it plays.

## 3 · A plan, without building

Pick something small and real you want done, and ask for a plan first:

\`\`\`sh
git switch -c feature/health-endpoint
ogsf team-talk "Add a /health endpoint that returns {ok: true} and the app version."
\`\`\`

The playmaker writes a spec under \`specs/\` and stops. Read it. If it
misunderstood you, it is much cheaper to find out now, and the fix is to
say more in your request, not to argue with the build afterwards.

## 4 · Build it, tested and committed

\`\`\`sh
ogsf run-normal "Add a /health endpoint that returns {ok: true} and the app version."
\`\`\`

\`run-normal\` plans, builds, runs your test checks, gives the builder up to
three rounds of extra time if they are red, and commits only a green
result. Watch it on Matchday Live. When it ends:

\`\`\`sh
echo $?          # 0 accepted, 1 not accepted, 75 the provider stopped it
git log -1       # the commit it made, with a Conventional Commits header
\`\`\`

A turnover is not a disaster: the match's record says exactly which
objective failed and why, and nothing unverified was committed. Read
\`ogsf passages <match_id>\`, or run \`ogsf post-match <match_id>\` to have the
ranger read the whole record and suggest what to change.

## 5 · The full difficulty

When the work is real and its shape is not obvious, use \`run-heroic\`. It
needs a clean tree on a feature branch (the kickoff checklist checks):

\`\`\`sh
git switch -c feature/match-timer
ogsf run-heroic "Add a match timer: start, stop, and minutes played on /timer."
\`\`\`

You get three commits (the spec, the code after a green suite and the
safety officer's approval, and the bard's write-up), or, if the suite or
the review never come clean, only the spec commit and a clear reason.

## Writing a good request

The playmaker can only plan what you wrote. A request that works well:

- says **what** and **where**: "on /timer", "in the settings page";
- says what **done** looks like: "shows minutes played", "returns 404 for an unknown id";
- names **constraints**: "keep the existing styles", "no new dependencies";
- is **one thing**. Two features are two matches.

A long request can live in a file: \`ogsf run-heroic specs/timer.md\` reads
the file as the prompt.

## Next

- Make the fleet fit how you work: [your own workflows](your-workflows.md).
- Plan a week of work and let it run: [plan a sprint](plan-a-sprint.md).
`,ge=`# Install and set up

This page takes you from nothing to a working fleet in your own repository:
install, put the fleet into a repository, connect your model keys, and
watch the demo. Allow about fifteen minutes. Nothing here spends a token
until the very last step, and that step is optional.

## What you need

| Tool | Why | Check |
|---|---|---|
| **Go 1.26 or newer** | builds \`ogsf\` (the module pins Go 1.26.9, which \`go\` downloads by itself) | \`go version\` |
| **git** | the fleet commits, diffs and checks branches | \`git --version\` |
| **Node 22.19 or newer** | pi runs on it; also builds Matchday Live if you change the page | \`node --version\` |
| **pi**, and a key for a model provider | the club that runs your players' models | \`pi --version\` |

Optional, later: a [Vercel](https://vercel.com) account and a
[Supabase](https://supabase.com) project (free plans are enough) to watch
from anywhere, and \`gh\` (the GitHub CLI) so the kickoff checklist can tell
when a quest has already merged.

### Install pi

pi is a separate program; the fleet starts it for each player and never
calls a model itself.

\`\`\`sh
npm install -g @earendil-works/pi-coding-agent
pi --version
\`\`\`

You need a key for each provider your roster uses: \`ANTHROPIC_API_KEY\` for
\`anthropic/…\` models, \`OPENAI_API_KEY\` for \`openai/…\` models. Point every
player at one provider and you need only that one key. You will put the key
in a \`.env\` file in a moment.

## 1 · Build \`ogsf\`

Clone the fleet's repository and build the binary. Matchday Live is already
built into it, so this needs Go only:

\`\`\`sh
git clone https://github.com/<owner>/<repo>.git ogsf-fleet
cd ogsf-fleet/modernized
make build                # ./bin/ogsf
./bin/ogsf --version
\`\`\`

Put it on your \`PATH\` so every repository can use it:

\`\`\`sh
mkdir -p ~/.local/bin && cp bin/ogsf ~/.local/bin/
# then make sure ~/.local/bin is on your PATH, for example in ~/.zshrc:
#   export PATH="$HOME/.local/bin:$PATH"
\`\`\`

\`make\` on its own runs every test first (Go, then the page's type-check and
tests, which needs \`npm ci\` in \`matchday_live/\` once).

## 2 · Put the fleet into a repository

Go to the repository you want the fleet to work on (not the fleet's own
checkout) and incorporate it:

\`\`\`sh
cd ~/code/my-project
ogsf incorporate
\`\`\`

That stamps:

| Path | What it is |
|---|---|
| \`set_pieces/boardroom/club.config.yaml\` | the roster, the qa checks, the rules: yours to edit |
| \`set_pieces/clubhouse/team_talks/<player>/\` | what each player is told |
| \`set_pieces/clubhouse/enchantments/\` | pi extensions, such as the subagent tools |
| \`set_pieces/clubhouse/spec_tools/\` | helpers for the spec tools |
| \`set_pieces/playbooks/README.md\` | how to write your own chains |
| \`set_pieces/upcoming/README.md\` | the ticket format for Upcoming Matches |
| \`.env.sample\` | every variable the fleet reads, explained |
| \`.gitignore\` | adds \`.env\` and the runtime files (the match log, each match's folder) |

It never overwrites a file that exists; \`--force\` does. Commit what it
stamped: the config and team talks are part of your repository now.

## 3 · Your keys, in \`.env\`

\`\`\`sh
cp .env.sample .env
\`\`\`

Open \`.env\` and fill in the key(s) your roster needs:

\`\`\`sh
ANTHROPIC_API_KEY=sk-ant-…
# OPENAI_API_KEY=…            # only if a player uses an openai/ model
\`\`\`

\`.env\` is never committed (incorporate added it to \`.gitignore\`), and the
fleet never reads the keys itself: it passes your environment to pi. A
missing key shows up when that player first runs, not at startup.

## 4 · Configure the fleet for this repository

Open \`set_pieces/boardroom/club.config.yaml\`. Every key is commented; these
are the ones to look at first.

**The models.** Each player's \`model\` is \`provider/model-id\`. The default
is \`anthropic/claude-sonnet-5-5\` at \`medium\` thinking, with the ranger on
\`anthropic/claude-haiku-4-5\` and the bard on \`openai/gpt-5-mini\`. If you
only have an Anthropic key, change the bard's model:

\`\`\`yaml
  - name: bard
    model: anthropic/claude-haiku-4-5
\`\`\`

**The qa checks.** These are the commands that judge the code. The defaults
are \`npm run lint\`, \`typecheck\`, \`test\` and \`build\`. Change them to whatever
your project uses. For a Go project, for example:

\`\`\`yaml
qa:
  checks:
    - name: vet
      area: backend
      operation: lint
      argv: [go, vet, ./...]
      timeout_seconds: 300
    - name: test
      area: backend
      operation: test
      argv: [go, test, ./...]
      timeout_seconds: 1800
\`\`\`

\`operation\` matters: test objectives run the \`test\` checks, and a \`build\`
waits for every \`typecheck\` to pass. Add \`diagnostics: eslint\` or
\`diagnostics: tsc\` to a check whose output the
[progressive gate](../safety.md#qa-and-the-progressive-gate) should read.

**The club rules.** \`project.club_rules\` are claims about your repository
that every player is told, such as how your tests clean up. Edit \`notes\` to
add one imperative sentence for anything a player could not work out alone:

\`\`\`yaml
project:
  name: my-project
  club_rules:
    notes:
      - Use pnpm, never npm, in this repository.
\`\`\`

**What players may change.** \`writes:\` per player and \`restricted_area\` in
\`defaults\` are the fence. The shipped roster is sensible; read
[safety and checks](../safety.md#the-restricted-area) before loosening it.

## 5 · See every set piece, for free

\`\`\`sh
ogsf demo --serve
\`\`\`

The demo builds a throwaway repository in a temporary folder, plays every
set piece and command on the scripted club (no tokens, nothing changed
where you are), and then opens Matchday Live on the result at
\`http://127.0.0.1:4600\`. Click into a match and watch the lanes, the
reports and the reviews. Stop it with Ctrl-C.

## Next

You are ready for [your first real match](first-match.md).
`,_e=`# Linear (coming later)

Upcoming Matches is built to read tickets from more than one place. Today
the only source is Markdown in your repository. Linear is designed for and
arrives later.

## What is ready today

- The config already has a place for it. A source of \`kind: linear\` is
  accepted and reported as "the Linear source arrives later; use markdown
  for now", so nothing breaks if you add it early:

  \`\`\`yaml
  upcoming:
    sources:
      - kind: markdown
        path: set_pieces/upcoming/*.md
      # - kind: linear              # designed for; arrives later
  \`\`\`

- The \`upcoming_matches\` table records each ticket's \`source\` and its
  \`source_ref\` (the Markdown file today; the Linear issue's URL later): the
  record is already shaped for a second source.

## Until then

Keep your sprint in \`set_pieces/upcoming/*.md\` ([plan a sprint](plan-a-sprint.md)).
If your team plans in Linear, copy the week's issues into a Markdown file
with their Linear ids as ticket ids (\`## ENG-142 · …\`), so a match on
Matchday Live names the same issue your team knows.
`,ve=`# Matchday Live in the cloud

\`ogsf var\` shows your matches on the Mac that runs them. To watch from a
phone, another computer or a TV, deploy Matchday Live to your own Vercel
account with a Supabase database, and connect each Mac with a relay. It
takes about twenty minutes, and the free plans of both are enough.

Nothing here is required. The fleet works the same without it; the cloud
is a mirror of your Macs, never the source.

## 1 · Create the database

1. Create a project at [supabase.com](https://supabase.com).
2. Open **Project Settings → Database** and copy the **transaction pooler**
   connection string (port 6543). It looks like
   \`postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres\`.

You do not need to create any tables: the page does that in step 4.

## 2 · Deploy the page

1. Push the fleet's repository to your own GitHub account (a fork is fine).
2. In Vercel, **Add New → Project**, import the repository, and set the
   **Root Directory** to \`modernized/matchday_live\`. The rest (Vite, the
   functions, the security headers) comes from its \`vercel.json\`.
3. Before deploying, add the environment variables:

| Variable | Value |
|---|---|
| \`DATABASE_URL\` | the pooler string from step 1 |
| \`MATCHDAY_PASSWORD\` | a long passphrase: it protects the page and the Claude connector |
| \`MATCHDAY_SESSION_SECRET\` | 32 or more random characters, for example from \`openssl rand -base64 48\` |
| \`MATCHDAY_TIMEZONE\` | optional: an IANA zone such as \`Europe/London\`, for the connector's report days (default UTC) |
| \`MATCHDAY_CONNECTOR_REDIRECTS\` | optional: extra hosts the connector's sign-in may return to, comma-separated (claude.ai, claude.com and localhost always may) |

4. Deploy. Every secret stays in Vercel; the page only ever learns whether
   each variable is set.

A deployment without \`DATABASE_URL\` still works: it plays the demo. That
is a good way to check the deploy before the database is ready.

## 3 · Sign in

Open \`https://<your app>.vercel.app\`, choose **Sign in**, and enter your
\`MATCHDAY_PASSWORD\`. The sign-in lasts seven days on that browser.

## 4 · Apply the schema and mint fleet tokens

On **Connections**:

1. **Cloud store → Apply the schema.** This creates every table in
   Supabase (the SQL is in \`supabase/migrations/\`; you can also paste it
   into Supabase's SQL editor yourself). Run it again after an update: it
   only adds what is missing.
2. **Fleet machines → mint a token** for each Mac, with a label you will
   recognise ("studio iMac"). The token is shown **once**: copy it now. The
   database stores only its SHA-256 hash.

## 5 · Connect each Mac

In the \`.env\` at the root of the repository the fleet works in:

\`\`\`sh
CLUB_RELAY_URL=https://<your app>.vercel.app
CLUB_RELAY_TOKEN=<the token you minted for this Mac>
# CLUB_MACHINE=studio-imac          # optional: how this Mac is labelled
\`\`\`

Check it, and send everything the Mac already has:

\`\`\`sh
ogsf relay status          # is a relay set up, how many rows wait
ogsf relay push --all      # queue the whole match log, then send it
\`\`\`

From now on every match streams to the page as it plays, and \`ogsf
scheduler\` relays the Upcoming Matches too. An offline Mac keeps its rows
and sends them on the next match, or when you run \`ogsf relay push\`.

## 6 · Use it from another Mac, or anywhere

Open your deployment, sign in, and choose **Connections → What this page
reads → This deployment**. You see every connected Mac's matches, the
reports across all of them, and Upcoming Matches.

Two other ways to look, without the cloud:

- The deployed page can read a Mac's \`ogsf var\` directly, with no
  database: start it with \`ogsf var --allow-origin https://<your app>.vercel.app\`,
  then choose **A fleet at an address** and enter \`http://127.0.0.1:4600\`.
  \`ogsf var\` listens on \`127.0.0.1\` only, so from another computer, forward
  the port first: \`ssh -L 4600:127.0.0.1:4600 <that Mac>\`.
- \`?demo\` at the end of the address plays the demo recording, with no
  fleet and no database.

## Turning a Mac off

Revoke its token on **Connections → Fleet machines**. That Mac's next send
is refused; its matches already in the cloud stay. Remove the two lines
from its \`.env\` to stop it trying.
`,ye=`# Plan a sprint

Write the week's work as tickets with dates, mark the ones the fleet may
start by itself, and leave the Scheduler running. This page walks through
it; the format in full is on [Upcoming Matches](../upcoming.md).

## 1 · Write the tickets

Create \`set_pieces/upcoming/sprint-14.md\` (any name ending in \`.md\`):

\`\`\`md
---
sprint: Sprint 14
timezone: Europe/London
---

# Sprint 14

Goal: the timer ships, and the contact form is lint-clean.

## KICK-7 · Where is the match clock rendered?
date: 2026-10-19
set piece: scout-opposition
mode: auto

Find every component that renders the match clock and how it gets the time.

## KICK-8 · Add a match timer
date: 2026-10-20
time: 09:30
set piece: run-heroic
mode: auto

Add a match timer: start, stop, and minutes played on /timer.
Keep the existing styles.

## KICK-9 · Review the timer with the team
date: 2026-10-21
set piece: ask
player: safety_officer

Read the timer change and list anything a reviewer should look at first.
\`\`\`

- \`mode: auto\` lets the Scheduler start the ticket when it is due. Leave
  \`mode\` out (or write \`manual\`) for tickets a person should start.
- A ticket with a date and no \`time\` is due at \`upcoming.default_time\`
  (09:00 unless you change it).
- Commit the file: tickets are part of your repository, like specs.

Check that every ticket reads:

\`\`\`sh
ogsf upcoming
\`\`\`

It lists each ticket with its due time and status, and names any ticket it
could not read, with the reason (a missing \`date:\`, a set piece that does
not exist, a duplicate id).

## 2 · Run the Scheduler

\`\`\`sh
ogsf scheduler
\`\`\`

Every 30 seconds (\`scheduler.poll_seconds\`), and straight away after a
match ends, it re-reads the tickets and starts at most one match: the
earliest \`auto\` ticket that is due. Leave it running in its own terminal,
or under \`tmux\`, on the Mac that should do the work. Ctrl-C stops it at
once: a match in progress gets the same signal and is recorded as a
turnover, like any match stopped by a signal, so stop it between matches
when you can.

\`ogsf scheduler --once\` does one round and exits, which is handy to test
your tickets, or to run from \`cron\` instead of keeping a process alive.

A **manual** ticket waits for you:

\`\`\`sh
ogsf upcoming run KICK-9
\`\`\`

## 3 · Keep the branch in mind

The Scheduler runs a ticket in the repository as it is: on the branch you
have checked out. Two consequences:

- \`run-heroic\` and \`run-mythic\` tickets pass the kickoff checklist first,
  so they need a clean tree on a feature branch, and a \`run-mythic\` quest
  needs the branch named after its spec (\`feature/<spec file name>\`). If the
  checklist refuses, the ticket is marked with the reason and nothing runs.
- Plan tickets that build on each other for the same branch, or switch
  branches between them yourself.
- A \`run-mythic\` ticket's \`spec:\` file must exist when the ticket is read.
  One whose spec is not written yet is marked \`skipped\` with a note, never
  launched; write and commit the spec, then \`ogsf upcoming run <id>\`.

## 4 · Watch it

Matchday Live's **Upcoming Matches** section (\`#/upcoming\`) shows every
ticket by due time with its status, and links each one to the match that
played it. With a relay set up, the cloud page shows the same list, so you
can check on the sprint from your phone.

## 5 · Let the Claude app add work (optional)

To let requests from the page or the Claude app run on this Mac, opt in:

\`\`\`yaml
scheduler:
  accept_remote: true
  allowed_set_pieces: [ask, scout-opposition, team-talk]
\`\`\`

A request by set piece name runs only if its set piece is listed there; a
request for one of your tickets may run whatever the ticket says. See
[Connect the Claude app](claude-app.md).

## Linear

Reading tickets from Linear is designed for and arrives later
([Linear](linear.md)). Until then, Markdown tickets are the source.
`,be='# Troubleshooting\n\nWhen a match surprises you, the record already knows why. Start from the\nexit code, then read the match.\n\n## Exit codes\n\n| Code | What happened | What to do |\n|---|---|---|\n| `0` | accepted | nothing |\n| `1` | not accepted: a review, the suite, the contract or a ruling said no; or an error before the match could start | read the closing banner, then `ogsf passages <match_id>` |\n| `2` | the kickoff checklist refused; nothing ran, nothing was spent | the banner lists each check; fix the one that failed, or `--skip-kickoff` if you know better |\n| `75` | match abandoned: the model provider failed (no credits, a rate limit, an outage). No review was red | check your provider account; run the same command again later |\n| `128+n` | stopped by signal `n`: `130` is Ctrl-C, `143` is a `kill` | the match is recorded up to the moment it stopped |\n\n## Reading a match\n\n```sh\nogsf matches                         # find the match id\nogsf passages <match_id>             # which objective failed, and its error\nogsf live-feed <match_id>            # the last 25 events\nogsf highlights-match <match_id>     # the whole record in one text file\nogsf post-match <match_id>           # the ranger reads it and recommends changes\n```\n\nOn Matchday Live, open the match and click the failed objective: you see\nthe report the player handed back, every official review with each check,\nand the exact team talk it was sent. Most turnovers explain themselves\nthere.\n\n## Configuration mistakes\n\nThese all fail in the first second, before any player spawns, and name\nevery problem at once:\n\n| Message | Cause | Fix |\n|---|---|---|\n| `player "x" is not defined in the config — available: [...]` | a set piece or playbook names a player your config lacks | add the player, or fix the name |\n| `player "x": system team talk not found: …` | the `team_talks` path is wrong or the file is missing | `ogsf incorporate` stamps the starters; check the path |\n| `model pattern "…" not found in pi --list-models` | pi does not know that model, or is not signed in for that provider | write the model as `provider/model-id`; check `pi --list-models` and your key |\n| `model pattern "…" is ambiguous` | a bare model name matches more than one provider | add the provider: `anthropic/…` |\n| `club "claude_code" is not implemented yet (pi or scripted)` | the `claude_code` club has no driver yet | use `club: pi` |\n| `qa check "x": operation "y" is not lint, typecheck, build or test` | a typo in `qa.checks` | use one of the four |\n| a playbook step "only restates its name" | a step\'s `description` repeats the step | write one sentence on what the step is for |\n\nA missing provider key does **not** fail at startup (the fleet never reads\nkeys; pi does). It fails when that player first runs, with pi\'s own\nmessage in the objective\'s error.\n\n## The kickoff checklist refused\n\n| Check | Usual fix |\n|---|---|\n| working tree clean | commit or stash what is there: it would ride along in `git add -A` |\n| on a feature branch | `git switch -c feature/<name>`: the plan commit must not land on `main`, `develop` or `release/*` |\n| spec matches branch | a quest spec runs from `feature/<spec file name without .md>` |\n| spec committed | commit the spec first: the match is held to the committed text |\n| quest not already merged | it already landed; there is nothing to do |\n| difficulty matches | run the set piece the contract names |\n| work remains | the precondition says the work is done already |\n\n## The relay\n\n| Symptom | Cause | Fix |\n|---|---|---|\n| `ogsf relay status` says no relay | `CLUB_RELAY_URL` or `CLUB_RELAY_TOKEN` missing | add both to the repository\'s `.env` |\n| `Matchday Live answered 401 …: this fleet token is unknown or revoked` | the token is wrong or was revoked | mint a new token on Connections |\n| `… This deployment has no database yet: set DATABASE_URL …` | the deployment has no `DATABASE_URL` | set it in Vercel and redeploy, then **Apply the schema** on Connections |\n| `relay: … (rows stay queued …)` | the Mac was offline | nothing is lost: `ogsf relay push` sends the rest |\n| matches from before the relay are missing | the relay only sends new rows | `ogsf relay push --all` backfills the whole log |\n| the page shows nothing from a Mac | the page reads another source | **Connections → What this page reads → This deployment** |\n\n## Matchday Live\n\n- **The page says it cannot reach a fleet.** `ogsf var` must be running,\n  and a page on another origin needs `ogsf var --allow-origin <that origin>`.\n- **Signed out every week.** The sign-in cookie lasts seven days by design.\n- **The demo instead of my data.** A link with `?demo`, or Connections set to\n  the demo recording. Choose another source on Connections.\n\n## The Scheduler\n\n- **A ticket never starts.** `ogsf upcoming` shows its status and any\n  problem reading it. Only `mode: auto` tickets start by themselves, and\n  only when due; check `time:` and the zone (`timezone:` in the file or\n  `upcoming.timezone`).\n- **A request stays queued.** The Mac needs `scheduler.accept_remote: true`,\n  `ogsf scheduler` running, and (for a request from the cloud) its relay\n  set up. A request by set piece name must be in `allowed_set_pieces`.\n- **A request was refused.** `ogsf requests` (or `request_status` in the\n  Claude app) shows the reason.\n- **Nothing happens while a match runs.** One match at a time, always: the\n  next starts when this one ends.\n',xe=`# Your own workflows

The thirteen set pieces cover the common shapes of work. Your own shapes
come in three sizes: a **playbook** (your own chain of players), a
**quest** (a spec the machine can hold a match to), and a **new player**.
You can also drive all of it from Claude Code with the plugin.

## A playbook: your own chain of players

A playbook is a list of players, each handed the previous one's report.
Say you often want the ranger to find something and the builder to fix it:

\`\`\`sh
ogsf write-playbook --name find_and_fix --players ranger,builder
\`\`\`

That writes \`set_pieces/playbooks/find_and_fix.yaml\`:

\`\`\`yaml
name: find_and_fix
description: …
steps:
  - player: ranger
    description: …
  - player: builder
    description: …
\`\`\`

Replace each \`description\` with one sentence on what that step is *for*,
such as "Find every place the date is formatted by hand". It is the only
statement of intent the record, the console and Matchday Live ever show,
so a description that only repeats the step's name is refused when the
match starts. Then:

\`\`\`sh
ogsf play find_and_fix "Dates are formatted three different ways; use formatDate everywhere."
\`\`\`

Playbooks run every player in order and do not commit. They live in the
restricted area, so no player can rewrite the chain it is running in.

## A quest with a contract

For large work, such as a lint clean-up across a codebase or a refactor in
steps, cut it into **quests**: one spec per slice, each run with
\`run-mythic\`, each judged on whether it moved the codebase forward.

### 1 · Write the spec

Quest specs live under \`specs/<area>-quests/\`. The prose is for the
players; the \` \`\`\`ogsf \` block is for the machine:

\`\`\`\`md
# Contact form: lint clean

Fix every ESLint error in components/contact/. Do not change behaviour;
the existing tests must keep passing.

\`\`\`ogsf
difficulty: run-mythic
precondition: |
  test "$(npx eslint components/contact --format json | jq '[.[].errorCount]|add')" -gt 0
writes:
  - components/contact/*
checks:
  - name: touched files are lint-clean
    run: git diff --name-only HEAD | xargs npx eslint --no-warn-ignored
\`\`\`
\`\`\`\`

- \`precondition\` exits 0 while work **remains**. Once the quest has landed
  it exits non-zero, and the kickoff checklist refuses to run it twice.
- \`writes\` is every path the match may change (\`*\` crosses \`/\`). The scope
  check fails a round that touches anything else.
- \`checks\` are commands that must pass on the built tree before the slow
  qa gate runs.

The spec tools can write the measured parts for you: \`ogsf spec-area\` and
\`ogsf spec-types\` count what is really there, so the numbers in a spec are
real (\`ogsf --help\` lists them under "Spec tools").

### 2 · Branch, commit, run

The kickoff checklist expects the branch to be named after the spec file:
\`specs/contact-quests/01-lint.md\` runs from \`feature/01-lint\`.

\`\`\`sh
git switch -c feature/01-lint
git add specs/contact-quests/01-lint.md && git commit -m "docs(specs): contact lint quest"
ogsf run-mythic specs/contact-quests/01-lint.md
\`\`\`

What happens, in order: the kickoff checklist (clean tree, the branch, the
spec committed and not already merged, the contract's difficulty and
precondition); the playmaker's plan and its **ruling** (it can stop the
match here if the work is already done or cannot be done); the **line of
scrimmage** (every lint and type problem before the build); the build; then
up to three rounds of **scope check → progressive gate → iterate**; and one
commit if the gate is green. The diagram is on
[the set pieces](../set-pieces.md#run-mythic) page.

### 3 · When it turns over

Fix what is left by hand if you like, commit it, and re-verify without
paying for players again:

\`\`\`sh
ogsf run-mythic specs/contact-quests/01-lint.md --match-id <the failed match id>
\`\`\`

With the id of a failed match, \`run-mythic\` only runs the strict gate on
the tree as it is now.

## A new player

Add an entry under \`players:\` in \`club.config.yaml\` and give it team talks:

\`\`\`yaml
  - name: migrator
    model: anthropic/claude-sonnet-5-5
    thinking: high
    purpose: Write database migrations; change nothing else.
    writes:
      - db/migrations/
    team_talks:
      system: set_pieces/clubhouse/team_talks/migrator/system.md
      user: set_pieces/clubhouse/team_talks/migrator/user.md
    tools: [read, grep, find, ls, bash, write]
\`\`\`

Copy a starter's team talks (\`team_talks/builder/\`) as a starting point.
The \`user.md\` ends with the match report the player must hand back; a
player that is not one of the five starters answers with a \`GenericReport\`.
Use it in a playbook (\`--players ranger,migrator\`) or with
\`ogsf ask … --player migrator\`.

Every set piece validates the players it needs before anything spawns: a
missing team talk, a misspelt player or a model the club cannot resolve
fails in the first second, not after a build.

## From Claude Code

The plugin in \`plugin/\` teaches Claude Code to run and watch the fleet: ask
it to "run the timer request on run-heroic", "write a playbook for
find-and-fix", "plan Monday's tickets" or "pull this week's report", and it
uses the \`ogsf\` binary to do it. It never does a player's work itself.

\`\`\`sh
claude --plugin-dir /path/to/ogsf-fleet/modernized/plugin
\`\`\`

\`plugin/README.md\` shows how to install it from a marketplace instead.
`;function S(e){return e.replace(/!?\[([^\]]*)\]\([^)]*\)/g,`$1`).replace(/`+([^`]*)`+/g,`$1`).replace(/(\*\*|__)(.*?)\1/g,`$2`).replace(/\*([^*\s][^*]*)\*/g,`$1`).replace(/\\(.)/g,`$1`)}function Se(e){return S(e).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu,``).replace(/\s/g,`-`)}var Ce=class{seen=new Map;next(e){let t=Se(e)||`section`,n=this.seen.get(t)??0;return this.seen.set(t,n+1),n===0?t:`${t}-${n}`}},C=/^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/,w=/^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/,T=/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,E=/^ {0,3}>\s?/,D=/^( {0,3})([-*+]|(\d{1,9})[.)])(\s+|$)(.*)$/,O=/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/,we=/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/,k=/^\s*<!--/,Te=/^chart:\s*([\w-]+)$/,A=e=>e.trim()===``;function j(e,t){return C.test(e)||w.test(e)||T.test(e)||E.test(e)||D.test(e)||k.test(e)||e.includes(`|`)&&t!==void 0&&O.test(t)}function M(e){return e.length-e.trimStart().length}function Ee(e,t){let n=0;for(;n<t&&e[n]===` `;)n++;return e.slice(n)}function N(e){let t=e.trim();t.startsWith(`|`)&&(t=t.slice(1)),t.endsWith(`|`)&&!t.endsWith(`\\|`)&&(t=t.slice(0,-1));let n=[],r=``;for(let e=0;e<t.length;e++){let i=t[e];i===`\\`&&t[e+1]===`|`?(r+=`|`,e++):i===`|`?(n.push(r.trim()),r=``):r+=i}return n.push(r.trim()),n}function De(e){let t=e.trim(),n=t.startsWith(`:`),r=t.endsWith(`:`);return n&&r?`center`:r?`right`:n?`left`:null}function P(e,t){let n=[],r=0;for(;r<e.length;){let i=e[r];if(A(i)){r++;continue}let a=C.exec(i);if(a){let t=a[1],o=RegExp(`^ {0,3}${t[0]==="`"?"`":`~`}{${t.length},}\\s*$`),s=M(i),c=[];for(r++;r<e.length&&!o.test(e[r]);)c.push(Ee(e[r],s)),r++;r++,n.push({type:`code`,lang:a[2]??``,text:c.join(`
`)});continue}if(k.test(i)){let t=[];for(;r<e.length;){let n=e[r];if(t.push(n),r++,n.includes(`-->`))break}let i=t.join(`
`).replace(/^\s*<!--/,``).replace(/-->\s*$/,``).trim(),a=Te.exec(i);a&&n.push({type:`chart`,name:a[1]});continue}let o=w.exec(i);if(o){let e=o[2];n.push({type:`heading`,level:o[1].length,text:e,id:t.next(e)}),r++;continue}if(T.test(i)){n.push({type:`rule`}),r++;continue}if(i.includes(`|`)&&r+1<e.length&&O.test(e[r+1])){let t=N(i),a=N(e[r+1]).map(De),o=[];for(r+=2;r<e.length&&!A(e[r])&&e[r].includes(`|`);){let n=N(e[r]);o.push(t.map((e,t)=>n[t]??``)),r++}n.push({type:`table`,head:t,align:t.map((e,t)=>a[t]??null),rows:o});continue}if(E.test(i)){let i=[];for(;r<e.length&&E.test(e[r]);)i.push(e[r].replace(E,``)),r++;n.push({type:`quote`,blocks:P(i,t)});continue}if(D.test(i)){let[i,a]=Oe(e,r,t);n.push(i),r=a;continue}let s=we.exec(i);if(s){n.push({type:`image`,alt:s[1],src:s[2]}),r++;continue}let c=[i.trim()];for(r++;r<e.length&&!A(e[r])&&!j(e[r],e[r+1]);)c.push(e[r].trim()),r++;n.push({type:`paragraph`,text:c.join(`
`)})}return n}function Oe(e,t,n){let r=D.exec(e[t]),i=r[3]!==void 0,a=i?Number(r[3]):1,o=[],s=0,c=t,l=e=>{let t=D.exec(e);return!t||t[3]!==void 0!==i?null:o.length===0||M(e)<s?t:null};for(;c<e.length;){let t=e[c],n=l(t);if(n){let e=n[4].length;s=n[1].length+n[2].length+(e===0||e>4?1:e),o.push([n[5]??``]),c++;continue}let r=o[o.length-1];if(A(t)){let t=c;for(;t<e.length&&A(e[t]);)t++;let n=e[t];if(n!==void 0&&(M(n)>=s||l(n))){for(let e=c;e<t;e++)r.push(``);c=t;continue}break}if(M(t)>=s)r.push(Ee(t,s)),c++;else if(!A(r[r.length-1]??``)&&!j(t,e[c+1]))r.push(t.trim()),c++;else break}return[{type:`list`,ordered:i,start:a,items:o.map(e=>P(e,n))},c]}function ke(e){let t=new Ce,n=P(e.replace(/\r\n?/g,`
`).split(`
`),t),r=[],i=e=>{for(let t of e)t.type===`heading`?r.push({level:t.level,text:t.text,id:t.id}):t.type===`list`?t.items.forEach(i):t.type===`quote`&&i(t.blocks)};i(n);let a=r.find(e=>e.level===1);return{title:a?S(a.text):``,blocks:n,headings:r}}var Ae=Object.assign({"./content/docs/components.md":ie,"./content/docs/match-log.md":ae,"./content/docs/matchday-live.md":oe,"./content/docs/measures.md":se,"./content/docs/overview.md":ce,"./content/docs/players.md":le,"./content/docs/remote.md":ue,"./content/docs/safety.md":de,"./content/docs/set-pieces.md":fe,"./content/docs/upcoming.md":pe}),je=Object.assign({"./content/guide/claude-app.md":me,"./content/guide/first-match.md":he,"./content/guide/install.md":ge,"./content/guide/linear.md":_e,"./content/guide/matchday-live-cloud.md":ve,"./content/guide/plan-a-sprint.md":ye,"./content/guide/troubleshooting.md":be,"./content/guide/your-workflows.md":xe}),F={docs:[`overview`,`components`,`set-pieces`,`players`,`safety`,`match-log`,`matchday-live`,`measures`,`upcoming`,`remote`],guide:[`install`,`first-match`,`your-workflows`,`plan-a-sprint`,`matchday-live-cloud`,`claude-app`,`linear`,`troubleshooting`]},I={docs:`Docs`,guide:`Guide`};function Me(e){return e.replace(/^.*\//,``).replace(/\.md$/,``)}function L(e,t){let n=new Map(Object.entries(t).map(([e,t])=>[Me(e),t]));return[...F[e].filter(e=>n.has(e)),...[...n.keys()].filter(t=>!F[e].includes(t)).sort()].map(t=>{let r=ke(n.get(t));return{section:e,slug:t,title:r.title||t,doc:r}})}var R={docs:L(`docs`,Ae),guide:L(`guide`,je)};function Ne(e,t){let n=R[e];return t?n.find(e=>e.slug===t)??null:n[0]??null}var Pe={docs:`modernized/docs`,guide:`modernized/docs/guide`};function z(e,t,n){let r=t?`#/${e}/${encodeURIComponent(t)}`:`#/${e}`;return n?`${r}?h=${encodeURIComponent(n)}`:r}function Fe(e,t){let n=e.split(`/`).filter(Boolean);for(let e of t.split(`/`))e!==``&&e!==`.`&&(e===`..`?n.pop():n.push(e));return n.join(`/`)}function Ie(e){let t=/^modernized\/docs\/guide\/([\w-]+)\.md$/.exec(e);if(t)return{section:`guide`,slug:t[1]===`README`?null:t[1]};let n=/^modernized\/docs\/([\w-]+)\.md$/.exec(e);return n?{section:`docs`,slug:n[1]===`README`?null:n[1]}:null}function Le(e,t){let n=e.trim();if(/^(https?:|mailto:)/i.test(n))return{kind:`external`,href:n};if(/^[a-z][a-z0-9+.-]*:/i.test(n)||n.startsWith(`//`))return{kind:`none`};let r=n.indexOf(`#`),i=r===-1?n:n.slice(0,r),a=r===-1?null:decodeURIComponent(n.slice(r+1))||null;if(i===``)return{kind:`page`,href:z(t.section,t.slug,a)};let o=Fe(Pe[t.section],i),s=Ie(o);return s?{kind:`page`,href:z(s.section,s.slug,a)}:{kind:`file`,path:o.replace(/^modernized\//,``)}}var B={source:`wiki/GO-MIGRATION.md, section 5 (32 strict runs of the Python factory)`,parts:[{key:`building`,label:`Building`,share:.55},{key:`planning`,label:`Planning`,share:.22},{key:`verifying`,label:`Verifying`,share:.13},{key:`rest`,label:`The rest (not broken down in the source)`,share:.1}]},V={source:`backroom_staff/qa/qa.go: RunQuality and its console line, “lint: 847→721 (-126)”`,cases:[{label:`Only removes problems`,before:847,after:721,added:0},{label:`Same total, one problem swapped`,before:847,after:847,added:1},{label:`Fewer in total, one new`,before:847,after:800,added:1}]};function Re(e){return e===0}function ze(e){return e.map(e=>({player:e.player,cost:e.cost,read:e.tokens.read,written:e.tokens.written,billed:e.tokens.billed,objectives:e.objectives})).sort((e,t)=>t.cost-e.cost||e.player.localeCompare(t.player))}function Be(e){let t=s(e.matches,`0000-01-01T00:00:00.000Z`,`9999-12-31T23:59:59.999Z`);return ze(d(t,{timeZone:`UTC`}).agents)}var H=`the demo recording, public/demo/matchday-demo.json, through shared/report.ts`,U=null;function Ve(){return U??=o().then(Be).catch(e=>{throw U=null,e}),U}var W=a();function G({share:e,tone:t,title:n}){let r=Math.max(0,Math.min(1,e))*100;return(0,W.jsxs)(`svg`,{className:`chart-bar`,viewBox:`0 0 100 10`,preserveAspectRatio:`none`,"aria-hidden":`true`,focusable:`false`,children:[(0,W.jsx)(`rect`,{className:`chart-track`,x:`0`,y:`0`,width:`100`,height:`10`,rx:`0`}),(0,W.jsx)(`rect`,{className:`chart-fill tone-${t}`,x:`0`,y:`0`,width:r,height:`10`,children:n?(0,W.jsx)(`title`,{children:n}):null})]})}function K({title:e,source:t,children:n}){return(0,W.jsxs)(`figure`,{className:`doc-chart`,children:[(0,W.jsx)(`figcaption`,{className:`doc-chart-title`,children:e}),n,(0,W.jsxs)(`p`,{className:`doc-chart-source`,children:[`Source: `,t]})]})}function He(e){return[`playmaker`,`builder`,`ranger`,`safety_officer`,`bard`].includes(e)?e:`accent`}function q(e){return e.replace(/_/g,` `)}function Ue(){let e=0;return(0,W.jsxs)(K,{title:`Where the run time went`,source:B.source,children:[(0,W.jsx)(`svg`,{className:`chart-stack`,viewBox:`0 0 100 10`,preserveAspectRatio:`none`,"aria-hidden":`true`,focusable:`false`,children:B.parts.map(t=>{let n=e;return e+=t.share*100,(0,W.jsx)(`rect`,{className:`chart-fill tone-${t.key}`,x:n,y:`0`,width:t.share*100,height:`10`},t.key)})}),(0,W.jsx)(`ul`,{className:`chart-legend`,children:B.parts.map(e=>(0,W.jsxs)(`li`,{children:[(0,W.jsx)(`span`,{className:`chart-swatch tone-${e.key}`,"aria-hidden":`true`}),(0,W.jsx)(`span`,{className:`chart-legend-label`,children:e.label}),(0,W.jsx)(`span`,{className:`chart-value`,children:p(e.share)})]},e.key))})]})}function We(){let e=Math.max(...V.cases.flatMap(e=>[e.before,e.after]));return(0,W.jsx)(K,{title:`The progressive gate: totals do not decide, new problems do`,source:V.source,children:(0,W.jsx)(`div`,{className:`chart-gate`,children:V.cases.map(t=>{let n=Re(t.added);return(0,W.jsxs)(`div`,{className:`chart-gate-case`,children:[(0,W.jsxs)(`div`,{className:`chart-gate-head`,children:[(0,W.jsx)(`span`,{className:`chart-gate-label`,children:t.label}),(0,W.jsx)(`span`,{className:`chart-verdict ${n?`good`:`bad`}`,children:n?`green`:`red`})]}),(0,W.jsxs)(`div`,{className:`chart-row`,children:[(0,W.jsx)(`span`,{className:`chart-row-label`,children:`before`}),(0,W.jsx)(G,{share:t.before/e,tone:`muted`}),(0,W.jsx)(`span`,{className:`chart-value`,children:t.before})]}),(0,W.jsxs)(`div`,{className:`chart-row`,children:[(0,W.jsx)(`span`,{className:`chart-row-label`,children:`after`}),(0,W.jsx)(G,{share:t.after/e,tone:n?`good`:`bad`}),(0,W.jsx)(`span`,{className:`chart-value`,children:t.after})]}),(0,W.jsxs)(`p`,{className:`chart-note`,children:[t.added===0?`No new problem`:`${t.added} new problem${t.added===1?``:`s`}`,`, `,t.after-t.before===0?`same total`:`${t.after-t.before>0?`+`:``}${t.after-t.before} in total`]})]},t.label)})})})}function J(){let[e,t]=(0,x.useState)(null),[n,r]=(0,x.useState)(null);return(0,x.useEffect)(()=>{let e=!0;return Ve().then(n=>e&&t(n),t=>e&&r(t instanceof Error?t.message:String(t))),()=>{e=!1}},[]),{players:e,error:n}}function Y({error:e}){return(0,W.jsx)(`p`,{className:`chart-note`,children:e?`The demo recording did not load: ${e}`:`Loading the demo recording…`})}function Ge(){let{players:e,error:t}=J(),n=e?Math.max(...e.map(e=>e.cost),0):0;return(0,W.jsx)(K,{title:`Cost per player, the whole demo recording`,source:H,children:e===null?(0,W.jsx)(Y,{error:t}):(0,W.jsx)(`div`,{className:`chart-rows`,children:e.map(e=>(0,W.jsxs)(`div`,{className:`chart-row`,children:[(0,W.jsx)(`span`,{className:`chart-row-label`,children:q(e.player)}),(0,W.jsx)(G,{share:n?e.cost/n:0,tone:He(e.player)}),(0,W.jsxs)(`span`,{className:`chart-value`,children:[f(e.cost),(0,W.jsxs)(`span`,{className:`chart-sub`,children:[` `,`· `,e.objectives,` objective`,e.objectives===1?``:`s`]})]})]},e.player))})})}function Ke(){let{players:e,error:t}=J(),n=e?Math.max(...e.flatMap(e=>[e.billed,e.read+e.written]),0):0;return(0,W.jsx)(K,{title:`Tokens per player: read and written, against billed`,source:H,children:e===null?(0,W.jsx)(Y,{error:t}):(0,W.jsxs)(W.Fragment,{children:[(0,W.jsxs)(`ul`,{className:`chart-legend`,children:[(0,W.jsxs)(`li`,{children:[(0,W.jsx)(`span`,{className:`chart-swatch tone-read`,"aria-hidden":`true`}),(0,W.jsx)(`span`,{className:`chart-legend-label`,children:`read + written`})]}),(0,W.jsxs)(`li`,{children:[(0,W.jsx)(`span`,{className:`chart-swatch tone-billed`,"aria-hidden":`true`}),(0,W.jsx)(`span`,{className:`chart-legend-label`,children:`billed (cached context re-counted each turn)`})]})]}),(0,W.jsx)(`div`,{className:`chart-rows`,children:e.map(e=>(0,W.jsxs)(`div`,{className:`chart-pair`,children:[(0,W.jsx)(`span`,{className:`chart-row-label`,children:q(e.player)}),(0,W.jsxs)(`div`,{className:`chart-pair-bars`,children:[(0,W.jsxs)(`div`,{className:`chart-pair-line`,children:[(0,W.jsx)(G,{share:n?(e.read+e.written)/n:0,tone:`read`}),(0,W.jsxs)(`span`,{className:`chart-value`,children:[m(e.read),` read · `,m(e.written),` written`]})]}),(0,W.jsxs)(`div`,{className:`chart-pair-line`,children:[(0,W.jsx)(G,{share:n?e.billed/n:0,tone:`billed`}),(0,W.jsxs)(`span`,{className:`chart-value`,children:[m(e.billed),` billed`]})]})]})]},e.player))})]})})}var X={"time-split":()=>(0,W.jsx)(Ue,{}),"progressive-gate":()=>(0,W.jsx)(We,{}),"cost-by-player":()=>(0,W.jsx)(Ge,{}),"tokens-by-player":()=>(0,W.jsx)(Ke,{})};Object.keys(X);function qe({name:e}){let t=X[e];return t?(0,W.jsx)(W.Fragment,{children:t()}):null}var Je=new URL(`components.dark-zEM5N46C.svg`,import.meta.url).href,Ye=new URL(`components-BDPMEYqJ.svg`,import.meta.url).href,Xe=new URL(`correction-loops.dark-g3doBkdi.svg`,import.meta.url).href,Ze=new URL(`correction-loops-PHUZx4uG.svg`,import.meta.url).href,Qe=new URL(`difficulty-mythic.dark-CxRL-VXZ.svg`,import.meta.url).href,$e=new URL(`difficulty-mythic-CryWPPIo.svg`,import.meta.url).href,et=new URL(`difficulty-normal-heroic.dark-1MJUt9EX.svg`,import.meta.url).href,tt=new URL(`difficulty-normal-heroic-CpdD2CNa.svg`,import.meta.url).href,nt=new URL(`match-sequence.dark-BHxds60F.svg`,import.meta.url).href,rt=new URL(`match-sequence-BIH8tgdF.svg`,import.meta.url).href,it=new URL(`matchday-live-data-flow.dark-rDzlinOf.svg`,import.meta.url).href,at=new URL(`matchday-live-data-flow-C_OOsp8m.svg`,import.meta.url).href,ot=new URL(`remote-control.dark-CwWMebf5.svg`,import.meta.url).href,st=new URL(`remote-control-DpYiqLa5.svg`,import.meta.url).href,ct=new URL(`upcoming-scheduler.dark-CnDeC9py.svg`,import.meta.url).href,lt=new URL(`upcoming-scheduler-CmZusxXt.svg`,import.meta.url).href,ut=new URL(`components-C0Z13upN.excalidraw`,import.meta.url).href,dt=new URL(`correction-loops-vB2_iu-i.excalidraw`,import.meta.url).href,ft=new URL(`difficulty-mythic-CD2k_13S.excalidraw`,import.meta.url).href,pt=new URL(`difficulty-normal-heroic-Dv1jd_NO.excalidraw`,import.meta.url).href,mt=new URL(`match-sequence-CMso0psZ.excalidraw`,import.meta.url).href,ht=new URL(`matchday-live-data-flow-flPkVyFA.excalidraw`,import.meta.url).href,gt=new URL(`remote-control-BzFgb2dk.excalidraw`,import.meta.url).href,_t=new URL(`upcoming-scheduler-DMRj23lR.excalidraw`,import.meta.url).href,Z=Object.assign({"./content/diagrams/components.dark.svg":Je,"./content/diagrams/components.svg":Ye,"./content/diagrams/correction-loops.dark.svg":Xe,"./content/diagrams/correction-loops.svg":Ze,"./content/diagrams/difficulty-mythic.dark.svg":Qe,"./content/diagrams/difficulty-mythic.svg":$e,"./content/diagrams/difficulty-normal-heroic.dark.svg":et,"./content/diagrams/difficulty-normal-heroic.svg":tt,"./content/diagrams/match-sequence.dark.svg":nt,"./content/diagrams/match-sequence.svg":rt,"./content/diagrams/matchday-live-data-flow.dark.svg":it,"./content/diagrams/matchday-live-data-flow.svg":at,"./content/diagrams/remote-control.dark.svg":ot,"./content/diagrams/remote-control.svg":st,"./content/diagrams/upcoming-scheduler.dark.svg":ct,"./content/diagrams/upcoming-scheduler.svg":lt}),vt=Object.assign({"./content/diagrams/components.excalidraw":ut,"./content/diagrams/correction-loops.excalidraw":dt,"./content/diagrams/difficulty-mythic.excalidraw":ft,"./content/diagrams/difficulty-normal-heroic.excalidraw":pt,"./content/diagrams/match-sequence.excalidraw":mt,"./content/diagrams/matchday-live-data-flow.excalidraw":ht,"./content/diagrams/remote-control.excalidraw":gt,"./content/diagrams/upcoming-scheduler.excalidraw":_t});function yt(e){let t=/(?:^|\/)diagrams\/([\w-]+)\.svg$/.exec(e);return t?t[1]:null}function bt(e){let t=Z[`./content/diagrams/${e}.svg`];return t?{light:t,dark:Z[`./content/diagrams/${e}.dark.svg`]??t,scene:vt[`./content/diagrams/${e}.excalidraw`]??null}:null}function xt({name:e,alt:t}){let r=bt(e);return r?(0,W.jsxs)(`figure`,{className:`doc-figure`,children:[(0,W.jsxs)(`div`,{className:`doc-figure-frame`,children:[(0,W.jsx)(`a`,{className:`doc-figure-variant doc-figure-light`,href:r.light,target:`_blank`,rel:`noopener noreferrer`,title:`Open full size`,children:(0,W.jsx)(`img`,{src:r.light,alt:t,loading:`lazy`,decoding:`async`})}),(0,W.jsx)(`a`,{className:`doc-figure-variant doc-figure-dark`,href:r.dark,target:`_blank`,rel:`noopener noreferrer`,title:`Open full size`,children:(0,W.jsx)(`img`,{src:r.dark,alt:t,loading:`lazy`,decoding:`async`})})]}),(0,W.jsxs)(`figcaption`,{children:[(0,W.jsx)(`span`,{className:`doc-figure-title`,children:t}),(0,W.jsxs)(`span`,{className:`doc-figure-links`,children:[(0,W.jsxs)(`a`,{className:`doc-figure-light`,href:r.light,target:`_blank`,rel:`noopener noreferrer`,children:[(0,W.jsx)(y,{size:14,"aria-hidden":`true`}),` Full size`]}),(0,W.jsxs)(`a`,{className:`doc-figure-dark`,href:r.dark,target:`_blank`,rel:`noopener noreferrer`,children:[(0,W.jsx)(y,{size:14,"aria-hidden":`true`}),` Full size`]}),r.scene?(0,W.jsxs)(`a`,{href:r.scene,download:`${e}.excalidraw`,children:[(0,W.jsx)(n,{size:14,"aria-hidden":`true`}),` Download the Excalidraw scene`]}):null]})]})]}):(0,W.jsxs)(`p`,{className:`doc-missing`,children:[`Diagram “`,t,`” is missing from this build.`]})}function St(e,t){let n=0;for(let r=t;r<e.length;r++){let t=e[r];if(t===`\\`)r++;else if(t==="`"){let t=e.indexOf("`",r+1);if(t===-1)return-1;r=t}else if(t===`[`)n++;else if(t===`]`&&(n--,n===0))return r}return-1}function Q(e,t,n=`i`){let r=[],i=``,a=0,o=()=>{i&&r.push(i),i=``},s=e=>{o(),r.push((0,W.jsx)(x.Fragment,{children:e},`${n}-${a++}`))},c=0;for(;c<e.length;){let r=e[c];if(r===`\\`&&c+1<e.length&&/[\\`*_[\]()#+\-.!|<>~]/.test(e[c+1]))i+=e[c+1],c+=2;else if(r===`
`)i+=` `,c++;else{if(r==="`"){let t=1;for(;e[c+t]==="`";)t++;let n="`".repeat(t),r=e.indexOf(n,c+t);if(r!==-1){let n=e.slice(c+t,r);s((0,W.jsx)(`code`,{children:n.length>2&&n.startsWith(` `)&&n.endsWith(` `)?n.slice(1,-1):n})),c=r+t;continue}}if(e.startsWith(`**`,c)){let r=e.indexOf(`**`,c+2);if(r>c+2){s((0,W.jsx)(`strong`,{children:Q(e.slice(c+2,r),t,`${n}-${a}`)})),c=r+2;continue}}if(r===`*`&&e[c+1]!==` `&&e[c+1]!==`*`){let r=e.indexOf(`*`,c+1);if(r>c+1&&e[r-1]!==` `){s((0,W.jsx)(`em`,{children:Q(e.slice(c+1,r),t,`${n}-${a}`)})),c=r+1;continue}}if(r===`[`||r===`!`&&e[c+1]===`[`){let i=r===`!`?c+1:c,o=St(e,i);if(o!==-1&&e[o+1]===`(`){let l=e.indexOf(`)`,o+2);if(l!==-1){let u=e.slice(i+1,o),d=e.slice(o+2,l).trim().split(/\s+/)[0]??``;s(r===`!`?(0,W.jsx)(`span`,{className:`doc-inline-image`,children:u}):(0,W.jsx)(Ct,{href:d,where:t,children:Q(u,t,`${n}-${a}`)})),c=l+1;continue}}}i+=r,c++}}return o(),r}function Ct({href:e,where:t,children:n}){let r=Le(e,t);switch(r.kind){case`external`:return(0,W.jsx)(`a`,{href:r.href,target:`_blank`,rel:`noopener noreferrer`,children:n});case`page`:return(0,W.jsx)(`a`,{href:r.href,children:n});case`file`:return(0,W.jsx)(`span`,{className:`doc-file-ref`,title:`${r.path}, in the fleet’s repository`,children:n});case`none`:return(0,W.jsx)(W.Fragment,{children:n})}}function wt({lang:e,text:t}){let[n,r]=(0,x.useState)(!1);return(0,W.jsxs)(`div`,{className:`doc-code`,children:[(0,W.jsxs)(`div`,{className:`doc-code-head`,children:[(0,W.jsx)(`span`,{className:`doc-code-lang`,children:e||`text`}),(0,W.jsxs)(`button`,{type:`button`,className:`doc-code-copy`,onClick:()=>{navigator.clipboard?.writeText(t).then(()=>{r(!0),setTimeout(()=>r(!1),1500)},()=>void 0)},"aria-label":n?`Copied`:`Copy the code`,children:[n?(0,W.jsx)(i,{size:14,"aria-hidden":`true`}):(0,W.jsx)(l,{size:14,"aria-hidden":`true`}),(0,W.jsx)(`span`,{children:n?`Copied`:`Copy`})]})]}),(0,W.jsx)(`pre`,{tabIndex:0,children:(0,W.jsx)(`code`,{children:t})})]})}function Tt({level:e,text:t,id:n,where:r}){let i=Q(t,r);if(e===1)return(0,W.jsx)(`h1`,{className:`doc-title`,id:n,children:i});let a=`h${Math.min(e,6)}`;return(0,W.jsxs)(a,{id:n,className:`doc-heading`,children:[i,(0,W.jsx)(`a`,{className:`doc-anchor`,href:z(r.section,r.slug,n),"aria-label":`Link to this section`,children:(0,W.jsx)(ne,{size:15,"aria-hidden":`true`})})]})}function $(e,t,n,r=!1){switch(e.type){case`heading`:return(0,W.jsx)(Tt,{level:e.level,text:e.text,id:e.id,where:t},n);case`paragraph`:return r?(0,W.jsx)(x.Fragment,{children:Q(e.text,t)},n):(0,W.jsx)(`p`,{children:Q(e.text,t)},n);case`code`:return(0,W.jsx)(wt,{lang:e.lang,text:e.text},n);case`list`:{let r=e.items.map((e,n)=>{let r=e.length===1&&e[0].type===`paragraph`;return(0,W.jsx)(`li`,{children:e.map((e,n)=>$(e,t,n,r))},n)});return e.ordered?(0,W.jsx)(`ol`,{start:e.start===1?void 0:e.start,children:r},n):(0,W.jsx)(`ul`,{children:r},n)}case`quote`:return(0,W.jsx)(`blockquote`,{children:e.blocks.map((e,n)=>$(e,t,n))},n);case`table`:return(0,W.jsx)(`div`,{className:`doc-table`,tabIndex:0,role:`region`,"aria-label":`Table`,children:(0,W.jsxs)(`table`,{children:[(0,W.jsx)(`thead`,{children:(0,W.jsx)(`tr`,{children:e.head.map((n,r)=>(0,W.jsx)(`th`,{className:e.align[r]?`align-${e.align[r]}`:void 0,children:Q(n,t)},r))})}),(0,W.jsx)(`tbody`,{children:e.rows.map((n,r)=>(0,W.jsx)(`tr`,{children:n.map((n,r)=>(0,W.jsx)(`td`,{className:e.align[r]?`align-${e.align[r]}`:void 0,children:Q(n,t)},r))},r))})]})},n);case`image`:{let t=yt(e.src);return t?(0,W.jsx)(xt,{name:t,alt:e.alt},n):(0,W.jsx)(`p`,{children:e.alt},n)}case`chart`:return(0,W.jsx)(qe,{name:e.name},n);case`rule`:return(0,W.jsx)(`hr`,{},n)}}function Et({blocks:e,where:t}){return(0,W.jsx)(W.Fragment,{children:e.map((e,n)=>$(e,t,n))})}function Dt(){let e=()=>{if(typeof window>`u`)return null;let e=window.location.hash,t=e.indexOf(`?`);return t===-1?null:new URLSearchParams(e.slice(t+1)).get(`h`)},[t,n]=(0,x.useState)(e);return(0,x.useEffect)(()=>{let t=()=>n(e());return window.addEventListener(`hashchange`,t),()=>window.removeEventListener(`hashchange`,t)},[]),t}function Ot({section:n,slug:r}){let i=Ne(n,r),a=R[n],o=Dt(),[s,c]=(0,x.useState)(!1);(0,x.useEffect)(()=>(document.title=i?`${i.title} · ${I[n]} · Matchday Live`:`${I[n]} · Matchday Live`,()=>{document.title=`Matchday Live`}),[i,n]),(0,x.useEffect)(()=>{c(!1);let e=o?document.getElementById(o):null;e?e.scrollIntoView({block:`start`}):window.scrollTo({top:0})},[i?.slug,n,o]);let l=i?a.indexOf(i):-1,d=l>0?a[l-1]:null,f=l>=0&&l<a.length-1?a[l+1]:null,p=n===`docs`?`guide`:`docs`;return(0,W.jsxs)(`div`,{className:`docs ${s?`menu-open`:``}`,children:[(0,W.jsxs)(`aside`,{className:`docs-side`,children:[(0,W.jsxs)(`button`,{type:`button`,className:`docs-menu-button`,"aria-expanded":s,"aria-controls":`docs-contents`,onClick:()=>c(e=>!e),children:[s?(0,W.jsx)(u,{size:18,"aria-hidden":`true`}):(0,W.jsx)(re,{size:18,"aria-hidden":`true`}),(0,W.jsxs)(`span`,{className:`docs-menu-label`,children:[I[n],i?(0,W.jsxs)(`span`,{className:`docs-menu-current`,children:[` · `,i.title]}):null]})]}),(0,W.jsxs)(`nav`,{id:`docs-contents`,className:`docs-nav`,"aria-label":`${I[n]} contents`,children:[(0,W.jsxs)(`div`,{className:`docs-tabs`,children:[(0,W.jsxs)(`a`,{href:z(`docs`,null),"aria-current":n===`docs`?`page`:void 0,children:[(0,W.jsx)(ee,{size:15,"aria-hidden":`true`}),` Docs`]}),(0,W.jsxs)(`a`,{href:z(`guide`,null),"aria-current":n===`guide`?`page`:void 0,children:[(0,W.jsx)(te,{size:15,"aria-hidden":`true`}),` Guide`]})]}),(0,W.jsx)(`ol`,{className:`docs-pages`,children:a.map(e=>{let t=e===i;return(0,W.jsxs)(`li`,{children:[(0,W.jsx)(`a`,{href:z(n,e.slug),"aria-current":t?`page`:void 0,children:e.title}),t?(0,W.jsx)(`ul`,{className:`docs-headings`,children:e.doc.headings.filter(e=>e.level===2).map(t=>(0,W.jsx)(`li`,{children:(0,W.jsx)(`a`,{href:z(n,e.slug,t.id),"aria-current":o===t.id?`location`:void 0,children:t.text.replace(/`/g,``)})},t.id))}):null]},e.slug)})})]})]}),(0,W.jsxs)(`article`,{className:`doc`,children:[i?(0,W.jsx)(Et,{blocks:i.doc.blocks,where:{section:n,slug:i.slug}}):(0,W.jsxs)(W.Fragment,{children:[(0,W.jsx)(`h1`,{className:`doc-title`,children:`No such page`}),(0,W.jsxs)(`p`,{children:[`There is no `,n===`docs`?`docs`:`guide`,` page called “`,r,`”.`,` `,(0,W.jsx)(`a`,{href:z(n,null),children:`Start at the beginning.`})]})]}),(0,W.jsxs)(`nav`,{className:`doc-pager`,"aria-label":`More pages`,children:[d?(0,W.jsxs)(`a`,{className:`doc-pager-link prev`,href:z(n,d.slug),children:[(0,W.jsx)(e,{size:18,"aria-hidden":`true`}),(0,W.jsxs)(`span`,{children:[(0,W.jsx)(`span`,{className:`doc-pager-hint`,children:`Previous`}),(0,W.jsx)(`span`,{className:`doc-pager-title`,children:d.title})]})]}):(0,W.jsx)(`span`,{}),f?(0,W.jsxs)(`a`,{className:`doc-pager-link next`,href:z(n,f.slug),children:[(0,W.jsxs)(`span`,{children:[(0,W.jsx)(`span`,{className:`doc-pager-hint`,children:`Next`}),(0,W.jsx)(`span`,{className:`doc-pager-title`,children:f.title})]}),(0,W.jsx)(t,{size:18,"aria-hidden":`true`})]}):(0,W.jsxs)(`a`,{className:`doc-pager-link next`,href:z(p,null),children:[(0,W.jsxs)(`span`,{children:[(0,W.jsx)(`span`,{className:`doc-pager-hint`,children:p===`guide`?`Now try it`:`How it works`}),(0,W.jsxs)(`span`,{className:`doc-pager-title`,children:[`The `,I[p]]})]}),(0,W.jsx)(t,{size:18,"aria-hidden":`true`})]})]})]})]})}export{Ot as t};