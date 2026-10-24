/**
 * Shaping reports for the page and the PDF: day windows, the presets, file
 * names, the day timeline's lanes, the per-day series, Upcoming Matches'
 * sprint board. Pure, so it is tested without a browser. The counting itself
 * lives in shared/report.ts.
 */
import type { DayReport, MatchLine, RangeReport } from '../../shared/report'
import { dayKey, toLogTime } from '../../shared/report'
import type { PlayerRow, UpcomingMatchRow } from '../../shared/types'

// ── days ─────────────────────────────────────────────────────────────────────

/** The viewer's IANA zone, or UTC when the browser will not say. */
export function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** "America/Chicago (CDT)": the zone and its short name at an instant. */
export function zoneLabel(timeZone: string, at: number = Date.now()): string {
  try {
    const short = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date(at))
      .find((p) => p.type === 'timeZoneName')?.value
    return short && short !== timeZone ? `${timeZone} (${short})` : timeZone
  } catch {
    return timeZone
  }
}

/** The calendar day an instant falls on in a zone. */
export function dayOf(instant: number, timeZone: string): string {
  return dayKey(toLogTime(instant), timeZone)
}

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

/** Days from `from` to `to` inclusive, oldest first. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let day = from; day <= to && out.length < 400; day = addDays(day, 1)) out.push(day)
  return out
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return (new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7
}

export function mondayOf(date: string): string {
  return addDays(date, -weekday(date))
}

/** The last `count` days up to and including `today`. */
export function lastDays(today: string, count: number): { from: string; to: string } {
  return { from: addDays(today, -(count - 1)), to: today }
}

// ── presets and files ────────────────────────────────────────────────────────

export interface Preset {
  id: 'last-7' | 'last-14' | 'sprint'
  label: string
  from: string
  to: string
}

export interface Sprint {
  name: string
  from: string
  to: string
}

/** The report presets: last 7 days, last 14 days, and the current sprint when Upcoming Matches names one. */
export function reportPresets(today: string, sprint: Sprint | null): Preset[] {
  const presets: Preset[] = [
    { id: 'last-7', label: 'Last 7 days', ...lastDays(today, 7) },
    { id: 'last-14', label: 'Last 14 days', ...lastDays(today, 14) },
  ]
  if (sprint) {
    // A sprint still under way is reported up to today.
    const to = sprint.to < today ? sprint.to : today
    if (sprint.from <= to) presets.push({ id: 'sprint', label: `This sprint (${sprint.name})`, from: sprint.from, to })
  }
  return presets
}

/** matchday-2026-10-12.pdf, or matchday-2026-10-12_to_2026-10-16.md for a range. */
export function reportFileName(from: string, to: string | null, extension: 'pdf' | 'md'): string {
  return to && to !== from ? `matchday-${from}_to_${to}.${extension}` : `matchday-${from}.${extension}`
}

// ── the day timeline ─────────────────────────────────────────────────────────

export interface TimelineBar {
  match: MatchLine
  lane: number
  /** Percent of the axis. */
  left: number
  width: number
}

export interface DayTimeline {
  bars: TimelineBar[]
  lanes: number
  start: number
  end: number
  ticks: Array<{ pct: number; at: number }>
}

const HOUR = 3_600_000

/**
 * The day's matches on one axis, from the hour before the first kick-off to
 * the hour after the last whistle. Matches that overlap get their own lane.
 * A match still running ends at `now`.
 */
export function dayTimeline(matches: MatchLine[], now: number): DayTimeline {
  const spans = matches
    .map((m) => {
      const start = Date.parse(m.started_at ?? '')
      const ended = Date.parse(m.ended_at ?? '')
      const end = Number.isFinite(ended) ? ended : Math.max(start, now)
      return { m, start, end }
    })
    .filter((s) => Number.isFinite(s.start))
    .sort((a, b) => a.start - b.start)
  if (!spans.length) return { bars: [], lanes: 0, start: 0, end: 0, ticks: [] }
  const start = Math.floor(Math.min(...spans.map((s) => s.start)) / HOUR) * HOUR
  const end = Math.max(start + HOUR, Math.ceil(Math.max(...spans.map((s) => s.end)) / HOUR) * HOUR)
  const span = end - start
  const laneEnds: number[] = []
  const bars = spans.map(({ m, start: s, end: e }) => {
    let lane = laneEnds.findIndex((last) => last <= s)
    if (lane === -1) lane = laneEnds.push(e) - 1
    else laneEnds[lane] = e
    return { match: m, lane, left: ((s - start) / span) * 100, width: Math.max(((e - s) / span) * 100, 0.6) }
  })
  const hours = span / HOUR
  const step = hours <= 6 ? 1 : hours <= 12 ? 2 : hours <= 18 ? 3 : 4
  const ticks: Array<{ pct: number; at: number }> = []
  for (let t = start; t <= end; t += step * HOUR) ticks.push({ pct: ((t - start) / span) * 100, at: t })
  return { bars, lanes: laneEnds.length, start, end, ticks }
}

/** "14:05" in a zone. */
export function clockIn(instant: number | string | null, timeZone: string): string {
  const t = typeof instant === 'string' ? Date.parse(instant) : instant
  if (t === null || !Number.isFinite(t)) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t))
}

// ── the multi-day series ─────────────────────────────────────────────────────

export interface DayPoint {
  date: string
  matches: number
  touchdowns: number
  turnovers: number
  running: number
  cost: number
}

/** One point per calendar day from `from` to `to`, quiet days included. */
export function dailySeries(report: RangeReport, from: string, to: string): DayPoint[] {
  const byDate = new Map(report.days.map((d) => [d.date, d]))
  return daysBetween(from, to).map((date) => {
    const day = byDate.get(date)
    return {
      date,
      matches: day?.totals.matches ?? 0,
      touchdowns: day?.totals.touchdowns ?? 0,
      turnovers: day?.totals.turnovers ?? 0,
      running: day?.totals.running ?? 0,
      cost: day?.totals.cost ?? 0,
    }
  })
}

/** A round axis maximum at or above `value`: 1, 2, 5, 10, 20, 50… */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power
  return 10 * power
}

/** An axis top for a count of matches: round, even, so its half is a whole number too. */
export function countMax(value: number): number {
  const top = Math.max(2, Math.ceil(niceMax(value)))
  return top % 2 ? top + 1 : top
}

/** "Mon 12 Oct 09:00" in a zone: a start or end that may be on another day. */
export function dayClockIn(instant: string, timeZone: string): string {
  const t = Date.parse(instant)
  if (!Number.isFinite(t)) return '—'
  const day = dayKey(toLogTime(t), timeZone)
  const [y, m, d] = day.split('-').map(Number)
  const names = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)))
  return `${names.replace(',', '')} ${clockIn(t, timeZone)}`
}

/** A stable colour per player name, the same on the page and in the PDF. */
export function playerTint(player: string, palette: readonly string[]): string {
  let hash = 0
  for (const ch of player) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return palette[hash % palette.length] ?? '#3b82f6'
}

/**
 * Each player's colour for a report: the one its config gave it (the colour
 * its lane has on the match page), else the next palette colour not taken.
 */
export function playerColors(rows: PlayerRow[], names: string[], palette: readonly string[]): Record<string, string> {
  const configured = new Map<string, string>()
  for (const row of rows) if (row.color && /^#[0-9a-f]{6}$/i.test(row.color)) configured.set(row.player, row.color)
  const colors: Record<string, string> = {}
  const taken = new Set<string>()
  const sorted = [...new Set(names)].sort()
  for (const name of sorted) {
    const own = configured.get(name)
    if (own) {
      colors[name] = own
      taken.add(own.toLowerCase())
    }
  }
  let next = 0
  for (const name of sorted) {
    if (colors[name]) continue
    const free = palette.find((c) => !taken.has(c.toLowerCase())) ?? palette[next++ % palette.length] ?? '#3b82f6'
    colors[name] = free
    taken.add(free.toLowerCase())
  }
  return colors
}

/** The day's outcome mix as a word for screen readers: "3 touchdowns, 1 turnover". */
export function outcomeWords(day: DayReport): string {
  const parts = [`${day.totals.touchdowns} touchdown${day.totals.touchdowns === 1 ? '' : 's'}`]
  parts.push(`${day.totals.turnovers} turnover${day.totals.turnovers === 1 ? '' : 's'}`)
  if (day.totals.running) parts.push(`${day.totals.running} running`)
  return parts.join(', ')
}

// ── Upcoming Matches ─────────────────────────────────────────────────────────

/**
 * The sprint to show: the one whose days include today, else the next one to
 * start, else the last one. Rows with no sprint name are grouped as one
 * unnamed sprint.
 */
export function currentSprint(rows: UpcomingMatchRow[], today: string): Sprint | null {
  const spans = new Map<string, Sprint>()
  for (const row of rows) {
    if (!row.date) continue
    const name = row.sprint ?? 'Unnamed sprint'
    const span = spans.get(name)
    if (!span) spans.set(name, { name, from: row.date, to: row.date })
    else {
      if (row.date < span.from) span.from = row.date
      if (row.date > span.to) span.to = row.date
    }
  }
  const all = [...spans.values()]
  if (!all.length) return null
  const now = all.filter((s) => s.from <= today && today <= s.to).sort((a, b) => b.from.localeCompare(a.from))[0]
  if (now) return now
  const next = all.filter((s) => s.from > today).sort((a, b) => a.from.localeCompare(b.from))[0]
  if (next) return next
  return all.sort((a, b) => b.to.localeCompare(a.to))[0] ?? null
}

export interface SprintBoard {
  /** The Monday the board starts on. */
  start: string
  /** Two rows of Monday–Friday. */
  weeks: string[][]
  /** Saturday and Sunday of both weeks. */
  weekend: string[]
  /** Tickets by date. */
  byDate: Map<string, UpcomingMatchRow[]>
  /** Tickets dated outside the two weeks, or not dated at all. */
  outside: UpcomingMatchRow[]
}

/** The two-week board starting on the Monday of `anchor`'s week. */
export function sprintBoard(rows: UpcomingMatchRow[], anchor: string): SprintBoard {
  const start = mondayOf(anchor)
  const weeks = [0, 7].map((offset) => [0, 1, 2, 3, 4].map((d) => addDays(start, offset + d)))
  const weekend = [5, 6, 12, 13].map((d) => addDays(start, d))
  const last = addDays(start, 13)
  const byDate = new Map<string, UpcomingMatchRow[]>()
  const outside: UpcomingMatchRow[] = []
  for (const row of rows) {
    if (!row.date || row.date < start || row.date > last) {
      outside.push(row)
      continue
    }
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row])
  }
  for (const list of byDate.values()) list.sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))
  return { start, weeks, weekend, byDate, outside }
}

/** "Mon 12" for a column head. */
export function shortDay(date: string): string {
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return `${names[weekday(date)]} ${Number(date.slice(8, 10))}`
}

/**
 * A due time in the ticket's own zone and in the viewer's, when they differ:
 * "09:00 CDT · 15:00 BST here".
 */
export function dueTimes(row: UpcomingMatchRow, viewer: string): { own: string; viewer: string | null } {
  const at = Date.parse(row.due_at ?? '')
  if (!Number.isFinite(at)) return { own: row.time ?? 'default time', viewer: null }
  const short = (tz: string) => {
    try {
      return (
        new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
          .formatToParts(new Date(at))
          .find((p) => p.type === 'timeZoneName')?.value ?? tz
      )
    } catch {
      return tz
    }
  }
  const ownZone = row.timezone ?? viewer
  const own = `${clockIn(at, ownZone)} ${short(ownZone)}`
  const mine = `${clockIn(at, viewer)} ${short(viewer)}`
  return { own, viewer: mine === own ? null : mine }
}
