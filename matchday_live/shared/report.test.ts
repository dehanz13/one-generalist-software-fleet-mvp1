import { describe, expect, it } from 'vitest'
import { dailyReportMarkdown, rangeReportMarkdown } from './report-markdown.js'
import { dailyReports, dayKey, dayStart, rangeBounds, rangeReport } from './report.js'
import type { ReportFacts } from './types.js'

const usage = (input: number, output: number, cacheRead: number, cost: number) =>
  JSON.stringify({
    cost,
    usage: { input_tokens: input, output_tokens: output, cache_read_tokens: cacheRead, cache_write_tokens: 100, reasoning_tokens: 10, total_tokens: input + output + cacheRead + 100, total_cost: cost },
    context_tokens: 50_000,
    context_window: 200_000,
  })

/** Two matches on one Dallas evening that straddle midnight UTC, and one the next day. */
const facts: ReportFacts = {
  since: '2026-10-12T05:00:00.000+00:00',
  until: '2026-10-14T05:00:00.000+00:00',
  matches: [
    { match_id: 'a', setpiece_name: 'attack-var', ask: 'fix it', status: 'touchdown', founder: 'D', project: 'p', machine: 'mac', started_at: '2026-10-12T23:00:00.000+00:00', ended_at: '2026-10-12T23:10:00.000+00:00', total_tokens: 3000, total_cost: 0.5, archived: 0, updated_at: null },
    { match_id: 'b', setpiece_name: 'ask', ask: 'hello', status: 'turnover', founder: 'D', project: 'p', machine: 'mac', started_at: '2026-10-13T01:00:00.000+00:00', ended_at: '2026-10-13T01:00:30.000+00:00', total_tokens: 100, total_cost: 0.01, archived: 0, updated_at: null },
    { match_id: 'c', setpiece_name: 'ask', ask: 'again', status: 'touchdown', founder: 'D', project: 'p', machine: 'mac2', started_at: '2026-10-13T15:00:00.000+00:00', ended_at: '2026-10-13T15:01:00.000+00:00', total_tokens: 200, total_cost: 0.02, archived: 0, updated_at: null, ticket_id: 'KICK-1' },
  ],
  objectives: [
    { objective_id: 'a1', match_id: 'a', seq: 1, name: 'build', kind: 'player', owner: 'builder', description: 'x', status: 'touchdown', attempt: 1, retries: 0, error: null, started_at: '2026-10-12T23:00:00.000+00:00', ended_at: '2026-10-12T23:04:00.000+00:00' },
    { objective_id: 'a2', match_id: 'a', seq: 2, name: 'test_1', kind: 'referee', owner: 'qa', description: 'x', status: 'touchdown', attempt: 0, retries: 0, error: null, started_at: '2026-10-12T23:04:00.000+00:00', ended_at: '2026-10-12T23:05:00.000+00:00' },
    { objective_id: 'a3', match_id: 'a', seq: 3, name: 'iterate_1', kind: 'player', owner: 'builder', description: 'x', status: 'touchdown', attempt: 0, retries: 1, error: null, started_at: '2026-10-12T23:05:00.000+00:00', ended_at: '2026-10-12T23:07:00.000+00:00' },
    { objective_id: 'b1', match_id: 'b', seq: 1, name: 'answer', kind: 'player', owner: 'ranger', description: 'x', status: 'turnover', attempt: 0, retries: 0, error: 'pi provider error: You have no credits remaining.', started_at: '2026-10-13T01:00:00.000+00:00', ended_at: '2026-10-13T01:00:30.000+00:00' },
    { objective_id: 'c1', match_id: 'c', seq: 1, name: 'answer', kind: 'player', owner: 'ranger', description: 'x', status: 'touchdown', attempt: 0, retries: 0, error: null, started_at: '2026-10-13T15:00:00.000+00:00', ended_at: '2026-10-13T15:01:00.000+00:00' },
  ],
  players: [
    { match_id: 'a', player: 'builder', club: 'pi', model: 'anthropic/claude-sonnet-5-5', color: null, session_id: 's', context_tokens: 50_000, context_window: 200_000, created_at: null, last_used_at: null },
    { match_id: 'b', player: 'ranger', club: 'pi', model: 'anthropic/claude-haiku-4-5', color: null, session_id: 's', context_tokens: null, context_window: null, created_at: null, last_used_at: null },
    { match_id: 'c', player: 'ranger', club: 'pi', model: 'anthropic/claude-haiku-4-5', color: null, session_id: 's', context_tokens: 1000, context_window: 200_000, created_at: null, last_used_at: null },
  ],
  raider_ends: [
    { match_id: 'a', objective_id: 'a1', player: 'builder', tokens: 2000, payload_json: usage(1000, 400, 500, 0.3), started_at: null },
    { match_id: 'a', objective_id: 'a3', player: 'builder', tokens: 1000, payload_json: usage(500, 200, 200, 0.2), started_at: null },
    { match_id: 'c', objective_id: 'c1', player: 'ranger', tokens: 200, payload_json: usage(100, 50, 0, 0.02), started_at: null },
  ],
  reviews: [
    { match_id: 'a', objective_id: 'a1', review: 'replay_matches_report', passed: 0, attempt: 1, created_at: null },
    { match_id: 'a', objective_id: 'a1', review: 'replay_matches_report', passed: 1, attempt: 2, created_at: null },
    { match_id: 'a', objective_id: 'a3', review: 'replay_matches_report', passed: 1, attempt: 1, created_at: null },
  ],
  reports: [{ match_id: 'a', objective_id: 'a3', player: 'builder', report_type: 'AttackReport', valid: 0, attempt: 1, created_at: null }],
  errors: [],
  qa_casts: [{ match_id: 'a', objective_id: 'a2', name: 'qa:test', payload_json: '{"passed": false}', started_at: null, ended_at: null }],
}

describe('days', () => {
  it('cuts days in the named zone, across daylight saving', () => {
    expect(dayKey('2026-10-13T01:00:00.000+00:00', 'America/Chicago')).toBe('2026-10-12')
    expect(dayKey('2026-10-13T01:00:00.000+00:00', 'Europe/London')).toBe('2026-10-13')
    expect(dayStart('2026-10-12', 'America/Chicago')).toBe('2026-10-12T05:00:00.000+00:00')
    expect(dayStart('2026-11-02', 'America/Chicago')).toBe('2026-11-02T06:00:00.000+00:00') // after DST ends
    expect(rangeBounds('2026-10-12', '2026-10-13', 'America/Chicago')).toEqual({
      since: '2026-10-12T05:00:00.000+00:00',
      until: '2026-10-14T05:00:00.000+00:00',
    })
  })
})

describe('daily reports', () => {
  const days = dailyReports(facts, { timeZone: 'America/Chicago' })

  it('groups by the local day, newest first', () => {
    expect(days.map((d) => d.date)).toEqual(['2026-10-13', '2026-10-12'])
    expect(days[1]!.totals.matches).toBe(2) // 18:00 and 20:00 in Dallas on the 12th
  })

  it('tells a provider stop from a turnover and says why', () => {
    const evening = days[1]!
    expect(evening.totals.turnovers).toBe(1)
    expect(evening.totals.abandoned).toBe(1)
    const b = evening.matches.find((m) => m.match_id === 'b')!
    expect(b.outcome).toBe('abandoned')
    expect(b.reason).toContain('no credits')
  })

  it('counts cost, tokens and the work behind them', () => {
    const t = days[1]!.totals
    expect(t.cost).toBeCloseTo(0.51)
    expect(t.tokens.billed).toBe(3000 + 100) // b spent nothing on record, so its match total stands in
    expect(t.tokens.read).toBe(1000 + 100 + 500 + 100)
    expect(t.extraTime).toBe(1)
    expect(t.reviewsFailed).toBe(1)
    expect(t.invalidReplies).toBe(1)
    expect(t.qaFailed).toBe(1)
  })

  it('rates each player: first try means no correction and every review green at once', () => {
    const builder = days[1]!.agents.find((a) => a.player === 'builder')!
    expect(builder.objectives).toBe(2)
    expect(builder.touchdowns).toBe(2)
    expect(builder.firstTryRate).toBe(0) // a1 failed a review once; a3 needed a corrected reply
    expect(builder.extraTime).toBe(1)
    expect(builder.cost).toBeCloseTo(0.5)
    expect(builder.models).toEqual(['anthropic/claude-sonnet-5-5'])
    expect(builder.peakContext).toBeCloseTo(0.25)
  })
})

describe('the multi-day report', () => {
  const report = rangeReport(facts, { timeZone: 'America/Chicago', now: new Date('2026-10-14T00:00:00Z') })

  it('covers every day and rates players over the whole period', () => {
    expect(report.from).toBe('2026-10-12')
    expect(report.to).toBe('2026-10-13')
    expect(report.totals.matches).toBe(3)
    const ranger = report.agents.find((a) => a.player === 'ranger')!
    expect(ranger.objectives).toBe(2)
    expect(ranger.successRate).toBe(0.5)
    expect(ranger.matches).toBe(2)
    expect(report.summary).toContain('3 matches from Mon 12 Oct 2026 to Tue 13 Oct 2026')
  })

  it('writes Markdown with every section and a table per measure', () => {
    const md = rangeReportMarkdown(report)
    for (const heading of ['# Multi-day report', '## Agent performance', '## Models used', '## Set pieces', '## Day by day', '## Worth a look']) {
      expect(md).toContain(heading)
    }
    expect(md).toContain('| builder | claude-sonnet-5-5 |')
    expect(md).toContain('abandoned')
    expect(dailyReportMarkdown(report.days[0]!, 'America/Chicago')).toContain('## Agent performance')
  })
})
