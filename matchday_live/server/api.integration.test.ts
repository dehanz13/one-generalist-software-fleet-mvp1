/**
 * The cloud API end to end, against a real Postgres: PGlite (Postgres in
 * WebAssembly) behind its wire-protocol socket, reached by the same
 * `postgres` client and DATABASE_URL the deployment uses. Covers the
 * migrations, sign-in, the schema button, fleet tokens, ingest, every read
 * route, archive, the cross-site lock and the live stream; then version 2:
 * report facts, Upcoming Matches, the request lifecycle with two Macs racing
 * for work, and the Claude connector end to end (OAuth, then MCP).
 */
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { factsFromMatches } from '../shared/report-facts'
import { rangeReport } from '../shared/report'
import type {
  ConnectionsStatus,
  DemoMatch,
  EventsPage,
  FleetToken,
  HealthResponse,
  MatchDetail,
  MatchSummary,
  MintedToken,
  ReportFacts,
  RequestRow,
  UpcomingMatchRow,
} from '../shared/types'
import { tinyDataset, tinyDatasetV2 } from '../src/data/__fixtures__/tiny'
import type { ConnectorStatus } from './connections'

const PORT = 55_000 + Math.floor(Math.random() * 5_000)
let pg: PGlite
let server: PGLiteSocketServer
let handle: (request: Request) => Promise<Response>
let cookie = ''
let token = ''
/** The cloud cursor after m1's first two events (cursors are the cloud's own identity values). */
let afterTwo = 0

function rowsOf(m: DemoMatch) {
  return [
    { table: 'matches', row: m.match },
    ...m.objectives.map((row) => ({ table: 'objectives', row })),
    ...m.players.map((row) => ({ table: 'club_sessions', row })),
    ...m.team_talks.map((t) => ({
      table: 'team_talks',
      row: { match_id: m.match.match_id, player: t.player, system: t.system, user: t.user, updated_at: m.match.started_at },
    })),
    ...m.processes.map((row) => ({ table: 'processes', row })),
    ...m.events.map(({ cursor: _cursor, ...row }) => ({ table: 'events', row })),
    ...m.reports.map((row) => ({ table: 'match_reports', row })),
    ...m.reviews.map((row) => ({ table: 'official_reviews', row })),
  ]
}

const call = (path: string, init: RequestInit & { auth?: boolean } = {}) =>
  handle(
    new Request(`http://localhost/api/${path}`, {
      ...init,
      headers: { ...(init.auth === false ? {} : { cookie }), ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    }),
  )

beforeAll(async () => {
  pg = await PGlite.create()
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1', maxConnections: 20 })
  await server.start()
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`
  // PGlite is one Postgres session: the client must not interleave several connections on it.
  process.env.MATCHDAY_DB_POOL = '1'
  process.env.MATCHDAY_PASSWORD = 'correct horse battery'
  process.env.MATCHDAY_SESSION_SECRET = 's'.repeat(48)
  handle = (await import('./routes')).handle
}, 30_000)

afterAll(async () => {
  await server?.stop()
  await pg?.close()
})

describe('cloud API over Postgres', () => {
  it('says it is configured but has no schema yet, and refuses reads without signing in', async () => {
    const health = (await (await call('health', { auth: false })).json()) as HealthResponse
    expect(health).toMatchObject({ source: 'cloud', configured: true, auth: 'required', ok: false })
    expect(health.store).toContain('schema not applied')
    expect((await call('matches', { auth: false })).status).toBe(401)
  })

  it('signs in with the password only', async () => {
    const wrong = await call('session', { method: 'POST', body: JSON.stringify({ password: 'nope' }), auth: false })
    expect(wrong.status).toBe(401)
    const right = await call('session', { method: 'POST', body: JSON.stringify({ password: 'correct horse battery' }), auth: false })
    expect(right.status).toBe(200)
    const set = right.headers.get('set-cookie') ?? ''
    expect(set).toContain('HttpOnly')
    expect(set).toContain('SameSite=Strict')
    cookie = set.split(';')[0] ?? ''
    expect(await (await call('session')).json()).toEqual({ signed_in: true })
  })

  it('applies the schema from the page, twice without harm', async () => {
    const before = (await (await call('connections/status')).json()) as ConnectionsStatus & { connector: ConnectorStatus }
    expect(before.schema).toMatchObject({ applied: false, latest: 2 })
    expect(before.connector).toMatchObject({ url: 'http://localhost/api/mcp', ready: false, connections: null })
    expect(before.connector.reason).toContain('apply the schema')
    expect(before.env.map((e) => [e.name, e.set])).toEqual([
      ['DATABASE_URL', true],
      ['MATCHDAY_PASSWORD', true],
      ['MATCHDAY_SESSION_SECRET', true],
    ])
    expect(JSON.stringify(before)).not.toContain('correct horse')
    for (let i = 0; i < 2; i++) {
      const applied = await call('connections/schema', { method: 'POST' })
      expect(await applied.json()).toEqual({ applied: true, version: 2 })
    }
    const after = (await (await call('connections/status')).json()) as ConnectionsStatus & { connector: ConnectorStatus }
    expect(after.schema.applied).toBe(true)
    expect(after.connector).toEqual({ url: 'http://localhost/api/mcp', ready: true, reason: null, connections: 0 })
    expect(await (await call('health', { auth: false })).json()).toMatchObject({ ok: true, matches: 0 })
  })

  it('mints a fleet token that is shown once and stored as a hash', async () => {
    const minted = (await (await call('connections/tokens', { method: 'POST', body: JSON.stringify({ label: 'studio-mbp' }) })).json()) as MintedToken
    expect(minted.token).toMatch(/^mdl_/)
    token = minted.token
    const list = await (await call('connections/tokens')).json()
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toContain(token)
    const stored = await pg.query<{ token_hash: string }>('select token_hash from fleet_tokens')
    expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect((await call('connections/tokens', { method: 'POST', body: JSON.stringify({ label: '' }) })).status).toBe(400)
  })

  it('takes a Mac’s rows only with a live fleet token', async () => {
    const dataset = tinyDataset()
    const rows = dataset.matches.flatMap(rowsOf)
    const body = JSON.stringify({ machine: 'studio-mbp', rows })
    expect((await call('ingest', { method: 'POST', body, auth: false })).status).toBe(401)
    const bad = await call('ingest', { method: 'POST', body, auth: false, headers: { authorization: 'Bearer mdl_wrong' } })
    expect(bad.status).toBe(401)
    const ok = await call('ingest', { method: 'POST', body, auth: false, headers: { authorization: `Bearer ${token}` } })
    expect(await ok.json()).toEqual({ accepted: rows.length })
    // Sending the same rows again changes nothing: upserts by primary key.
    const again = await call('ingest', { method: 'POST', body, auth: false, headers: { authorization: `Bearer ${token}` } })
    expect(again.status).toBe(200)
    const refused = await call('ingest', {
      method: 'POST',
      auth: false,
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ machine: 'm', rows: [{ table: 'fleet_tokens', row: { id: 'x' } }] }),
    })
    expect(refused.status).toBe(400)
    const seen = ((await (await call('connections/tokens')).json()) as FleetToken[])[0]!
    expect(seen.last_seen_at).toBeTruthy()
  })

  it('lists matches newest first with their objectives and players', async () => {
    const list = (await (await call('matches')).json()) as MatchSummary[]
    expect(list.map((m) => m.match_id)).toEqual(['m2', 'm1'])
    const m1 = list[1]!
    expect(m1.objective_count).toBe(2)
    expect(m1.players.map((p) => p.player)).toEqual(['playmaker'])
    expect(typeof m1.total_tokens).toBe('number')
  })

  it('answers the match, its events by cursor, and its side tables', async () => {
    const detail = (await (await call('matches/m1')).json()) as MatchDetail
    expect(detail.usage).toEqual({ read: 15, written: 20 })
    expect(detail.objectives.map((o) => o.name)).toEqual(['ask', 'spec'])
    expect((await call('matches/nope')).status).toBe(404)
    expect((await call('matches/..%2F..')).status).toBe(400)

    const first = (await (await call('matches/m1/events?after=0&limit=2')).json()) as EventsPage
    expect(first.events).toHaveLength(2)
    expect(first.has_more).toBe(true)
    expect(typeof first.cursor).toBe('number')
    afterTwo = first.cursor
    const rest = (await (await call(`matches/m1/events?after=${first.cursor}&limit=500`)).json()) as EventsPage
    expect(rest.events.map((e) => e.event_id)).toEqual(['evt_m1_3', 'evt_m1_4', 'evt_m1_5'])
    expect(rest.has_more).toBe(false)
    expect(rest.events[1]?.tokens).toBe(500)

    expect(await (await call('matches/m1/reports')).json()).toHaveLength(1)
    expect(await (await call('matches/m1/reviews')).json()).toHaveLength(1)
    expect(await (await call('matches/m1/processes')).json()).toHaveLength(1)
    expect(await (await call('matches/m1/players/playmaker/team-talks')).json()).toEqual({ system: '# Playmaker', user: 'plan it' })
    expect(await (await call('matches/m1/players/nobody/team-talks')).json()).toEqual({ system: null, user: null })
  })

  it('archives on the page, and a Mac re-sending the match does not undo it', async () => {
    const archived = await call('matches/m1/archive', { method: 'POST', body: JSON.stringify({ archived: true }) })
    expect(await archived.json()).toEqual({ match_id: 'm1', archived: true })
    const resend = JSON.stringify({ machine: 'studio-mbp', rows: [{ table: 'matches', row: tinyDataset().matches[1]!.match }] })
    await call('ingest', { method: 'POST', body: resend, auth: false, headers: { authorization: `Bearer ${token}` } })
    expect(((await (await call('matches')).json()) as MatchSummary[]).map((m) => m.match_id)).toEqual(['m2'])
    expect(((await (await call('matches?archived=1')).json()) as MatchSummary[]).map((m) => m.match_id)).toEqual(['m1'])
  })

  it('refuses a state change from another site, even signed in', async () => {
    const cross = await call('matches/m1/archive', {
      method: 'POST',
      body: JSON.stringify({ archived: false }),
      headers: { origin: 'https://evil.example' },
    })
    expect(cross.status).toBe(403)
  })

  it('streams the match, then new events, over server-sent events', async () => {
    const controller = new AbortController()
    const response = await handle(
      new Request(`http://localhost/api/live?match=m1&after=${afterTwo}`, { headers: { cookie }, signal: controller.signal }),
    )
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const deadline = Date.now() + 6000
    while (!text.includes('event: events') && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    controller.abort()
    await reader.cancel().catch(() => undefined)
    expect(text).toContain('retry: 2000')
    expect(text).toContain('event: match')
    const events = text.split('\n\n').find((block) => block.includes('event: events'))!
    const data = JSON.parse(events.split('\n').find((l) => l.startsWith('data: '))!.slice(6)) as EventsPage
    expect(data.events.map((e) => e.event_id)).toEqual(['evt_m1_3', 'evt_m1_4', 'evt_m1_5'])
    expect(events).toMatch(/^id: \d+/)
  }, 10_000)

  it('stops a revoked Mac at its next send', async () => {
    const id = ((await (await call('connections/tokens')).json()) as FleetToken[])[0]!.id
    expect((await call(`connections/tokens/${id}`, { method: 'DELETE' })).status).toBe(200)
    const body = JSON.stringify({ machine: 'studio-mbp', rows: [{ table: 'matches', row: { match_id: 'm3' } }] })
    const refused = await call('ingest', { method: 'POST', body, auth: false, headers: { authorization: `Bearer ${token}` } })
    expect(refused.status).toBe(401)
  })
})

// ── version 2 ────────────────────────────────────────────────────────────────

const ORIGIN = 'http://localhost'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
let macA = '' // fleet token of the Mac called "mac", which owns the fixture's tickets
let macB = '' // fleet token of "office-mbp"

const fleetCall = (path: string, token: string, body: unknown) =>
  call(path, { method: 'POST', auth: false, body: JSON.stringify(body), headers: { authorization: `Bearer ${token}` } })

async function mint(label: string): Promise<string> {
  return ((await (await call('connections/tokens', { method: 'POST', body: JSON.stringify({ label }) })).json()) as MintedToken).token
}

/** Sort every list by its JSON, so two sources that order rows differently compare equal. */
function normalised(facts: ReportFacts) {
  const sort = <T>(rows: T[]) => rows.map((r) => JSON.stringify(r)).sort()
  return {
    objectives: sort(facts.objectives),
    players: sort(facts.players),
    raider_ends: sort(facts.raider_ends),
    reviews: sort(facts.reviews),
    reports: sort(facts.reports),
    errors: sort(facts.errors),
    qa_casts: sort(facts.qa_casts),
  }
}

describe('version 2: report facts, Upcoming Matches and requests', () => {
  it('relays a Mac’s planned tickets and the ticket each match played', async () => {
    macA = await mint('studio-mbp')
    macB = await mint('office-mbp')
    const v2 = tinyDatasetV2()
    const rows = [
      ...v2.matches.flatMap(rowsOf),
      ...(v2.upcoming ?? []).map((row) => ({ table: 'upcoming_matches', row })),
    ]
    const sent = await fleetCall('ingest', macA, { machine: 'mac', rows })
    expect(await sent.json()).toEqual({ accepted: rows.length })
    const refused = await fleetCall('ingest', macA, { machine: 'mac', rows: [{ table: 'requests', row: { request_id: 'req_x' } }] })
    expect(refused.status).toBe(400)

    const upcoming = (await (await call('upcoming')).json()) as UpcomingMatchRow[]
    expect(upcoming.map((t) => t.ticket_id)).toEqual(['KICK-1', 'KICK-3', 'KICK-2']) // by due_at
    expect(upcoming[0]).toEqual(v2.upcoming![0])
    const m1 = (await (await call('matches/m1')).json()) as MatchDetail
    expect(m1.match.ticket_id).toBe('KICK-1')
    expect((await call('upcoming', { auth: false })).status).toBe(401)
  })

  it('answers report facts that agree with the same rows read locally', async () => {
    const since = '2026-10-17T00:00:00Z'
    const until = '2026-10-18T00:00:00Z'
    const response = await call(`report-facts?since=${since}&until=${until}`)
    expect(response.status).toBe(200)
    const cloud = (await response.json()) as ReportFacts
    expect(cloud.since).toBe('2026-10-17T00:00:00.000+00:00')
    expect(cloud.matches.map((m) => m.match_id)).toEqual(['m1', 'm2'])
    const local = factsFromMatches(tinyDatasetV2().matches, cloud.since, cloud.until)
    expect(normalised(cloud)).toEqual(normalised(local))
    expect(cloud.raider_ends).toHaveLength(1)
    const cloudReport = rangeReport(cloud, { timeZone: 'UTC', now: new Date('2026-10-18T00:00:00Z') })
    const localReport = rangeReport(local, { timeZone: 'UTC', now: new Date('2026-10-18T00:00:00Z') })
    expect(cloudReport.totals).toEqual(localReport.totals)
    expect(cloudReport.agents).toEqual(localReport.agents)

    // The range must be two ISO instants, in order, at most 92 days apart; and it is a parameter, never SQL.
    for (const bad of [
      'report-facts',
      'report-facts?since=yesterday&until=today',
      `report-facts?since=${until}&until=${since}`,
      'report-facts?since=2026-01-01&until=2026-06-01',
      "report-facts?since=2026-10-17'%20or%201=1--&until=2026-10-18",
      'report-facts?since=2026-02-31&until=2026-03-02',
    ]) {
      expect((await call(bad)).status, bad).toBe(400)
    }
    expect((await call(`report-facts?since=${since}&until=${until}`, { auth: false })).status).toBe(401)
  })

  it('checks a new request before it is queued, and records the page as asking', async () => {
    const post = (body: unknown) => call('requests', { method: 'POST', body: JSON.stringify(body) })
    expect((await post({})).status).toBe(400)
    expect((await post({ kind: 'set_piece', set_piece: 'rm-rf', prompt: 'x' })).status).toBe(400)
    expect((await post({ kind: 'set_piece', set_piece: 'ask', prompt: '   ' })).status).toBe(400)
    expect((await post({ kind: 'set_piece', set_piece: 'ask', prompt: 'x'.repeat(20_001) })).status).toBe(400)
    expect((await post({ kind: 'set_piece', set_piece: 'attack', prompt: 'x', player: 'ranger' })).status).toBe(400)
    expect((await post({ kind: 'ticket', ticket_id: 'NOPE-1' })).status).toBe(404)
    const played = await post({ kind: 'ticket', ticket_id: 'KICK-1' })
    expect(played.status).toBe(409) // KICK-1 is a touchdown already
    expect(((await played.json()) as { error: string }).error).toContain('already touchdown')

    const asked = await post({ kind: 'set_piece', set_piece: 'ask', prompt: 'x'.repeat(20_000), player: 'ranger', requested_by: 'connector' })
    expect(asked.status).toBe(201)
    const row = (await asked.json()) as RequestRow
    expect(row).toMatchObject({ kind: 'set_piece', set_piece: 'ask', status: 'queued', requested_by: 'page', machine: null })
    expect(row.request_id).toMatch(/^req_[0-9a-f]{12}$/)
    expect(Object.keys(row)).not.toContain('claimed_token')

    const cross = await call('requests', {
      method: 'POST',
      body: JSON.stringify({ kind: 'set_piece', set_piece: 'ask', prompt: 'from elsewhere' }),
      headers: { origin: 'https://evil.example' },
    })
    expect(cross.status).toBe(403)
    expect((await call('requests', { method: 'POST', auth: false, body: '{}' })).status).toBe(401)
  })

  it('queues a ticket on the board, refuses it twice, and puts it back when cancelled', async () => {
    const ticket = async (id: string) =>
      ((await (await call('upcoming')).json()) as UpcomingMatchRow[]).find((t) => t.ticket_id === id)!
    const first = (await (await call('requests', { method: 'POST', body: JSON.stringify({ kind: 'ticket', ticket_id: 'KICK-2' }) })).json()) as RequestRow
    expect(first).toMatchObject({ kind: 'ticket', ticket_id: 'KICK-2', status: 'queued', set_piece: null })
    expect((await ticket('KICK-2')).status).toBe('queued')
    const twice = await call('requests', { method: 'POST', body: JSON.stringify({ kind: 'ticket', ticket_id: 'KICK-2' }) })
    expect(twice.status).toBe(409)

    const cancelled = await call(`requests/${first.request_id}/cancel`, { method: 'POST' })
    expect(await cancelled.json()).toMatchObject({ request_id: first.request_id, status: 'cancelled' })
    expect((await ticket('KICK-2')).status).toBe('scheduled')
    expect((await call(`requests/${first.request_id}/cancel`, { method: 'POST' })).status).toBe(409)
    expect((await call('requests/req_000000000000/cancel', { method: 'POST' })).status).toBe(404)

    const list = (await (await call('requests?limit=10')).json()) as RequestRow[]
    expect(list[0]!.request_id).toBe(first.request_id) // newest first
  })

  it('lets only a live fleet token near the queue', async () => {
    expect((await call('fleet/claim', { method: 'POST', auth: false, body: '{}' })).status).toBe(401)
    expect((await fleetCall('fleet/claim', 'mdl_forged', { machine: 'mac', accepts: ['ask'] })).status).toBe(401)
    expect((await fleetCall('fleet/claim', token, { machine: 'mac', accepts: ['ask'] })).status).toBe(401) // revoked above
    // A signed-in browser is not a Mac: the cookie opens nothing here.
    expect((await call('fleet/claim', { method: 'POST', body: JSON.stringify({ machine: 'mac', accepts: ['ask'] }) })).status).toBe(401)
    expect((await fleetCall('fleet/claim', macA, { machine: '../mac', accepts: ['ask'] })).status).toBe(400)
    expect((await fleetCall('fleet/claim', macA, { machine: 'mac', accepts: 'ask' })).status).toBe(400)
  })

  it('gives each queued request to exactly one Mac, even when two ask at once', async () => {
    // Clear the queue first: the long ask from the earlier test is the oldest.
    const drained = (await (await fleetCall('fleet/claim', macA, { machine: 'mac', accepts: ['ask'] })).json()) as { request: RequestRow }
    expect(drained.request).toMatchObject({ set_piece: 'ask', status: 'claimed', claimed_by: 'mac' })
    await fleetCall(`fleet/requests/${drained.request.request_id}`, macA, { status: 'refused', note: 'test' })

    const queue = async (body: object) =>
      ((await (await call('requests', { method: 'POST', body: JSON.stringify(body) })).json()) as RequestRow).request_id
    const one = await queue({ kind: 'set_piece', set_piece: 'run-heroic', prompt: 'one' })
    const two = await queue({ kind: 'set_piece', set_piece: 'run-heroic', prompt: 'two' })
    const bard = await queue({ kind: 'set_piece', set_piece: 'bard', prompt: 'not accepted anywhere' })
    const forB = await queue({ kind: 'set_piece', set_piece: 'ask', prompt: 'office only', machine: 'office-mbp' })

    const accepts = ['ask', 'run-heroic']
    const [a, b] = (await Promise.all([
      fleetCall('fleet/claim', macA, { machine: 'mac', accepts }).then((r) => r.json()),
      fleetCall('fleet/claim', macB, { machine: 'office-mbp', accepts }).then((r) => r.json()),
    ])) as Array<{ request: RequestRow | null }>
    const taken = [a!.request?.request_id, b!.request?.request_id]
    expect(new Set(taken).size).toBe(2)
    expect(taken.every((id) => id === one || id === two)).toBe(true)

    // Mac A cannot take a request addressed to office-mbp, or a set piece it does not accept.
    const none = (await (await fleetCall('fleet/claim', macA, { machine: 'mac', accepts })).json()) as { request: RequestRow | null }
    expect(none.request).toBeNull()
    const office = (await (await fleetCall('fleet/claim', macB, { machine: 'office-mbp', accepts })).json()) as { request: RequestRow }
    expect(office.request.request_id).toBe(forB)
    const rows = (await (await call('requests?limit=50')).json()) as RequestRow[]
    expect(rows.find((r) => r.request_id === bard)!.status).toBe('queued')
  })

  it('gives a ticket request to the Mac that owns the ticket', async () => {
    const made = (await (await call('requests', { method: 'POST', body: JSON.stringify({ kind: 'ticket', ticket_id: 'KICK-3' }) })).json()) as RequestRow
    const office = (await (await fleetCall('fleet/claim', macB, { machine: 'office-mbp', accepts: ['ask'] })).json()) as { request: RequestRow | null }
    expect(office.request).toBeNull() // KICK-3 belongs to "mac"
    const mac = (await (await fleetCall('fleet/claim', macA, { machine: 'mac', accepts: [] })).json()) as { request: RequestRow }
    expect(mac.request).toMatchObject({ request_id: made.request_id, kind: 'ticket', ticket_id: 'KICK-3', claimed_by: 'mac' })
  })

  it('moves a request forward only, and only for the Mac that claimed it', async () => {
    const rows = (await (await call('requests?limit=50')).json()) as RequestRow[]
    const mine = rows.find((r) => r.ticket_id === 'KICK-3' && r.status === 'claimed')!
    const report = (who: string, body: object, id = mine.request_id) => fleetCall(`fleet/requests/${id}`, who, body)
    expect((await report(macB, { status: 'running' })).status).toBe(403)
    expect((await report(macA, { status: 'queued' })).status).toBe(400)
    expect((await report(macA, { status: 'running', match_id: 'm9' }, 'req_000000000000')).status).toBe(404)
    expect(await (await report(macA, { status: 'running', match_id: 'm9' })).json()).toEqual({ ok: true })
    expect((await report(macA, { status: 'claimed' })).status).toBe(409) // backwards
    expect((await report(macA, { status: 'touchdown', note: 'scored' })).status).toBe(200)
    expect((await report(macA, { status: 'turnover' })).status).toBe(409) // final
    const after = ((await (await call('requests?limit=50')).json()) as RequestRow[]).find((r) => r.request_id === mine.request_id)!
    expect(after).toMatchObject({ status: 'touchdown', match_id: 'm9', note: 'scored', claimed_by: 'mac' })
    expect((await call(`requests/${mine.request_id}/cancel`, { method: 'POST' })).status).toBe(409)
  })
})

// ── the Claude connector ────────────────────────────────────────────────────

interface Tokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  scope: string
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString()
const verifierFor = (seed: string) => seed.padEnd(64, seed)
const challengeFor = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')
let clientId = ''
let tokens: Tokens

function authorizeQuery(overrides: Record<string, string | null> = {}, verifier = verifierFor('v')): string {
  const params: Record<string, string | null> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challengeFor(verifier),
    code_challenge_method: 'S256',
    state: 'state-123',
    scope: 'matchday',
    resource: `${ORIGIN}/api/mcp`,
    ...overrides,
  }
  return new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== null)).toString()
}

/** The consent form's fields, as the page carries them. */
async function consentFields(query: string): Promise<Record<string, string>> {
  const page = await call(`oauth/authorize?${query}`, { auth: false })
  expect(page.status).toBe(200)
  const html = await page.text()
  return Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1]!, unescapeHtml(m[2]!)]))
}

function unescapeHtml(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

const consent = (fields: Record<string, string>, extra: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  call('oauth/authorize', {
    method: 'POST',
    auth: false,
    body: form({ ...fields, ...extra }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...headers },
  })

/** Sign in on the consent page and come back with a code. */
async function codeFor(verifier: string, redirectUri = CALLBACK): Promise<string> {
  const fields = await consentFields(authorizeQuery({ redirect_uri: redirectUri }, verifier))
  const answer = await consent(fields, { decision: 'allow', password: 'correct horse battery' })
  expect(answer.status).toBe(302)
  const location = new URL(answer.headers.get('location')!)
  expect(location.searchParams.get('state')).toBe('state-123')
  expect(location.searchParams.get('iss')).toBe(ORIGIN)
  return location.searchParams.get('code')!
}

const tokenCall = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  call('oauth/token', {
    method: 'POST',
    auth: false,
    body: form(fields),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  })

const exchange = (code: string, verifier: string, redirectUri = CALLBACK) =>
  tokenCall({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId, resource: `${ORIGIN}/api/mcp` })

let rpcId = 0
/** A legacy (initialize-era) MCP call. */
const mcp = (method: string, params: object = {}, accessToken = tokens?.access_token, headers: Record<string, string> = {}) =>
  call('mcp', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    headers: {
      accept: 'application/json, text/event-stream',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
  })

/** A modern (2026-07-28) MCP call: the version in _meta, mirrored into headers. */
const modern = (method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  mcp(
    method,
    { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } },
    tokens.access_token,
    {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      ...headers,
    },
  )

const toolText = async (response: Response) => {
  const body = (await response.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } }
  return { text: body.result.content[0]!.text, isError: body.result.isError === true }
}

describe('the Claude connector', () => {
  it('publishes where to sign in, and answers 401 with a pointer to it', async () => {
    const prm = await (await call('.well-known/oauth-protected-resource/api/mcp', { auth: false })).json()
    expect(prm).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN], scopes_supported: ['matchday'] })
    expect(await (await call('.well-known/oauth-protected-resource', { auth: false })).json()).toEqual(prm)
    const as = (await (await call('.well-known/oauth-authorization-server', { auth: false })).json()) as Record<string, unknown>
    expect(as).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    })
    expect(as.token_endpoint_auth_methods_supported).toContain('none')

    const anonymous = await mcp('initialize', {}, '')
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp", scope="matchday"`,
    )
    const forged = await mcp('initialize', {}, 'mda_forged')
    expect(forged.headers.get('www-authenticate')).toContain('error="invalid_token"')
    expect((await call('mcp', { method: 'GET', auth: false })).status).toBe(405)
  })

  it('registers a client dynamically, https or loopback redirects only', async () => {
    const register = (body: unknown) =>
      call('oauth/register', { method: 'POST', auth: false, body: JSON.stringify(body) })
    for (const uris of [['http://evil.example/cb'], ['javascript:alert(1)'], ['https://claude.ai/cb#frag'], []]) {
      const refused = await register({ redirect_uris: uris })
      expect(refused.status, JSON.stringify(uris)).toBe(400)
      expect(await refused.json()).toMatchObject({ error: 'invalid_redirect_uri' })
    }
    const made = await register({
      client_name: 'Claude',
      redirect_uris: [CALLBACK, 'http://localhost/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
    expect(made.status).toBe(201)
    const client = (await made.json()) as Record<string, unknown>
    expect(client).toMatchObject({ client_name: 'Claude', token_endpoint_auth_method: 'none', redirect_uris: [CALLBACK, 'http://localhost/callback'] })
    expect(client).not.toHaveProperty('client_secret')
    clientId = client.client_id as string
  })

  it('refuses to send the browser anywhere it cannot trust', async () => {
    const page = (query: string) => call(`oauth/authorize?${query}`, { auth: false })
    const badRedirect = await page(authorizeQuery({ redirect_uri: 'https://evil.example/cb' }))
    expect(badRedirect.status).toBe(400)
    expect(badRedirect.headers.get('location')).toBeNull()
    expect(await badRedirect.text()).toContain('not one this client registered')
    const unknown = await page(authorizeQuery({ client_id: 'mdcl_nobodynobodynobody' }))
    expect(unknown.status).toBe(400)
    expect(unknown.headers.get('location')).toBeNull()
    // Once the redirect is trusted, mistakes go back to the client, with state and issuer.
    const noPkce = await page(authorizeQuery({ code_challenge: null }))
    expect(noPkce.status).toBe(302)
    const back = new URL(noPkce.headers.get('location')!)
    expect(`${back.origin}${back.pathname}`).toBe(CALLBACK)
    expect(back.searchParams.get('error')).toBe('invalid_request')
    expect(back.searchParams.get('state')).toBe('state-123')
    expect(back.searchParams.get('iss')).toBe(ORIGIN)
    const plain = await page(authorizeQuery({ code_challenge_method: 'plain' }))
    expect(new URL(plain.headers.get('location')!).searchParams.get('error')).toBe('invalid_request')
    const otherResource = await page(authorizeQuery({ resource: 'https://other.example/api/mcp' }))
    expect(new URL(otherResource.headers.get('location')!).searchParams.get('error')).toBe('invalid_target')
  })

  it('shows a consent page that says what the client can do, with a strict CSP', async () => {
    const page = await call(`oauth/authorize?${authorizeQuery()}`, { auth: false })
    const csp = page.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("form-action 'self' https://claude.ai")
    expect(csp).not.toContain('script-src')
    expect(page.headers.get('cache-control')).toBe('no-store')
    const html = await page.text()
    expect(html).toContain('<strong>Claude</strong> wants to connect')
    expect(html).toContain('claude.ai')
    expect(html).toContain('queue a run request')
    expect(html).toContain('It cannot')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/ style="/)
    // Claude Code's loopback redirect matches whatever its port, with a warning on the page.
    const loopback = await (await call(`oauth/authorize?${authorizeQuery({ redirect_uri: 'http://localhost:53682/callback' })}`, { auth: false })).text()
    expect(loopback).toContain('a program on this computer (localhost:53682)')
  })

  it('signs in only with the password, on this site, through an untouched form', async () => {
    const fields = await consentFields(authorizeQuery())
    expect(fields.csrf).toMatch(/^\d+\.[\w-]+$/)
    const elsewhere = await consent(fields, { decision: 'allow', password: 'correct horse battery' }, { origin: 'https://evil.example' })
    expect(elsewhere.status).toBe(403)
    const started = Date.now()
    const wrong = await consent(fields, { decision: 'allow', password: 'hunter2' })
    expect(wrong.status).toBe(401)
    expect(Date.now() - started).toBeGreaterThanOrEqual(550) // the flat delay on a wrong password
    expect(await wrong.text()).toContain('That password is not right.')
    // Swapping the redirect after the page was signed breaks the form token.
    const swapped = await consent({ ...fields, redirect_uri: 'http://localhost:9999/callback' }, { decision: 'allow', password: 'correct horse battery' })
    expect(swapped.status).toBe(400)
    expect(await swapped.text()).toContain('ran out or was changed')
    const denied = await consent(fields, { decision: 'deny' })
    expect(new URL(denied.headers.get('location')!).searchParams.get('error')).toBe('access_denied')
  })

  it('exchanges a code once, with the right verifier and redirect only', async () => {
    const verifier = verifierFor('a')
    const wrongVerifier = await exchange(await codeFor(verifier), verifierFor('b'))
    expect(wrongVerifier.status).toBe(400)
    expect(await wrongVerifier.json()).toMatchObject({ error: 'invalid_grant' })

    const otherRedirect = await exchange(await codeFor(verifier), verifier, 'http://localhost/callback')
    expect(await otherRedirect.json()).toMatchObject({ error: 'invalid_grant' })

    const asJson = await call('oauth/token', { method: 'POST', auth: false, body: JSON.stringify({ grant_type: 'authorization_code' }) })
    expect(asJson.status).toBe(400)

    // A code works once; the second use revokes what the first one made.
    const code = await codeFor(verifier)
    const first = await exchange(code, verifier)
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    const issued = (await first.json()) as Tokens
    expect(issued).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'matchday' })
    expect((await mcp('ping', {}, issued.access_token)).status).toBe(200)
    const again = await exchange(code, verifier)
    expect(await again.json()).toMatchObject({ error: 'invalid_grant' })
    expect((await mcp('ping', {}, issued.access_token)).status).toBe(401)

    // An expired code is refused too.
    const late = await codeFor(verifier)
    await pg.query(`update oauth_codes set expires_at = '2000-01-01T00:00:00.000+00:00' where used_at is null`)
    expect(await (await exchange(late, verifier)).json()).toMatchObject({ error: 'invalid_grant' })

    // Nothing secret is stored: only hashes.
    const stored = await pg.query<{ token_hash: string }>('select token_hash from oauth_tokens')
    expect(stored.rows.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true)
    expect(JSON.stringify(stored.rows)).not.toContain(issued.access_token)

    const good = await exchange(await codeFor(verifier), verifier)
    tokens = (await good.json()) as Tokens
  })

  it('speaks MCP to an initialize-era client: initialize, tools/list, daily_report', async () => {
    const init = await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    const initBody = (await init.json()) as { result: { protocolVersion: string; serverInfo: { name: string }; capabilities: object } }
    expect(initBody.result).toMatchObject({ protocolVersion: '2025-11-25', serverInfo: { name: 'matchday-live' }, capabilities: { tools: {} } })
    expect(init.headers.get('mcp-session-id')).toBeNull()
    const notified = await call('mcp', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      headers: { authorization: `Bearer ${tokens.access_token}`, 'mcp-protocol-version': '2025-11-25' },
    })
    expect(notified.status).toBe(202)

    const list = (await (await mcp('tools/list', {}, tokens.access_token, { 'mcp-protocol-version': '2025-11-25' })).json()) as {
      result: { tools: Array<{ name: string; inputSchema: { type: string } }> }
    }
    expect(list.result.tools.map((t) => t.name)).toEqual([
      'fleet_status',
      'list_matches',
      'get_match',
      'daily_report',
      'multi_day_report',
      'list_upcoming',
      'queue_request',
      'queue_ticket',
      'request_status',
      'cancel_request',
    ])
    expect(list.result.tools.every((t) => t.inputSchema.type === 'object')).toBe(true)

    const daily = await toolText(await mcp('tools/call', { name: 'daily_report', arguments: { date: '2026-10-17', timezone: 'UTC' } }))
    expect(daily.isError).toBe(false)
    expect(daily.text).toContain('# Sat 17 Oct 2026')
    expect(daily.text).toContain('## Agent performance')
    expect(daily.text).toContain('| playmaker |')

    const range = await toolText(await mcp('tools/call', { name: 'multi_day_report', arguments: { from: '2026-10-16', to: '2026-10-17' } }))
    expect(range.text).toContain('# Multi-day report')
    const tooLong = await toolText(await mcp('tools/call', { name: 'multi_day_report', arguments: { from: '2026-01-01', to: '2026-12-31' } }))
    expect(tooLong.isError).toBe(true)
    const unknownTool = (await (await mcp('tools/call', { name: 'drop_tables', arguments: {} })).json()) as { error: { code: number } }
    expect(unknownTool.error.code).toBe(-32602)
    expect((await (await mcp('resources/list')).json()) as object).toMatchObject({ error: { code: -32601 } })
  })

  it('speaks MCP to a 2026-07-28 client: per-request metadata, checked against the headers', async () => {
    const discover = (await (await modern('server/discover')).json()) as { result: { supportedVersions: string[]; resultType: string } }
    expect(discover.result.resultType).toBe('complete')
    expect(discover.result.supportedVersions).toContain('2026-07-28')
    const list = (await (await modern('tools/list')).json()) as { result: { resultType: string; tools: unknown[] } }
    expect(list.result).toMatchObject({ resultType: 'complete' })
    expect(list.result.tools).toHaveLength(10)

    const mismatch = await modern('tools/call', { name: 'fleet_status', arguments: {} }, { 'mcp-name': 'get_match' })
    expect(mismatch.status).toBe(400)
    expect(await mismatch.json()).toMatchObject({ error: { code: -32020 } })
    const noHeader = await mcp('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } })
    expect(noHeader.status).toBe(400)
    const future = await mcp('tools/list', { _meta: { 'io.modelcontextprotocol/protocolVersion': '2099-01-01' } }, tokens.access_token, {
      'mcp-protocol-version': '2099-01-01',
      'mcp-method': 'tools/list',
    })
    expect(future.status).toBe(400)
    expect(await future.json()).toMatchObject({ error: { code: -32022, data: { requested: '2099-01-01' } } })
    const missing = await modern('nothing/here')
    expect(missing.status).toBe(404)

    const status = await toolText(await modern('tools/call', { name: 'fleet_status', arguments: {} }))
    const fleetNow = JSON.parse(status.text) as { matches: { total: number }; macs: Array<{ label: string }> }
    expect(fleetNow.matches.total).toBeGreaterThanOrEqual(2)
    expect(fleetNow.macs.map((m) => m.label)).toContain('studio-mbp')
    expect(status.text).not.toMatch(/mdl_|token_hash/)
  })

  it('queues work as the connector, and follows and cancels it', async () => {
    const queued = await toolText(
      await modern('tools/call', { name: 'queue_request', arguments: { set_piece: 'ask', prompt: 'how did today go?', player: 'ranger' } }),
    )
    const made = (JSON.parse(queued.text) as { request: RequestRow }).request
    expect(made).toMatchObject({ requested_by: 'connector', status: 'queued', set_piece: 'ask' })
    const followed = await toolText(await modern('tools/call', { name: 'request_status', arguments: { request_id: made.request_id } }))
    expect(JSON.parse(followed.text)).toMatchObject({ request: { request_id: made.request_id, status: 'queued' } })
    const cancelled = await toolText(await modern('tools/call', { name: 'cancel_request', arguments: { request_id: made.request_id } }))
    expect(JSON.parse(cancelled.text)).toMatchObject({ status: 'cancelled' })
    const refused = await toolText(await modern('tools/call', { name: 'queue_request', arguments: { set_piece: 'shell', prompt: 'x' } }))
    expect(refused.isError).toBe(true)
    const ticket = await toolText(await modern('tools/call', { name: 'queue_ticket', arguments: { ticket_id: 'KICK-2' } }))
    expect(JSON.parse(ticket.text)).toMatchObject({ request: { kind: 'ticket', ticket_id: 'KICK-2', requested_by: 'connector' } })
  })

  it('rotates refresh tokens and ends a connection whose refresh token is replayed', async () => {
    const refresh = (refreshToken: string) =>
      tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId })
    const rotated = (await (await refresh(tokens.refresh_token)).json()) as Tokens
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token)
    expect((await mcp('ping', {}, rotated.access_token)).status).toBe(200)
    // A retry moments later is refused without ending the connection.
    expect(await (await refresh(tokens.refresh_token)).json()).toMatchObject({ error: 'invalid_grant' })
    expect((await mcp('ping', {}, rotated.access_token)).status).toBe(200)
    // The same replay long after is a copied token: the whole connection ends.
    await pg.query(`update oauth_tokens set revoked_at = '2000-01-01T00:00:00.000+00:00' where kind = 'refresh' and revoked_at is not null`)
    expect(await (await refresh(tokens.refresh_token)).json()).toMatchObject({ error: 'invalid_grant' })
    expect((await mcp('ping', {}, rotated.access_token)).status).toBe(401)
    expect(await (await refresh(rotated.refresh_token)).json()).toMatchObject({ error: 'invalid_grant' })

    const verifier = verifierFor('c')
    tokens = (await (await exchange(await codeFor(verifier), verifier)).json()) as Tokens
  })

  it('refuses an expired token, a token for another server, and a token in the URL', async () => {
    const inUrl = await call(`mcp?access_token=${tokens.access_token}`, {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(inUrl.status).toBe(401)
    const fromSite = await mcp('ping', {}, tokens.access_token, { origin: 'https://evil.example' })
    expect(fromSite.status).toBe(403)

    await pg.query(`update oauth_tokens set resource = 'https://other.example/api/mcp' where kind = 'access'`)
    expect((await mcp('ping')).status).toBe(401)
    await pg.query(`update oauth_tokens set resource = '${ORIGIN}/api/mcp', expires_at = '2000-01-01T00:00:00.000+00:00' where kind = 'access'`)
    const expired = await mcp('ping')
    expect(expired.status).toBe(401)
    expect(expired.headers.get('www-authenticate')).toContain('error="invalid_token"')
    // The client renews it with its refresh token, as Claude does on a 401.
    tokens = (await (await tokenCall({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })).json()) as Tokens
    expect((await mcp('ping')).status).toBe(200)
  })

  it('lists live connections on the Connections page and revokes them', async () => {
    const status = (await (await call('connections/status')).json()) as { connector: ConnectorStatus }
    expect(status.connector).toMatchObject({ ready: true, connections: 1 })
    const grants = (await (await call('connections/grants')).json()) as Array<{ grant_id: string; client_name: string; redirect_hosts: string[] }>
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({ client_name: 'Claude', redirect_hosts: ['claude.ai', 'localhost'] })
    expect(JSON.stringify(grants)).not.toMatch(/mda_|mdr_|_hash/)
    expect((await call('connections/grants', { auth: false })).status).toBe(401)
    expect((await call(`connections/grants/${grants[0]!.grant_id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await mcp('ping')).status).toBe(401)
    expect(await (await call('connections/grants')).json()).toEqual([])
  })

  it('takes a client known by its metadata document URL', async () => {
    const documentUrl = 'https://93.184.216.34/oauth/claude-client.json'
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) =>
      String(input) === documentUrl
        ? new Response(JSON.stringify({ client_id: documentUrl, client_name: 'Claude (CIMD)', redirect_uris: [CALLBACK] }), {
            headers: { 'content-type': 'application/json' },
          })
        : realFetch(input)) as typeof fetch
    try {
      clientId = documentUrl
      const fields = await consentFields(authorizeQuery())
      expect(fields.client_id).toBe(documentUrl)
      const verifier = verifierFor('d')
      const code = await codeFor(verifier)
      const issued = await exchange(code, verifier)
      expect(issued.status).toBe(200)
      // A document that does not name itself is refused.
      clientId = 'https://93.184.216.35/oauth/other.json'
      globalThis.fetch = (async () => new Response(JSON.stringify({ client_id: 'https://elsewhere.example/x', redirect_uris: [CALLBACK] }))) as typeof fetch
      const refused = await call(`oauth/authorize?${authorizeQuery()}`, { auth: false })
      expect(refused.status).toBe(400)
      expect(await refused.text()).toContain('does not name itself')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
