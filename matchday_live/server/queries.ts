/**
 * The read side of the API over Supabase: the same answers `ogsf var` gives
 * from a Mac's SQLite file (wiki/DATA-CONTRACT.md).
 */
import { mergePlayers, usageFromEvents } from '../shared/players.js'
import type {
  EventRow,
  EventsPage,
  MatchDetail,
  MatchReportRow,
  MatchRow,
  MatchSummary,
  ObjectiveRow,
  OfficialReviewRow,
  PlayerRow,
  ProcessRow,
  TeamTalks,
} from '../shared/types.js'
import { nowIso, type Sql } from './db.js'

export const MAX_LIMIT = 1000
export const DEFAULT_EVENTS_LIMIT = 500

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

const MATCH_COLUMNS = `match_id, setpiece_name, ask, status, founder, project, machine, started_at,
  ended_at, total_tokens, total_cost, archived, updated_at, ticket_id`
const OBJECTIVE_COLUMNS = `objective_id, match_id, seq, name, kind, owner, description, status,
  attempt, retries, error, started_at, ended_at`
const EVENT_COLUMNS = `cursor, event_id, match_id, objective_id, parent_id, type, name,
  payload_json, tokens, started_at, ended_at`
const PLAYER_COLUMNS = `match_id, player, club, model, color, session_id, context_tokens,
  context_window, created_at, last_used_at`

/** "0" (default): matches not archived. "1": archived only. "all": both. */
export type ArchivedFilter = '0' | '1' | 'all'

export async function listMatches(sql: Sql, limit: number, archived: ArchivedFilter): Promise<MatchSummary[]> {
  const where = archived === 'all' ? '' : `where coalesce(archived, 0) = ${archived === '1' ? 1 : 0}`
  const matches = (await sql.unsafe(
    `select ${MATCH_COLUMNS} from matches ${where}
      order by started_at desc nulls last, match_id desc limit $1`,
    [clamp(limit, 1, MAX_LIMIT)],
  )) as unknown as MatchRow[]
  if (!matches.length) return []
  const ids = matches.map((m) => m.match_id)
  const [objectives, clubSessions, starts] = await Promise.all([
    sql.unsafe(`select ${OBJECTIVE_COLUMNS} from objectives where match_id = any($1) order by seq`, [ids]),
    sql.unsafe(`select ${PLAYER_COLUMNS} from club_sessions where match_id = any($1)`, [ids]),
    sql.unsafe(
      `select ${EVENT_COLUMNS} from events where match_id = any($1) and type = 'raider_start' order by cursor`,
      [ids],
    ),
  ])
  const byMatch = <T extends { match_id: string }>(rows: T[]) => {
    const map = new Map<string, T[]>()
    for (const row of rows) {
      const list = map.get(row.match_id)
      if (list) list.push(row)
      else map.set(row.match_id, [row])
    }
    return map
  }
  const objectivesBy = byMatch(objectives as unknown as ObjectiveRow[])
  const playersBy = byMatch(clubSessions as unknown as PlayerRow[])
  const startsBy = byMatch(starts as unknown as EventRow[])
  return matches.map((match) => {
    const ownObjectives = objectivesBy.get(match.match_id) ?? []
    return {
      ...match,
      objectives: ownObjectives,
      objective_count: ownObjectives.length,
      players: mergePlayers(playersBy.get(match.match_id) ?? [], startsBy.get(match.match_id) ?? [], ownObjectives),
    }
  })
}

export async function matchRow(sql: Sql, matchId: string): Promise<MatchRow | null> {
  const rows = (await sql.unsafe(`select ${MATCH_COLUMNS} from matches where match_id = $1`, [
    matchId,
  ])) as unknown as MatchRow[]
  return rows[0] ?? null
}

export async function matchDetail(sql: Sql, matchId: string): Promise<MatchDetail | null> {
  const match = await matchRow(sql, matchId)
  if (!match) return null
  const [objectives, clubSessions, playerEvents] = await Promise.all([
    sql.unsafe(`select ${OBJECTIVE_COLUMNS} from objectives where match_id = $1 order by seq`, [matchId]),
    sql.unsafe(`select ${PLAYER_COLUMNS} from club_sessions where match_id = $1`, [matchId]),
    sql.unsafe(
      `select ${EVENT_COLUMNS} from events where match_id = $1 and type in ('raider_start', 'raider_end') order by cursor`,
      [matchId],
    ),
  ])
  const ownObjectives = objectives as unknown as ObjectiveRow[]
  const events = playerEvents as unknown as EventRow[]
  return {
    match,
    usage: usageFromEvents(events),
    objectives: ownObjectives,
    players: mergePlayers(clubSessions as unknown as PlayerRow[], events, ownObjectives),
  }
}

/** The polling query: cursor, insertion order, a bounded page. */
export async function eventsPage(sql: Sql, matchId: string, after: number, limit: number): Promise<EventsPage> {
  const capped = clamp(limit, 1, MAX_LIMIT)
  const from = Math.max(0, Number.isFinite(after) ? Math.trunc(after) : 0)
  const events = (await sql.unsafe(
    `select ${EVENT_COLUMNS} from events where match_id = $1 and cursor > $2 order by cursor limit $3`,
    [matchId, from, capped],
  )) as unknown as EventRow[]
  const last = events[events.length - 1]
  return { events: [...events], cursor: last ? last.cursor : from, has_more: events.length === capped }
}

export async function reports(sql: Sql, matchId: string): Promise<MatchReportRow[]> {
  return [
    ...((await sql.unsafe(
      `select report_id, match_id, objective_id, player, report_type, payload_json, valid, attempt, created_at
         from match_reports where match_id = $1 order by created_at, report_id`,
      [matchId],
    )) as unknown as MatchReportRow[]),
  ]
}

export async function reviews(sql: Sql, matchId: string): Promise<OfficialReviewRow[]> {
  return [
    ...((await sql.unsafe(
      `select review_id, match_id, objective_id, attempt, review, passed, violations_json, checks_json, created_at
         from official_reviews where match_id = $1 order by created_at, review_id`,
      [matchId],
    )) as unknown as OfficialReviewRow[]),
  ]
}

export async function processes(sql: Sql, matchId: string): Promise<ProcessRow[]> {
  return [
    ...((await sql.unsafe(
      `select process_id, match_id, kind, name, pid, command, started_at, ended_at
         from processes where match_id = $1 order by started_at, process_id`,
      [matchId],
    )) as unknown as ProcessRow[]),
  ]
}

export async function teamTalks(sql: Sql, matchId: string, player: string): Promise<TeamTalks> {
  const rows = (await sql.unsafe(`select system, "user" from team_talks where match_id = $1 and player = $2`, [
    matchId,
    player,
  ])) as unknown as TeamTalks[]
  const row = rows[0]
  return { system: row?.system ?? null, user: row?.user ?? null }
}

/** Archive or restore a match. False when there is no such match. */
export async function setArchived(sql: Sql, matchId: string, archived: boolean): Promise<boolean> {
  const rows = await sql.unsafe(
    `update matches set archived = $1, updated_at = $2 where match_id = $3 returning match_id`,
    [archived ? 1 : 0, nowIso(), matchId],
  )
  return rows.length > 0
}

export async function matchCount(sql: Sql): Promise<number> {
  const rows = (await sql.unsafe(`select count(*)::int as n from matches`)) as unknown as Array<{ n: number }>
  return rows[0]?.n ?? 0
}

/** The latest change to any match: the list's live signal. */
export async function latestUpdate(sql: Sql): Promise<string | null> {
  const rows = (await sql.unsafe(`select max(updated_at) as u from matches`)) as unknown as Array<{ u: string | null }>
  return rows[0]?.u ?? null
}
