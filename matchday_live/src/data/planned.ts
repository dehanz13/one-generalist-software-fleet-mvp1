/**
 * Upcoming Matches and requests in a replay. A version 2 recording holds each
 * ticket and request in its final state; what it looked like at any moment
 * follows from the match it is linked to:
 *
 *   before the match kicks off   scheduled, or due once its time has passed
 *                                (a request: queued)
 *   while the match plays        running
 *   after the final whistle      its final status
 *
 * A row with no match in the recording (skipped, refused, cancelled, or
 * still to come) keeps its own status once its time has passed.
 */
import type { MatchStatus, RequestRow, RequestStatus, UpcomingMatchRow, UpcomingStatus } from '../../shared/types'
import { ms, type ScheduledMatch } from './replay'

/** Where a linked match stands at the replay's moment. */
export type MatchPhase = { state: 'before' } | { state: 'running' } | { state: 'over'; status: MatchStatus | null }

export function phaseOf(item: ScheduledMatch, virtualMs: number): MatchPhase {
  if (virtualMs < item.offsetMs) return { state: 'before' }
  const cut = item.t0 + (virtualMs - item.offsetMs)
  const ended = ms(item.data.match.ended_at)
  const over = (Number.isFinite(ended) && ended <= cut) || virtualMs >= item.offsetMs + item.durationMs
  return over ? { state: 'over', status: item.data.match.status } : { state: 'running' }
}

const UPCOMING_FINAL = new Set<UpcomingStatus>(['touchdown', 'turnover', 'skipped'])
const REQUEST_FINAL = new Set<RequestStatus>(['touchdown', 'turnover', 'refused', 'cancelled'])

function passed(iso: string | null, now: number): boolean {
  const t = ms(iso)
  return Number.isFinite(t) && t <= now
}

/** A ticket as the board showed it at `now` (recording time). */
export function upcomingAt(row: UpcomingMatchRow, phase: MatchPhase | null, now: number): UpcomingMatchRow {
  const waiting: UpcomingStatus = passed(row.due_at, now) ? 'due' : 'scheduled'
  if (phase?.state === 'before') return { ...row, status: waiting, match_id: null, note: null }
  if (phase?.state === 'running') return { ...row, status: 'running' }
  if (phase?.state === 'over') {
    const final = row.status && UPCOMING_FINAL.has(row.status) ? row.status : (phase.status as UpcomingStatus | null)
    return { ...row, status: final ?? 'touchdown' }
  }
  // No match in the recording: its own status, once its time has come.
  if (!passed(row.due_at, now)) return { ...row, status: 'scheduled', note: null }
  if (row.status === 'scheduled' || row.status === null) return { ...row, status: 'due' }
  return row
}

/** A request as the panel showed it at `now` (recording time), or null before it was made. */
export function requestAt(row: RequestRow, phase: MatchPhase | null, now: number): RequestRow | null {
  const created = ms(row.created_at)
  if (Number.isFinite(created) && created > now) return null
  if (phase?.state === 'before') return { ...row, status: 'queued', claimed_by: null, match_id: null, note: null }
  if (phase?.state === 'running') return { ...row, status: 'running', claimed_by: row.claimed_by ?? row.machine }
  if (phase?.state === 'over') {
    const final = row.status && REQUEST_FINAL.has(row.status) ? row.status : (phase.status as RequestStatus | null)
    return { ...row, status: final ?? 'touchdown' }
  }
  // Refused or cancelled with no match: queued until the moment it was settled.
  if (row.status && REQUEST_FINAL.has(row.status) && !passed(row.updated_at ?? row.created_at, now)) {
    return { ...row, status: 'queued', claimed_by: null, note: null }
  }
  return row
}
