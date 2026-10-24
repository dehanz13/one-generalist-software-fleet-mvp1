# Matchday Live

The live view of the One Generalist Software Fleet (OGSF): every match a set
piece plays, as it plays. It replaces the legacy factory's visualizer (the
`just obs` page) and adds three things it could not do: watch from another
computer, through a cloud store on Vercel and Supabase; choose and configure
every connection from the page; and play a recorded demo with no fleet at all.

One page, three sources, the same API (see `wiki/DATA-CONTRACT.md`):

| Source | Where the data is | Who serves `/api` |
|---|---|---|
| **This Mac** | `set_pieces/clubhouse/match_log.db` on the Mac | `ogsf var`, with this page built into the binary, on `http://127.0.0.1:4600` |
| **Cloud store** | Supabase Postgres | the Vercel Functions in `api/`, deployed with this page |
| **Demo recording** | `public/demo/matchday-demo.json` | nobody: it is replayed in the browser |

Choose the source on **Connections**. A fleet at another address (a Mac
running `ogsf var`) can be read directly from a deployed page too.

## Run it locally

```sh
npm ci
npm run dev            # http://localhost:5173, plays the demo
```

Against a real fleet or a real database:

```sh
MATCHDAY_PROXY=http://127.0.0.1:4600 npm run dev           # a Mac's `ogsf var`
MATCHDAY_DEV_API=1 DATABASE_URL=... MATCHDAY_PASSWORD=... \
  MATCHDAY_SESSION_SECRET=... npm run dev                    # the Vercel API code, against Supabase
```

Checks:

```sh
npm run typecheck      # the page (src, shared) and the server (api, server, shared)
npm test               # vitest: the page, the reports, and the whole cloud API, OAuth flow and connector against a real Postgres (PGlite)
npm run build          # dist/: what Vercel serves and what `ogsf var` embeds
npm audit              # 0 vulnerabilities at the time of writing
```

## Deploy to Vercel

1. Import the repository in Vercel and set the project's **Root Directory** to
   `modernized/matchday_live`. `vercel.json` sets the framework (Vite), the
   build, the functions and the security headers.
2. Create a Supabase project (the free plan is enough). Copy its **transaction
   pooler** connection string (Project Settings, Database, port 6543).
3. Add the environment variables below in Vercel (Settings, Environment
   Variables) and redeploy.
4. Open the deployment, **Sign in**, go to **Connections** and press **Apply
   the schema**. It runs every file in `supabase/migrations/` in order
   (`0001_match_log.sql`, then `0002_upcoming_requests_connector.sql`); each
   is safe to run again, or by hand in Supabase's SQL editor. A deployment
   whose schema is behind its build answers `503` until this is done.
5. On Connections, **mint a fleet token** for each Mac and put it in that
   Mac's `.env` (see below).

| Variable | What it is | Example |
|---|---|---|
| `DATABASE_URL` | Supabase's transaction pooler string | `postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres` |
| `MATCHDAY_PASSWORD` | the password for the page | a long passphrase |
| `MATCHDAY_SESSION_SECRET` | 32+ random characters that sign the sign-in cookie | `openssl rand -base64 48` |
| `MATCHDAY_TIMEZONE` (optional) | the zone reports cut days in when a caller names none; default `UTC` | `America/Chicago` |
| `MATCHDAY_PUBLIC_URL` (optional) | pins the connector's issuer and token audience to one address when the deployment has several | `https://matchday.example.com` |
| `MATCHDAY_CONNECTOR_REDIRECTS` (optional) | extra hosts an OAuth client may send a browser back to, comma-separated (`*` for any https host); Claude's own sites and `localhost` are always allowed | `cursor.sh` |
| `MATCHDAY_CONNECTOR_CIMD` (optional) | `0` makes Claude register through `/oauth/register` instead of naming itself by URL | `0` |

Every secret stays in Vercel. The page only ever learns the **names** of
these variables and whether each is set. Without `DATABASE_URL` the
deployment still works: it plays the demo.

## How a Mac connects

In the `.env` at the root of the repository the fleet works in (never
committed), or in the Mac's environment:

```sh
CLUB_RELAY_URL=https://<your app>.vercel.app
CLUB_RELAY_TOKEN=<the fleet token minted for this Mac>
```

The engine writes every row to its own `match_log.db` first, then sends it
to `POST /api/ingest` (in order, in batches of up to 500 rows). A Mac that is
offline keeps the rows and sends them later; `ogsf relay push` sends them by
hand. Revoking its token on Connections stops that Mac at its next send.

## The Claude connector

The deployment is also an MCP server, so Claude (the app, on any device, or
Claude Code) can read the fleet and queue work from anywhere:

- **Claude app:** Settings → Connectors → Add custom connector. URL:
  `https://<your app>.vercel.app/api/mcp`; leave the OAuth fields blank.
  Claude opens this deployment's consent page: enter `MATCHDAY_PASSWORD` and
  choose **Allow**.
- **Claude Code:** `claude mcp add --transport http matchday https://<your app>.vercel.app/api/mcp`,
  then `/mcp` to sign in.

Tools: `fleet_status`, `list_matches`, `get_match`, `daily_report`,
`multi_day_report`, `list_upcoming`, `queue_request`, `queue_ticket`,
`request_status`, `cancel_request`. The reports are the same Markdown the
page downloads. A queued request runs only on a Mac whose config says
`scheduler.accept_remote: true`, and only for the set pieces that Mac allows
(or a ticket its founder wrote); every match still passes the kickoff
checklist. Nothing in the connector can read a secret, archive a match or
change a setting.

How it is secured: OAuth 2.1 with PKCE (S256); codes that live two minutes
and work once; access tokens of an hour, bound to this deployment's
`/api/mcp`; rotated refresh tokens; and only SHA-256 hashes of any of them in
the database. A reused code or refresh token revokes the whole connection. A
client may send a browser back only to `claude.ai`, `claude.com` or
`localhost` unless `MATCHDAY_CONNECTOR_REDIRECTS` names more hosts, so a
stranger cannot register a client that leads your sign-in elsewhere.
**Connections** lists every live connection and revokes one or all. The page
you sign in on is `server/consent-page.ts`: no script, one hashed style.
Preview deployments behind Vercel's Deployment Protection cannot be reached
by Claude; use the production address.

## The API

Same paths on `ogsf var` and on Vercel. JSON, `cache-control: no-store`,
errors as `{"error": "<what to do next>"}`.

| Method · path | Answer |
|---|---|
| `GET /api/health` | `{ok, source, matches, store}` (cloud adds `configured`, `auth`) |
| `GET /api/matches?limit=200&archived=0\|1\|all` | `MatchSummary[]`: match rows with `objectives`, `objective_count`, `players` |
| `GET /api/matches/:id` | `{match, usage: {read, written}, objectives, players}` |
| `POST /api/matches/:id/archive` | body `{archived}` → `{match_id, archived}` |
| `GET /api/matches/:id/events?after=&limit=` | `{events, cursor, has_more}` |
| `GET /api/matches/:id/reports` · `/reviews` · `/processes` | rows |
| `GET /api/matches/:id/players/:player/team-talks` | `{system, user}` |
| `GET /api/live[?match=&after=]` | server-sent events: `events`, `match`, `matches`, `ping` |
| `GET /api/report-facts?since=&until=` | `ReportFacts`: the rows every report is computed from (`shared/report.ts`) |
| `GET /api/upcoming` | `UpcomingMatchRow[]`: the Upcoming Matches board, by due time |
| `GET /api/requests?limit=` · `POST /api/requests` · `POST /api/requests/:id/cancel` | run requests (`RequestRow`); a new one is `201` |
| Cloud only: `POST /api/ingest` | Bearer fleet token, `{machine, rows: [{table, row}]}` → `{accepted}` |
| Cloud only: `POST /api/fleet/claim` · `POST /api/fleet/requests/:id` | Bearer fleet token: a Mac's Scheduler claims a request, then reports it |
| Cloud only: `POST /api/mcp` · `/.well-known/oauth-*` · `/oauth/*` | the Claude connector (OAuth bearer), and the OAuth flow itself |
| Cloud only: `GET/POST/DELETE /api/session` | sign-in state, sign in, sign out |
| Cloud only: `/api/connections/status`, `/schema`, `/tokens[/:id]`, `/grants[/:id]` | the Connections page |

On Vercel, `vercel.json` rewrites `/api/:path*` to the single function
`api/router.ts` with the path in `?route=` (path parameters travel as query
parameters through a rewrite). `/api/live` is its own function so it can run
for five minutes; it follows Postgres by cursor once a second, writes a line
whenever something lands, pings every 15 seconds and closes after about four
minutes, and the browser's `EventSource` reconnects with `Last-Event-ID`.

Every route except health, session, ingest, the fleet routes, the connector
and its OAuth endpoints needs the sign-in cookie
(HttpOnly, Secure, SameSite=Strict, HMAC-SHA256 signed, seven days). A
state-changing request from another origin is refused even with it.

### What `ogsf var` must send for a deployed page to read it

A page on `https://<app>.vercel.app` reading `http://127.0.0.1:4600` is a
cross-origin request into the local network:

- `Access-Control-Allow-Origin: <the page's origin>` (or `*`; the page sends
  no cookies to a fleet), and `Vary: Origin`.
- For the preflight (`OPTIONS`): `Access-Control-Allow-Methods: GET, POST,
  OPTIONS`, `Access-Control-Allow-Headers: content-type`, and
  `Access-Control-Allow-Private-Network: true` when the request carries
  `Access-Control-Request-Private-Network: true` (Chrome's Private Network
  Access).
- The stream is `text/event-stream`, unbuffered.

Chrome may also ask the user for permission to reach the local network. The
page's CSP allows `connect-src` to `http://127.0.0.1:*`, `http://localhost:*`
and any `https:` address.

## The demo recording

`public/demo/matchday-demo.json` is a `DemoDataset` (`shared/types.ts`):

```ts
interface DemoDataset {
  version: 2 // 1 had no upcoming or requests
  generated_at: string // ISO-8601
  title: string
  matches: Array<{
    match: MatchRow
    objectives: ObjectiveRow[]
    players: PlayerRow[] // club_sessions rows, as the API returns them once the match is over
    events: EventRow[] // every event, each with its cursor, in cursor order
    reports: MatchReportRow[]
    reviews: OfficialReviewRow[]
    processes: ProcessRow[]
    team_talks: Array<{ player: string; system: string | null; user: string | null }>
  }>
  upcoming: UpcomingMatchRow[] // version 2: the Upcoming Matches board as the week ended
  requests: RequestRow[] // version 2: the run requests, newest first
}
```

`make demo-data` (`ogsf demo --export`) writes it from a real run of every
set piece: a working week, Monday 12 to Friday 16 October 2026, with a
sprint on the board and requests made on the page, through the real
Scheduler. `npm run demo:from-legacy` is the older way, from the six
scrubbed legacy runs in `archives/sample-runs/`.

The replay lays the matches end to end (oldest first, a short gap between
them, each keeping its own timing) and shows each one as the API would at
that moment: a match is `running` until its recorded end, an objective
appears when it started, an event when it was recorded (a tool call when it
ended), a player from its `raider_start` until its row exists. Speed: 1×,
10×, 60×, 300×, or jump to the end. The first visit opens a walkthrough.

## Layout

```
api/            Vercel Functions: router.ts (every route) and live.ts (the stream)
server/         the API: routes, queries, ingest, auth, connections, live, db, schema;
                facts and requests (version 2); oauth, cimd, consent-page, mcp (the connector)
shared/         the contract types, the players and usage rules, the ingest whitelist,
                the reports (report.ts, report-markdown.ts, report-facts.ts)
src/            the page: data/ (sources, replay, hooks), components/, pages/, lib/, styles/
public/demo/    the demo recording
scripts/        demo-from-legacy.mjs, sync-schema.mjs
../supabase/migrations/   the cloud schema, 0001 and 0002 (copied into server/schema.ts by scripts/sync-schema.mjs)
```

TypeScript is pinned to 5.9: TypeScript 7's package has no compiler API, and
Vercel's Node builder (`@vercel/node`) loads the project's own `typescript`
to compile the functions, so 7 would break the deployment.
