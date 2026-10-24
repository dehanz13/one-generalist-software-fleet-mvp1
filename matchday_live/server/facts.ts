/**
 * GET /api/report-facts and the connector's report tools: the raw rows every
 * report is computed from. Selects exactly what shared/report-facts.ts
 * selects from the demo recording; the aggregation itself lives in
 * shared/report.ts, never in SQL, so the page, the downloads and the
 * connector agree to the cent.
 */
import type {
  ErrorFact,
  MatchRow,
  ObjectiveRow,
  PlayerRow,
  QaCastFact,
  RaiderEndFact,
  ReportFacts,
  ReportValidityFact,
  ReviewFact,
} from '../shared/types.js'
import { nowIso, type Sql } from './db.js'

/** A report covers at most a quarter: more would not fit one function response. */
export const MAX_REPORT_DAYS = 92

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

/**
 * An ISO-8601 instant ("2026-10-12" is midnight UTC, or a date-time with Z or
 * an offset), rewritten in the engine's own format so a text comparison with
 * the stored times is a time comparison. Null when it is not one.
 */
export function isoInstant(raw: string | null): string | null {
  if (!raw || raw.length > 40) return null
  const text = raw.trim()
  if (!DATE_ONLY.test(text) && !DATE_TIME.test(text)) return null
  const when = new Date(DATE_ONLY.test(text) ? `${text}T00:00:00Z` : text)
  if (Number.isNaN(when.getTime())) return null
  // Refuse a date the calendar rolled over (2026-02-31 → March 3rd).
  if (when.toISOString().slice(0, 10) !== text.slice(0, 10) && DATE_ONLY.test(text)) return null
  return nowIso(when)
}

export type FactsRange = { ok: true; since: string; until: string } | { ok: false; error: string }

/** Check `since` and `until`: both ISO instants, in order, at most MAX_REPORT_DAYS apart. */
export function factsRange(sinceRaw: string | null, untilRaw: string | null): FactsRange {
  const since = isoInstant(sinceRaw)
  const until = isoInstant(untilRaw)
  if (!since || !until) {
    return { ok: false, error: 'send since and until as ISO-8601 instants: 2026-10-12 or 2026-10-12T05:00:00Z' }
  }
  if (since >= until) return { ok: false, error: 'since must come before until' }
  if (Date.parse(until) - Date.parse(since) > MAX_REPORT_DAYS * 86_400_000) {
    return { ok: false, error: `a report covers at most ${MAX_REPORT_DAYS} days; ask for a shorter range` }
  }
  return { ok: true, since, until }
}

const IN_RANGE = `match_id in (select match_id from matches where started_at >= $1 and started_at < $2)`

/** The facts for the matches that started in [since, until). Both are already checked. */
export async function reportFacts(sql: Sql, since: string, until: string): Promise<ReportFacts> {
  const range = [since, until]
  const [matches, objectives, players, raiderEnds, reviews, reports, errors, qaCasts] = await Promise.all([
    sql.unsafe(
      `select match_id, setpiece_name, ask, status, founder, project, machine, started_at, ended_at,
              total_tokens, total_cost, archived, updated_at, ticket_id
         from matches where started_at >= $1 and started_at < $2 order by started_at, match_id`,
      range,
    ),
    sql.unsafe(
      `select objective_id, match_id, seq, name, kind, owner, description, status, attempt, retries, error,
              started_at, ended_at
         from objectives where ${IN_RANGE} order by match_id, seq`,
      range,
    ),
    sql.unsafe(
      `select match_id, player, club, model, color, session_id, context_tokens, context_window, created_at, last_used_at
         from club_sessions where ${IN_RANGE} order by match_id, player`,
      range,
    ),
    sql.unsafe(
      `select match_id, objective_id, name as player, tokens, payload_json, started_at
         from events where ${IN_RANGE} and type = 'raider_end' order by cursor`,
      range,
    ),
    sql.unsafe(
      `select match_id, objective_id, review, passed, attempt, created_at
         from official_reviews where ${IN_RANGE} order by created_at, review_id`,
      range,
    ),
    sql.unsafe(
      `select match_id, objective_id, player, report_type, valid, attempt, created_at
         from match_reports where ${IN_RANGE} order by created_at, report_id`,
      range,
    ),
    sql.unsafe(
      `select match_id, objective_id, name, payload_json, started_at
         from events where ${IN_RANGE} and type = 'error' order by cursor`,
      range,
    ),
    sql.unsafe(
      `select match_id, objective_id, name, payload_json, started_at, ended_at
         from events where ${IN_RANGE} and type = 'ability_cast' and name like 'qa:%' order by cursor`,
      range,
    ),
  ])
  return {
    since,
    until,
    matches: [...(matches as unknown as MatchRow[])],
    objectives: [...(objectives as unknown as ObjectiveRow[])],
    players: [...(players as unknown as PlayerRow[])],
    raider_ends: [...(raiderEnds as unknown as RaiderEndFact[])],
    reviews: [...(reviews as unknown as ReviewFact[])],
    reports: [...(reports as unknown as ReportValidityFact[])],
    errors: [...(errors as unknown as ErrorFact[])],
    qa_casts: [...(qaCasts as unknown as QaCastFact[])],
  }
}
