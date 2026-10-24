import type {
  EventRow,
  MatchUsage,
  ObjectiveRow,
  PlayerRow,
  RaiderEndPayload,
  RaiderStartPayload,
} from './types.js'

/** Parse a payload_json string into an object, or null. Never throws. */
export function parsePayload(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // A malformed payload is a missing detail, never a failed request.
  }
  return null
}

/**
 * The players of a match: the finished club_sessions rows, plus every player
 * that has started but not finished (from its raider_start event).
 *
 * The match feed writes a club_sessions row only after a player's report is
 * accepted, so a player still running has no row there: precisely the case a
 * live view exists for. Its model, colour and session id are already on its
 * raider_start event, so a lane is labelled from the moment the player
 * spawns. A finished row is authoritative; a start only fills a gap.
 */
export function mergePlayers(
  clubSessions: PlayerRow[],
  events: EventRow[],
  objectives: ObjectiveRow[],
): PlayerRow[] {
  const finished = [...clubSessions].sort(
    (a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.player.localeCompare(b.player),
  )
  const out: PlayerRow[] = [...finished]
  const ownerByObjective = new Map(objectives.map((o) => [o.objective_id, o.owner]))
  const starts = events
    .filter((e) => e.type === 'raider_start')
    .sort((a, b) => a.cursor - b.cursor)
  for (const e of starts) {
    const player = (e.objective_id ? ownerByObjective.get(e.objective_id) : null) ?? e.name
    if (!player) continue
    if (out.some((p) => p.player === player && p.match_id === e.match_id)) continue
    const payload = (parsePayload(e.payload_json) ?? {}) as RaiderStartPayload
    out.push({
      match_id: e.match_id,
      player,
      club: null,
      model: typeof payload.model === 'string' ? payload.model : null,
      color: typeof payload.color === 'string' ? payload.color : null,
      session_id: typeof payload.session_id === 'string' ? payload.session_id : null,
      // Occupancy is only known once the player's turn closes.
      context_tokens: null,
      context_window: null,
      created_at: e.started_at,
      last_used_at: e.started_at,
    })
  }
  return out
}

/**
 * Raw tokens read and written, beside the billed headline.
 *
 * Derived from raider_end payloads, so every match ever recorded has it.
 * `read` counts material entering a context for the first time: uncached
 * input plus cache writes. Cache reads are the same tokens served again on
 * later turns; counting them would rebuild the very inflation this split
 * exists to expose. `written` is output, each token produced exactly once.
 */
export function usageFromEvents(events: EventRow[]): MatchUsage {
  let read = 0
  let written = 0
  for (const e of events) {
    if (e.type !== 'raider_end') continue
    const payload = parsePayload(e.payload_json) as RaiderEndPayload | null
    const u = payload?.usage
    if (!u) continue
    read += num(u.input_tokens) + num(u.cache_write_tokens)
    written += num(u.output_tokens)
  }
  return { read, written }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
