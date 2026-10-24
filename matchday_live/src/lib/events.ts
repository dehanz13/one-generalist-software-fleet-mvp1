/** Reading events and their payloads for display. */
import { parsePayload } from '../../shared/players'
import type {
  EventRow,
  ObjectiveKind,
  PlayerRow,
  QaCastPayload,
  RaiderStartPayload,
  ReviewCheck,
  ToolCastPayload,
} from '../../shared/types'

export { parsePayload }

/** Lane colours when the config gave none: distinct in both themes. */
export const PLAYER_PALETTE = ['#8b6cf6', '#0ea5b7', '#d97706', '#e0567a', '#3b82f6', '#16a34a']

export function playerColor(player: PlayerRow | undefined, startColor: string | undefined, index: number): string {
  return player?.color ?? startColor ?? PLAYER_PALETTE[index % PLAYER_PALETTE.length] ?? '#3b82f6'
}

export const KIND_LABEL: Record<ObjectiveKind, string> = {
  head_coach: 'Head coach',
  player: 'Player',
  referee: 'Referee',
}

/** How each event type reads in the feed. */
export const EVENT_LABEL: Record<string, string> = {
  objective_start: 'kick-off',
  objective_end: 'full time',
  raider_start: 'player on',
  raider_end: 'player off',
  ability_cast: 'cast',
  trade: 'pass',
  gear_check_pass: 'review ok',
  gear_check_fail: 'review fail',
  log: 'note',
  error: 'error',
}

/** One tone per event type, used by the feed and the timeline ticks. */
export type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'info' | 'accent'

export function eventTone(e: EventRow): Tone {
  switch (e.type) {
    case 'error':
    case 'gear_check_fail':
      return 'bad'
    case 'gear_check_pass':
      return 'good'
    case 'objective_end': {
      const status = (parsePayload(e.payload_json) ?? {}).status
      return status === 'turnover' ? 'bad' : 'good'
    }
    case 'ability_cast':
      return castOk(e) ? 'info' : 'bad'
    case 'raider_start':
    case 'raider_end':
    case 'trade':
      return 'accent'
    case 'log': {
      const level = (parsePayload(e.payload_json) ?? {}).level
      return level === 'error' ? 'bad' : level === 'warn' ? 'warn' : 'neutral'
    }
    default:
      return 'neutral'
  }
}

export function toolCast(e: EventRow): ToolCastPayload | null {
  if (e.type !== 'ability_cast') return null
  const payload = parsePayload(e.payload_json)
  return payload && typeof payload.tool === 'string' ? (payload as ToolCastPayload) : null
}

export function qaCast(e: EventRow): QaCastPayload | null {
  if (e.type !== 'ability_cast') return null
  const payload = parsePayload(e.payload_json)
  return payload && 'returncode' in payload ? (payload as QaCastPayload) : null
}

export function castOk(e: EventRow): boolean {
  const payload = parsePayload(e.payload_json)
  if (!payload) return true
  if (payload.ok === false) return false
  if (payload.passed === false) return false
  return true
}

export function raiderStart(e: EventRow): RaiderStartPayload | null {
  return e.type === 'raider_start' ? (parsePayload(e.payload_json) as RaiderStartPayload | null) : null
}

const ARG_KEYS = ['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url', 'task', 'prompt', 'description']

function oneLine(value: string, max = 160): string {
  const flat = value.replaceAll(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** A tool call's arguments as one line: the call itself, not a JSON dump. */
export function argsSummary(args: Record<string, unknown> | undefined): string {
  if (!args) return ''
  for (const key of ARG_KEYS) {
    const v = args[key]
    if (typeof v === 'string' && v.trim()) return oneLine(v)
  }
  const parts: string[] = []
  for (const [key, v] of Object.entries(args)) {
    if (v == null) continue
    parts.push(`${key}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
  }
  return oneLine(parts.join(' '))
}

/** The line a feed shows for an event. */
export function eventText(e: EventRow): string {
  const payload = parsePayload(e.payload_json) ?? {}
  switch (e.type) {
    case 'ability_cast': {
      const call = toolCast(e)
      if (call?.tool && e.name && !e.name.startsWith(call.tool)) {
        const summary = argsSummary(call.args)
        return summary ? `${call.tool}: ${summary}` : call.tool
      }
      return oneLine(e.name ?? 'cast')
    }
    case 'log': {
      if (typeof payload.message === 'string') return oneLine(payload.message, 240)
      const pairs = Object.entries(payload)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(', ')
      return oneLine(pairs, 240)
    }
    case 'error':
      return oneLine(
        typeof payload.error === 'string' ? payload.error : typeof payload.reason === 'string' ? payload.reason : e.name ?? 'error',
        240,
      )
    case 'trade':
      return oneLine(typeof payload.summary === 'string' && payload.summary ? `${e.name}: ${payload.summary}` : e.name ?? '')
    case 'objective_end':
      return `${e.name ?? ''} ${typeof payload.status === 'string' ? payload.status : ''}`.trim()
    case 'raider_start':
      return `${e.name ?? 'player'}${typeof payload.model === 'string' ? `: ${payload.model}` : ''}`
    case 'raider_end':
      return `${e.name ?? 'player'}${e.tokens ? `: ${e.tokens.toLocaleString('en-US')} tokens` : ''}`
    default:
      return e.name ?? e.type ?? ''
  }
}

/** The checks behind a review. null when none were recorded; [] when it looked at nothing. */
export function reviewChecks(raw: string | null): ReviewCheck[] | null {
  if (raw == null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
      .map((c) => ({
        item: typeof c.item === 'string' ? c.item : '',
        ok: c.ok === true,
        note: typeof c.note === 'string' ? c.note : '',
      }))
  } catch {
    return null
  }
}

export function stringList(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
  } catch {
    // Kept raw below.
  }
  return [raw]
}

/** Span of an event in ms, from its columns or the payload's own duration. */
export function eventDurationMs(e: EventRow): number {
  const a = e.started_at ? new Date(e.started_at).getTime() : Number.NaN
  const b = e.ended_at ? new Date(e.ended_at).getTime() : Number.NaN
  if (Number.isFinite(a) && Number.isFinite(b)) return b - a
  const call = toolCast(e)
  if (call && typeof call.duration_ms === 'number') return call.duration_ms
  return Number.NaN
}
