import { describe, expect, it } from 'vitest'
import type { MatchLine, RangeReport } from '../../shared/report'
import type { PlayerRow, UpcomingMatchRow } from '../../shared/types'
import {
  addDays,
  currentSprint,
  dailySeries,
  dayTimeline,
  dueTimes,
  lastDays,
  niceMax,
  playerColors,
  reportFileName,
  reportPresets,
  shortDay,
  sprintBoard,
} from './report-view'

const line = (id: string, start: string, end: string | null, outcome = 'touchdown'): MatchLine => ({
  match_id: id, setPiece: 'ask', ask: '', status: outcome, outcome, reason: null, started_at: start, ended_at: end,
  seconds: 0, cost: 0, billedTokens: 0, founder: null, machine: null, ticket_id: null, players: [], models: [],
})

const ticket = (id: string, date: string | null, patch: Partial<UpcomingMatchRow> = {}): UpcomingMatchRow => ({
  ticket_id: id, source: 'markdown', source_ref: 'set_pieces/upcoming/sprint-14.md', sprint: 'Sprint 14', title: id, date,
  time: '09:00', timezone: 'America/Chicago', due_at: date ? `${date}T14:00:00.000+00:00` : null, set_piece: 'ask', mode: 'auto',
  prompt: null, player: null, status: 'scheduled', match_id: null, machine: null, note: null, updated_at: null, ...patch,
})

describe('days and presets', () => {
  it('counts days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(lastDays('2026-10-16', 7)).toEqual({ from: '2026-10-10', to: '2026-10-16' })
  })

  it('offers the last 7 and 14 days, and this sprint up to today', () => {
    const presets = reportPresets('2026-10-16', { name: 'Sprint 14', from: '2026-10-12', to: '2026-10-23' })
    expect(presets.map((p) => [p.id, p.from, p.to])).toEqual([
      ['last-7', '2026-10-10', '2026-10-16'],
      ['last-14', '2026-10-03', '2026-10-16'],
      ['sprint', '2026-10-12', '2026-10-16'],
    ])
    expect(reportPresets('2026-10-16', null)).toHaveLength(2)
    // A sprint that has not started has nothing to report yet.
    expect(reportPresets('2026-10-16', { name: 'Sprint 15', from: '2026-10-26', to: '2026-11-06' })).toHaveLength(2)
  })

  it('names the files by their days', () => {
    expect(reportFileName('2026-10-12', null, 'pdf')).toBe('matchday-2026-10-12.pdf')
    expect(reportFileName('2026-10-12', '2026-10-12', 'md')).toBe('matchday-2026-10-12.md')
    expect(reportFileName('2026-10-12', '2026-10-16', 'md')).toBe('matchday-2026-10-12_to_2026-10-16.md')
  })

  it('rounds an axis up to a readable number', () => {
    expect([0, 0.3, 3, 7, 17, 240].map(niceMax)).toEqual([1, 0.5, 5, 10, 20, 250])
  })
})

describe('the day timeline', () => {
  it('spans whole hours and gives overlapping matches their own lane', () => {
    const t = dayTimeline(
      [
        line('a', '2026-10-12T14:00:00Z', '2026-10-12T14:30:00Z'),
        line('b', '2026-10-12T14:10:00Z', '2026-10-12T14:20:00Z', 'turnover'),
        line('c', '2026-10-12T14:40:00Z', '2026-10-12T15:20:00Z'),
      ],
      Date.parse('2026-10-12T20:00:00Z'),
    )
    expect(t.start).toBe(Date.parse('2026-10-12T14:00:00Z'))
    expect(t.end).toBe(Date.parse('2026-10-12T16:00:00Z'))
    expect(t.lanes).toBe(2)
    expect(t.bars.map((b) => [b.match.match_id, b.lane])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ])
    expect(t.bars[0]!.left).toBe(0)
    expect(t.bars[0]!.width).toBe(25)
    expect(t.ticks.map((x) => x.pct)).toEqual([0, 50, 100])
  })

  it('runs a match still playing up to now', () => {
    const t = dayTimeline([line('a', '2026-10-12T14:00:00Z', null, 'running')], Date.parse('2026-10-12T14:30:00Z'))
    expect(t.bars[0]!.width).toBe(50)
  })

  it('is empty with no matches', () => {
    expect(dayTimeline([], 0).bars).toEqual([])
  })
})

describe('the multi-day series', () => {
  it('has a point for every day, quiet ones at zero', () => {
    const day = (date: string, matches: number, cost: number) =>
      ({ date, totals: { matches, touchdowns: matches, turnovers: 0, running: 0, cost } }) as unknown as RangeReport['days'][number]
    const report = { days: [day('2026-10-12', 3, 1.5), day('2026-10-14', 1, 0.25)] } as RangeReport
    expect(dailySeries(report, '2026-10-12', '2026-10-15').map((p) => [p.date, p.matches, p.cost])).toEqual([
      ['2026-10-12', 3, 1.5],
      ['2026-10-13', 0, 0],
      ['2026-10-14', 1, 0.25],
      ['2026-10-15', 0, 0],
    ])
  })
})

describe('player colours', () => {
  it('keeps a configured colour and hands out unused ones to the rest', () => {
    const rows = [{ player: 'ranger', color: '#fbbf24' }, { player: 'builder', color: null }] as PlayerRow[]
    const colors = playerColors(rows, ['builder', 'ranger', 'bard', 'builder'], ['#fbbf24', '#111111', '#222222'])
    expect(colors).toEqual({ ranger: '#fbbf24', bard: '#111111', builder: '#222222' })
  })
})

describe('the sprint board', () => {
  const rows = [
    ticket('KICK-1', '2026-10-12'),
    ticket('KICK-2', '2026-10-16', { due_at: '2026-10-16T15:00:00.000+00:00' }),
    ticket('KICK-3', '2026-10-16', { due_at: '2026-10-16T14:00:00.000+00:00' }),
    ticket('KICK-4', '2026-10-17'),
    ticket('KICK-5', '2026-10-23'),
    ticket('KICK-6', '2026-11-02'),
    ticket('KICK-7', null),
  ]

  it('finds the sprint under way, else the next one, else the last', () => {
    expect(currentSprint(rows, '2026-10-14')).toEqual({ name: 'Sprint 14', from: '2026-10-12', to: '2026-11-02' })
    const two = [ticket('A-1', '2026-10-05', { sprint: 'Sprint 13' }), ticket('B-1', '2026-10-19', { sprint: 'Sprint 15' })]
    expect(currentSprint(two, '2026-10-12')?.name).toBe('Sprint 15')
    expect(currentSprint(two, '2026-11-12')?.name).toBe('Sprint 15')
    expect(currentSprint([], '2026-10-12')).toBeNull()
  })

  it('lays out two weeks of weekdays and the weekends apart', () => {
    const board = sprintBoard(rows, '2026-10-14')
    expect(board.start).toBe('2026-10-12')
    expect(board.weeks).toEqual([
      ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'],
      ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'],
    ])
    expect(board.weekend).toEqual(['2026-10-17', '2026-10-18', '2026-10-24', '2026-10-25'])
    expect(board.byDate.get('2026-10-16')!.map((r) => r.ticket_id)).toEqual(['KICK-3', 'KICK-2'])
    expect(board.byDate.get('2026-10-17')!.map((r) => r.ticket_id)).toEqual(['KICK-4'])
    expect(board.outside.map((r) => r.ticket_id)).toEqual(['KICK-6', 'KICK-7'])
    expect(shortDay('2026-10-17')).toBe('Sat 17')
  })

  it('shows a due time in the ticket’s zone and, when different, the viewer’s', () => {
    const row = ticket('KICK-1', '2026-10-12')
    expect(dueTimes(row, 'America/Chicago')).toEqual({ own: '09:00 CDT', viewer: null })
    expect(dueTimes(row, 'Europe/London')).toEqual({ own: '09:00 CDT', viewer: '15:00 GMT+1' })
    expect(dueTimes({ ...row, due_at: null, time: null }, 'UTC')).toEqual({ own: 'default time', viewer: null })
  })
})
