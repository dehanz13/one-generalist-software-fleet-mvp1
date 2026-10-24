/**
 * ReportFacts from rows already in hand: the demo recording (which has no
 * server to ask) and tests. Selects exactly what GET /api/report-facts
 * selects, so a report of the demo reads like a report of a real fleet.
 */
import type { DemoMatch, EventRow, ReportFacts } from './types.js'

/** The facts for the matches in `matches` that started in [since, until). */
export function factsFromMatches(matches: DemoMatch[], since: string, until: string): ReportFacts {
  const inRange = matches.filter((m) => {
    const t = m.match.started_at
    return t !== null && t >= since && t < until
  })
  const events = (pick: (e: EventRow) => boolean) => inRange.flatMap((m) => m.events.filter(pick))
  return {
    since,
    until,
    matches: inRange.map((m) => m.match),
    objectives: inRange.flatMap((m) => m.objectives),
    players: inRange.flatMap((m) => m.players),
    raider_ends: events((e) => e.type === 'raider_end').map((e) => ({
      match_id: e.match_id,
      objective_id: e.objective_id,
      player: e.name,
      tokens: e.tokens,
      payload_json: e.payload_json,
      started_at: e.started_at,
    })),
    reviews: inRange.flatMap((m) =>
      m.reviews.map((r) => ({
        match_id: r.match_id,
        objective_id: r.objective_id,
        review: r.review,
        passed: r.passed,
        attempt: r.attempt,
        created_at: r.created_at,
      })),
    ),
    reports: inRange.flatMap((m) =>
      m.reports.map((r) => ({
        match_id: r.match_id,
        objective_id: r.objective_id,
        player: r.player,
        report_type: r.report_type,
        valid: r.valid,
        attempt: r.attempt,
        created_at: r.created_at,
      })),
    ),
    errors: events((e) => e.type === 'error').map((e) => ({
      match_id: e.match_id,
      objective_id: e.objective_id,
      name: e.name,
      payload_json: e.payload_json,
      started_at: e.started_at,
    })),
    qa_casts: events((e) => e.type === 'ability_cast' && (e.name ?? '').startsWith('qa:')).map((e) => ({
      match_id: e.match_id,
      objective_id: e.objective_id,
      name: e.name,
      payload_json: e.payload_json,
      started_at: e.started_at,
      ended_at: e.ended_at,
    })),
  }
}
