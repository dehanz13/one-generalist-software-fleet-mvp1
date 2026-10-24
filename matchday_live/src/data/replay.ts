/**
 * The demo replay: a recording of finished matches, played back so it looks
 * exactly like live use. Pure functions, no timers: the demo source drives
 * them with a clock.
 *
 * Time has three frames:
 * - original: the timestamps in the recording;
 * - virtual: milliseconds since the replay started, advanced by the clock
 *   at the chosen speed. Matches are laid end to end with a short gap, each
 *   keeping its own inner timing;
 * - display: what the page is shown, `anchor + virtual`. Timestamps never
 *   move once shown, so durations the page computes stay true.
 */
import { mergePlayers, parsePayload, usageFromEvents } from '../../shared/players'
import type {
  DemoDataset,
  DemoMatch,
  EventRow,
  MatchDetail,
  MatchReportRow,
  MatchRow,
  MatchSummary,
  ObjectiveRow,
  OfficialReviewRow,
  PlayerRow,
  ProcessRow,
  RaiderEndPayload,
} from '../../shared/types'

export interface ScheduledMatch {
  data: DemoMatch
  /** Virtual time the match starts at. */
  offsetMs: number
  /** Original time the match starts at. */
  t0: number
  /** Original span, start to last record. */
  durationMs: number
  /** Original time each event (in cursor order) was recorded, never decreasing. */
  eventTimes: number[]
}

export interface Schedule {
  matches: ScheduledMatch[]
  /** Virtual time at which the last match is over. */
  totalMs: number
}

export interface ScheduleOptions {
  /** Quiet time between one match ending and the next starting. */
  gapMs: number
  /** Quiet time before the first match. */
  leadMs: number
}

const DEFAULTS: ScheduleOptions = { gapMs: 2500, leadMs: 800 }

export function ms(iso: string | null | undefined): number {
  if (!iso) return Number.NaN
  return new Date(iso).getTime()
}

/** An original timestamp moved into the display frame. */
export function shiftIso(iso: string | null, shiftMs: number): string | null {
  const t = ms(iso)
  if (!Number.isFinite(t)) return iso
  return new Date(t + shiftMs).toISOString().replace('Z', '+00:00')
}

/** When an event landed in the log: a span is written when it ends. */
function recordedAt(e: EventRow): number {
  const end = ms(e.ended_at)
  if (Number.isFinite(end)) return end
  return ms(e.started_at)
}

/** Lay the recording's matches end to end, oldest first. */
export function buildSchedule(dataset: DemoDataset, options: Partial<ScheduleOptions> = {}): Schedule {
  const { gapMs, leadMs } = { ...DEFAULTS, ...options }
  const ordered = [...dataset.matches].sort((a, b) => ms(a.match.started_at) - ms(b.match.started_at))
  let offset = leadMs
  const matches: ScheduledMatch[] = []
  for (const data of ordered) {
    const events = [...data.events].sort((a, b) => a.cursor - b.cursor)
    const candidates = [
      ms(data.match.started_at),
      ...data.objectives.map((o) => ms(o.started_at)),
      ...events.slice(0, 1).map(recordedAt),
    ].filter(Number.isFinite)
    const t0 = candidates.length ? Math.min(...candidates) : 0
    const eventTimes: number[] = []
    let last = t0
    for (const e of events) {
      const t = recordedAt(e)
      last = Math.max(last, Number.isFinite(t) ? t : last)
      eventTimes.push(last)
    }
    const ends = [
      ms(data.match.ended_at),
      last,
      ...data.objectives.map((o) => ms(o.ended_at)),
      ...data.reports.map((r) => ms(r.created_at)),
    ].filter(Number.isFinite)
    const durationMs = Math.max(0, (ends.length ? Math.max(...ends) : t0) - t0)
    matches.push({ data: { ...data, events }, offsetMs: offset, t0, durationMs, eventTimes })
    offset += durationMs + gapMs
  }
  const lastMatch = matches[matches.length - 1]
  return { matches, totalMs: lastMatch ? lastMatch.offsetMs + lastMatch.durationMs : 0 }
}

/** The speed that plays the whole recording in about `targetSeconds`, from the offered ones. */
export function suggestSpeed(schedule: Schedule, speeds: number[], targetSeconds = 90): number {
  const wanted = schedule.totalMs / (targetSeconds * 1000)
  const sorted = [...speeds].sort((a, b) => a - b)
  return sorted.find((s) => s >= wanted) ?? sorted[sorted.length - 1] ?? 1
}

/** A match as the API would show it at virtual time `virtualMs`, or null before it starts. */
export interface MatchSnapshot {
  match: MatchRow
  objectives: ObjectiveRow[]
  players: PlayerRow[]
  events: EventRow[]
  reports: MatchReportRow[]
  reviews: OfficialReviewRow[]
  processes: ProcessRow[]
  teamTalks: DemoMatch['team_talks']
  running: boolean
}

export function snapshot(item: ScheduledMatch, virtualMs: number, anchorMs: number): MatchSnapshot | null {
  if (virtualMs < item.offsetMs) return null
  const cut = item.t0 + (virtualMs - item.offsetMs)
  const shift = anchorMs + item.offsetMs - item.t0
  const at = (iso: string | null) => shiftIso(iso, shift)
  const shown = (iso: string | null) => Number.isFinite(ms(iso)) && ms(iso) <= cut
  const { data } = item

  let visible = 0
  while (visible < data.events.length && (item.eventTimes[visible] ?? Infinity) <= cut) visible++
  const events = data.events.slice(0, visible).map((e) => ({ ...e, started_at: at(e.started_at), ended_at: at(e.ended_at) }))

  const objectives = data.objectives
    .filter((o) => shown(o.started_at))
    .map((o): ObjectiveRow => {
      const over = shown(o.ended_at)
      return {
        ...o,
        status: over ? o.status : 'running',
        error: over ? o.error : null,
        started_at: at(o.started_at),
        ended_at: over ? at(o.ended_at) : null,
      }
    })

  const clubSessions = data.players.filter((p) => shown(p.created_at)).map((p) => ({ ...p, created_at: at(p.created_at), last_used_at: at(p.last_used_at) }))
  const players = mergePlayers(clubSessions, events, objectives)

  const over = shown(data.match.ended_at) || virtualMs >= item.offsetMs + item.durationMs
  let tokens = 0
  let cost = 0
  for (const e of events) {
    if (e.type !== 'raider_end') continue
    tokens += e.tokens ?? 0
    const payload = parsePayload(e.payload_json) as RaiderEndPayload | null
    cost += typeof payload?.cost === 'number' ? payload.cost : 0
  }
  const lastChange = Math.min(cut, item.t0 + item.durationMs)
  const match: MatchRow = {
    ...data.match,
    status: over ? data.match.status : 'running',
    started_at: at(data.match.started_at),
    ended_at: over ? at(data.match.ended_at) : null,
    total_tokens: over ? data.match.total_tokens : tokens,
    total_cost: over ? data.match.total_cost : cost,
    updated_at: shiftIso(new Date(lastChange).toISOString(), shift),
  }

  const reports = data.reports.filter((r) => shown(r.created_at)).map((r) => ({ ...r, created_at: at(r.created_at) }))
  const reviews = data.reviews.filter((r) => shown(r.created_at)).map((r) => ({ ...r, created_at: at(r.created_at) }))
  const processes = data.processes
    .filter((p) => shown(p.started_at))
    .map((p) => ({ ...p, started_at: at(p.started_at), ended_at: shown(p.ended_at) ? at(p.ended_at) : null }))
  const playing = new Set(players.map((p) => p.player))
  const teamTalks = data.team_talks.filter((t) => playing.has(t.player))

  return { match, objectives, players, events, reports, reviews, processes, teamTalks, running: !over }
}

export function summaryOf(snap: MatchSnapshot): MatchSummary {
  return { ...snap.match, objectives: snap.objectives, objective_count: snap.objectives.length, players: snap.players }
}

export function detailOf(snap: MatchSnapshot): MatchDetail {
  return { match: snap.match, usage: usageFromEvents(snap.events), objectives: snap.objectives, players: snap.players }
}

/**
 * A short fingerprint of everything a match page shows besides the event
 * feed. When it changes, the page is sent a fresh detail.
 */
export function fingerprint(snap: MatchSnapshot): string {
  return [
    snap.match.status,
    snap.match.total_tokens,
    snap.objectives.map((o) => `${o.objective_id}:${o.status}`).join(','),
    snap.players.map((p) => `${p.player}:${p.club ?? '-'}`).join(','),
    snap.reports.length,
    snap.reviews.length,
    snap.processes.map((p) => `${p.process_id}:${p.ended_at ? 1 : 0}`).join(','),
  ].join('|')
}
