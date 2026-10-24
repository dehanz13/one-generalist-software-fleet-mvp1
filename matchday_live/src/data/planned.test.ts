import { afterEach, describe, expect, it, vi } from 'vitest'
import { rangeBounds } from '../../shared/report'
import { at, tinyDataset, tinyDatasetV2 } from './__fixtures__/tiny'
import { DemoSource, loadDemoDataset } from './demo'
import { requestAt, upcomingAt } from './planned'
import { ApiFailure } from './source'

// The tiny schedule: m1 plays virtual 800..60 800 ms (recording 10:00:00..10:01:00),
// a 2.5 s gap, then m2 plays 63 300..73 300 ms (recording 10:16:40..10:16:50).
const M1_START = 800
const M2_START = 63_300

function demoAt(virtualMs: number, dataset = tinyDatasetV2()): DemoSource {
  const demo = new DemoSource(dataset, { speed: 1, realNow: () => 0 })
  demo.clock.seek(virtualMs)
  return demo
}

const statusOf = <T extends { status: string | null }>(rows: T[], key: keyof T, id: string) =>
  rows.find((r) => r[key] === id)?.status

describe('the recording clock', () => {
  it('runs on the recording’s own timestamps and sweeps the idle time between matches', () => {
    expect(demoAt(0).calendarNow()).toBe(Date.parse(at(0)) - M1_START)
    expect(demoAt(M1_START + 30_000).calendarNow()).toBe(Date.parse(at(30)))
    expect(demoAt(M1_START + 60_000).calendarNow()).toBe(Date.parse(at(60)))
    // Halfway through the 2.5 s gap: halfway from m1's last record to m2's kick-off.
    expect(demoAt(M1_START + 60_000 + 1250).calendarNow()).toBe(Date.parse(at(530)))
    expect(demoAt(M2_START + 5_000).calendarNow()).toBe(Date.parse(at(1005)))
    // At the end: when the recording was made.
    expect(demoAt(Number.MAX_SAFE_INTEGER).calendarNow()).toBe(Date.parse(at(2000)))
  })
})

describe('Upcoming Matches in a replay', () => {
  it('is scheduled, or due once its time has passed, before its match kicks off', async () => {
    const rows = await demoAt(0).upcoming()
    expect(rows.map((r) => r.ticket_id)).toEqual(['KICK-1', 'KICK-3', 'KICK-2'])
    const kick1 = rows.find((r) => r.ticket_id === 'KICK-1')!
    expect(kick1.status).toBe('due')
    expect(kick1.match_id).toBeNull()
    expect(statusOf(rows, 'ticket_id', 'KICK-2')).toBe('scheduled')
    expect(statusOf(rows, 'ticket_id', 'KICK-3')).toBe('scheduled')
  })

  it('runs with its match (linked through matches.ticket_id) and ends with its final status', async () => {
    expect(statusOf(await demoAt(M1_START + 30_000).upcoming(), 'ticket_id', 'KICK-1')).toBe('running')
    expect(statusOf(await demoAt(M1_START + 60_500).upcoming(), 'ticket_id', 'KICK-1')).toBe('touchdown')
  })

  it('keeps an unplayed ticket’s own status once it is due', async () => {
    expect(statusOf(await demoAt(M1_START + 29_000).upcoming(), 'ticket_id', 'KICK-3')).toBe('scheduled')
    expect(statusOf(await demoAt(M1_START + 30_000).upcoming(), 'ticket_id', 'KICK-3')).toBe('skipped')
    const end = await demoAt(Number.MAX_SAFE_INTEGER).upcoming()
    expect(statusOf(end, 'ticket_id', 'KICK-2')).toBe('scheduled')
  })

  it('turns a scheduled row with no match into due when its time passes', () => {
    const row = tinyDatasetV2().upcoming![1]!
    expect(upcomingAt(row, null, Date.parse(at(4999))).status).toBe('scheduled')
    expect(upcomingAt(row, null, Date.parse(at(5000))).status).toBe('due')
  })
})

describe('requests in a replay', () => {
  it('appears only once it was made', async () => {
    expect(await demoAt(0).requests()).toEqual([])
    const later = await demoAt(Number.MAX_SAFE_INTEGER).requests()
    expect(later.map((r) => r.request_id)).not.toContain('req_later')
  })

  it('is queued until its match kicks off, running while it plays, then final', async () => {
    const gap = await demoAt(M2_START - 100).requests()
    expect(gap.map((r) => r.request_id)).toEqual(['req_m2', 'req_refused'])
    expect(statusOf(gap, 'request_id', 'req_m2')).toBe('queued')
    const playing = await demoAt(M2_START + 5_000).requests()
    const m2 = playing.find((r) => r.request_id === 'req_m2')!
    expect(m2.status).toBe('running')
    expect(m2.claimed_by).toBe('mac')
    expect(statusOf(await demoAt(Number.MAX_SAFE_INTEGER).requests(), 'request_id', 'req_m2')).toBe('turnover')
  })

  it('shows a refused request as queued until it was settled', async () => {
    expect(statusOf(await demoAt(M1_START + 30_000).requests(), 'request_id', 'req_refused')).toBe('queued')
    expect(statusOf(await demoAt(M1_START + 40_000).requests(), 'request_id', 'req_refused')).toBe('refused')
  })

  it('cannot be made or cancelled in the demo', async () => {
    const demo = demoAt(0)
    await expect(demo.createRequest()).rejects.toBeInstanceOf(ApiFailure)
    await expect(demo.cancelRequest()).rejects.toMatchObject({ status: 403 })
  })

  it('leaves a version 1 recording with no tickets and no requests', async () => {
    const demo = demoAt(Number.MAX_SAFE_INTEGER, tinyDataset())
    expect(await demo.upcoming()).toEqual([])
    expect(await demo.requests()).toEqual([])
  })

  it('reads a request with no match the same way outside the source', () => {
    const row = tinyDatasetV2().requests![1]!
    expect(requestAt(row, null, Date.parse(at(19)))).toBeNull()
    expect(requestAt(row, null, Date.parse(at(39)))?.status).toBe('queued')
    expect(requestAt(row, null, Date.parse(at(40)))?.status).toBe('refused')
  })
})

describe('report facts in a replay', () => {
  const { since, until } = rangeBounds('2026-10-17', '2026-10-17', 'UTC')

  it('shows a match still playing as running, its later rows cut', async () => {
    const facts = await demoAt(M1_START + 30_000).reportFacts(since, until)
    expect(facts.matches.map((m) => [m.match_id, m.status, m.ended_at])).toEqual([['m1', 'running', null]])
    expect(facts.raider_ends).toEqual([])
    expect(facts.objectives.find((o) => o.objective_id === 'm1_02_spec')?.status).toBe('running')
  })

  it('uses the recording’s own timestamps, not the replay’s', async () => {
    const facts = await demoAt(Number.MAX_SAFE_INTEGER).reportFacts(since, until)
    expect(facts.matches.map((m) => [m.match_id, m.status, m.started_at]).sort()).toEqual([
      ['m1', 'touchdown', at(0)],
      ['m2', 'turnover', at(1000)],
    ])
    expect(facts.raider_ends).toHaveLength(1)
  })

  it('leaves out matches outside the range', async () => {
    const next = rangeBounds('2026-10-18', '2026-10-18', 'UTC')
    expect((await demoAt(Number.MAX_SAFE_INTEGER).reportFacts(next.since, next.until)).matches).toEqual([])
  })
})

describe('loading a recording', () => {
  afterEach(() => vi.unstubAllGlobals())

  const serve = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))

  it('reads version 1 and version 2', async () => {
    serve(tinyDataset())
    expect((await loadDemoDataset('/demo.json')).version).toBe(1)
    serve(tinyDatasetV2())
    expect((await loadDemoDataset('/demo.json')).upcoming).toHaveLength(3)
  })

  it('refuses a version it does not know', async () => {
    serve({ ...tinyDataset(), version: 3 })
    await expect(loadDemoDataset('/demo.json')).rejects.toThrow(/format/)
  })
})
