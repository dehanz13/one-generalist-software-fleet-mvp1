import { describe, expect, it } from 'vitest'
import {
  axisTicks,
  durationOf,
  fmtAgo,
  fmtCost,
  fmtDuration,
  fmtMatchClock,
  fmtMoney,
  fmtOffset,
  fmtPercent,
  fmtTokens,
  hexAlpha,
  modelName,
  modelProvider,
} from './format'

describe('formatters', () => {
  it('formats durations at every scale', () => {
    expect(fmtDuration(420)).toBe('0.42s')
    expect(fmtDuration(9_800)).toBe('9.8s')
    expect(fmtDuration(187_000)).toBe('3m 07s')
    expect(fmtDuration(3_840_000)).toBe('1h 04m')
    expect(fmtDuration(Number.NaN)).toBe('—')
    expect(fmtDuration(-5)).toBe('—')
  })

  it('reads the scoreboard clock like a match clock', () => {
    expect(fmtMatchClock(0)).toBe('00:00')
    expect(fmtMatchClock(462_000)).toBe('07:42')
    expect(fmtMatchClock(4_062_000)).toBe('1:07:42')
    expect(fmtMatchClock(Number.NaN)).toBe('--:--')
  })

  it('formats tokens and money', () => {
    expect(fmtTokens(812)).toBe('812')
    expect(fmtTokens(41_300)).toBe('41.3k')
    expect(fmtTokens(1_446_786)).toBe('1.45M')
    expect(fmtTokens(null)).toBe('—')
    expect(fmtCost(0.0431)).toBe('$0.0431')
    expect(fmtCost(4.387)).toBe('$4.39')
    expect(fmtMoney(0)).toBe('$0')
    expect(fmtMoney(0.00001)).toBe('<$0.0001')
  })

  it('never rounds a real share down to zero', () => {
    expect(fmtPercent(1, 1000)).toBe('0.1%')
    expect(fmtPercent(373, 1000)).toBe('37%')
    expect(fmtPercent(1, 0)).toBe('—')
  })

  it('says how long ago in words', () => {
    const now = Date.parse('2026-10-17T12:00:00Z')
    expect(fmtAgo('2026-10-17T11:59:40Z', now)).toBe('just now')
    expect(fmtAgo('2026-10-17T11:56:00Z', now)).toBe('4 min ago')
    expect(fmtAgo('2026-10-17T09:00:00Z', now)).toBe('3 h ago')
    expect(fmtAgo('2026-10-15T12:00:00Z', now)).toBe('2 days ago')
  })

  it('steps the time axis and labels offsets compactly', () => {
    expect(fmtOffset(90_000)).toBe('1m30s')
    expect(fmtOffset(3_900_000)).toBe('1h05m')
    const ticks = axisTicks(600_000, 8)
    expect(ticks.length).toBeLessThanOrEqual(9)
    expect(ticks[0]).toEqual({ pct: 0, label: '0s' })
    expect(ticks.at(-1)?.pct).toBeLessThanOrEqual(100)
  })

  it('measures a running row to now and a finished one to its end', () => {
    const now = Date.parse('2026-10-17T12:10:00Z')
    expect(durationOf({ started_at: '2026-10-17T12:00:00Z', ended_at: null, status: 'running' }, now)).toBe(600_000)
    expect(
      durationOf({ started_at: '2026-10-17T12:00:00Z', ended_at: '2026-10-17T12:01:00Z', status: 'touchdown' }, now),
    ).toBe(60_000)
  })

  it('splits a model id and makes colours translucent', () => {
    expect(modelName('anthropic/claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(modelProvider('anthropic/claude-sonnet-5-5')).toBe('anthropic')
    expect(modelProvider('gpt-5')).toBe('')
    expect(hexAlpha('#a78bfa', 0.5)).toBe('rgba(167, 139, 250, 0.5)')
    expect(hexAlpha('var(--x)', 0.5)).toBe('transparent')
  })
})
