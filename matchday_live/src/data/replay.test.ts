import { describe, expect, it } from 'vitest'
import { at, tinyDataset } from './__fixtures__/tiny'
import { buildSchedule, detailOf, fingerprint, ms, snapshot, suggestSpeed } from './replay'

const ANCHOR = Date.parse('2030-01-01T00:00:00.000Z')

describe('buildSchedule', () => {
  it('lays the matches end to end, oldest first, keeping inner timing', () => {
    const schedule = buildSchedule(tinyDataset(), { gapMs: 2000, leadMs: 500 })
    expect(schedule.matches.map((m) => m.data.match.match_id)).toEqual(['m1', 'm2'])
    const [m1, m2] = schedule.matches
    expect(m1?.offsetMs).toBe(500)
    expect(m1?.durationMs).toBe(60_000)
    // The real gap (940 s) is replaced by the short one.
    expect(m2?.offsetMs).toBe(500 + 60_000 + 2000)
    expect(schedule.totalMs).toBe(500 + 60_000 + 2000 + 10_000)
  })

  it('records a span when it ends, and never lets recorded times go backwards', () => {
    const [m1] = buildSchedule(tinyDataset()).matches
    expect(m1?.eventTimes).toEqual([ms(at(0)), ms(at(1)), ms(at(20)), ms(at(59)), ms(at(60))])
  })

  it('suggests the slowest offered speed that plays it all in time', () => {
    const schedule = buildSchedule(tinyDataset(), { gapMs: 0, leadMs: 0 })
    expect(suggestSpeed(schedule, [1, 10, 60], 90)).toBe(1)
    expect(suggestSpeed(schedule, [1, 10, 60], 5)).toBe(60)
    expect(suggestSpeed(schedule, [1, 10, 60], 1)).toBe(60)
  })
})

describe('snapshot', () => {
  const schedule = buildSchedule(tinyDataset(), { gapMs: 2000, leadMs: 0 })
  const m1 = schedule.matches[0]!

  it('shows nothing before a match kicks off', () => {
    expect(snapshot(schedule.matches[1]!, 10_000, ANCHOR)).toBeNull()
  })

  it('shows a match mid-play as running, with only what had happened', () => {
    const snap = snapshot(m1, 15_000, ANCHOR)!
    expect(snap.running).toBe(true)
    expect(snap.match.status).toBe('running')
    expect(snap.match.ended_at).toBeNull()
    // The ls span ended at 20 s, so at 15 s it has not landed yet.
    expect(snap.events.map((e) => e.cursor)).toEqual([1, 2])
    const spec = snap.objectives.find((o) => o.name === 'spec')!
    expect(spec.status).toBe('running')
    expect(spec.ended_at).toBeNull()
    // The player is running: no club_sessions row yet, so it comes from its start.
    expect(snap.players).toHaveLength(1)
    expect(snap.players[0]).toMatchObject({ player: 'playmaker', club: null })
    expect(snap.reports).toHaveLength(0)
    expect(snap.match.total_tokens).toBe(0)
  })

  it('moves timestamps into the display frame without changing durations', () => {
    const snap = snapshot(m1, 15_000, ANCHOR)!
    expect(snap.match.started_at).toBe(new Date(ANCHOR).toISOString().replace('Z', '+00:00'))
    const start = snap.objectives.find((o) => o.name === 'spec')!.started_at
    expect(ms(start) - ANCHOR).toBe(1000)
  })

  it('shows the finished match exactly as recorded at the end', () => {
    const snap = snapshot(m1, 60_000, ANCHOR)!
    expect(snap.running).toBe(false)
    expect(snap.match.status).toBe('touchdown')
    expect(snap.match.total_tokens).toBe(500)
    expect(snap.events).toHaveLength(5)
    expect(snap.players[0]).toMatchObject({ club: 'pi', context_tokens: 100 })
    expect(snap.processes[0]?.ended_at).not.toBeNull()
    expect(detailOf(snap).usage).toEqual({ read: 15, written: 20 })
  })

  it('changes its fingerprint when an objective ends', () => {
    expect(fingerprint(snapshot(m1, 30_000, ANCHOR)!)).not.toBe(fingerprint(snapshot(m1, 60_000, ANCHOR)!))
  })
})
