/**
 * The match on a time axis: one lane for the head coach, one per player,
 * one for the referee. Objectives are blocks; casts are ticks inside them.
 */
import { Gavel, UserRound } from 'lucide-react'
import { useMemo, type CSSProperties } from 'react'
import type { EventRow, MatchDetail, ObjectiveRow, PlayerRow } from '../../shared/types'
import { castOk, playerColor, raiderStart } from '../lib/events'
import { axisTicks, durationOf, fmtDuration, fmtInt, fmtPercent, hexAlpha, modelName, ts } from '../lib/format'

interface Lane {
  id: string
  label: string
  meta: string
  color: string
  kind: 'head_coach' | 'player' | 'referee'
  objectives: ObjectiveRow[]
  player?: PlayerRow
}

/** The ask opens the match and owns the start of the axis: a zone nothing else enters. */
const ASK_ZONE_PCT = 12
/** A near-zero objective (a commit) is widened to this, and later blocks shift right. */
const MIN_BLOCK_PCT = 5.5

export function buildLanes(detail: MatchDetail, events: EventRow[]): Lane[] {
  const { objectives, players, match } = detail
  const owners: string[] = []
  for (const o of objectives) if (o.kind === 'player' && o.owner && !owners.includes(o.owner)) owners.push(o.owner)
  const startColor = new Map<string, string>()
  const ownerOf = new Map(objectives.map((o) => [o.objective_id, o.owner]))
  for (const e of events) {
    const payload = raiderStart(e)
    const owner = (e.objective_id ? ownerOf.get(e.objective_id) : null) ?? e.name
    if (payload?.color && owner && !startColor.has(owner)) startColor.set(owner, payload.color)
  }
  const lanes: Lane[] = [
    {
      id: 'head_coach',
      label: match.founder || 'Head coach',
      meta: 'Head coach',
      color: 'var(--warn)',
      kind: 'head_coach',
      objectives: objectives.filter((o) => o.kind === 'head_coach'),
    },
  ]
  owners.forEach((owner, index) => {
    const player = players.find((p) => p.player === owner)
    lanes.push({
      id: `player:${owner}`,
      label: owner,
      meta: player?.model ? modelName(player.model) : 'Player',
      color: playerColor(player, startColor.get(owner), index),
      kind: 'player',
      objectives: objectives.filter((o) => o.kind === 'player' && o.owner === owner),
      ...(player ? { player } : {}),
    })
  })
  const refereeObjectives = objectives.filter((o) => o.kind === 'referee')
  if (refereeObjectives.length) {
    lanes.push({
      id: 'referee',
      label: 'Referee',
      meta: 'Code: qa, git, contract',
      color: 'var(--ink-3)',
      kind: 'referee',
      objectives: refereeObjectives,
    })
  }
  return lanes
}

interface Geometry {
  left: number
  width: number
}

/**
 * Where each timed objective sits, in track %. Objectives run one after
 * another, and the drawing says so: when a short one is widened to stay
 * readable, everything after it moves right instead of being overlapped, and
 * the whole row is scaled back into the track.
 */
export function layoutBlocks(objectives: ObjectiveRow[], now: number, zonePct: number, askId: string | null): {
  blocks: Record<string, Geometry>
  originMs: number
  spanMs: number
} {
  const timed = objectives.filter((o) => o.objective_id !== askId && Number.isFinite(ts(o.started_at)))
  const starts = timed.map((o) => ts(o.started_at))
  const fallback = objectives.map((o) => ts(o.started_at)).filter(Number.isFinite)
  const origin = starts.length ? Math.min(...starts) : fallback.length ? Math.min(...fallback) : now
  let end = origin + 1000
  for (const o of timed) {
    const finish = o.status === 'running' ? now : ts(o.ended_at)
    if (Number.isFinite(finish)) end = Math.max(end, finish)
  }
  const span = Math.max(end - origin, 1000)
  const avail = 100 - zonePct - 0.4
  const sorted = timed
    .map((o) => {
      const start = ts(o.started_at)
      let finish = o.status === 'running' ? now : ts(o.ended_at)
      if (!Number.isFinite(finish)) finish = start
      return {
        id: o.objective_id,
        start,
        left: ((start - origin) / span) * avail,
        width: ((Math.max(finish, start) - start) / span) * avail,
      }
    })
    .sort((a, b) => a.start - b.start)
  let shift = 0
  let edge = 0
  const rows: Array<{ id: string; left: number; width: number }> = []
  for (const block of sorted) {
    let left = block.left + shift
    if (left < edge) {
      shift += edge - left
      left = edge
    }
    const width = Math.max(block.width, MIN_BLOCK_PCT)
    shift += width - block.width
    edge = left + width
    rows.push({ id: block.id, left, width })
  }
  const scale = avail / Math.max(edge, avail)
  const blocks: Record<string, Geometry> = {}
  for (const r of rows) blocks[r.id] = { left: zonePct + r.left * scale, width: r.width * scale }
  return { blocks, originMs: origin, spanMs: span }
}

export function Timeline({
  detail,
  events,
  now,
  selectedId,
  onSelect,
}: {
  detail: MatchDetail
  events: EventRow[]
  now: number
  selectedId: string | null
  onSelect: (objective: ObjectiveRow) => void
}) {
  const lanes = useMemo(() => buildLanes(detail, events), [detail, events])
  const ask = detail.objectives.find((o) => o.kind === 'head_coach' && o.started_at) ?? null
  const zone = ask ? ASK_ZONE_PCT : 0
  const { blocks, spanMs } = layoutBlocks(detail.objectives, now, zone, ask?.objective_id ?? null)
  const ticks = axisTicks(spanMs, 7).map((t) => ({ pct: zone + (t.pct * (100 - zone)) / 100, label: t.label }))

  const casts = useMemo(() => {
    const map = new Map<string, Array<{ t: number; ok: boolean }>>()
    for (const e of events) {
      if (e.type !== 'ability_cast' || !e.objective_id) continue
      const list = map.get(e.objective_id) ?? []
      list.push({ t: ts(e.started_at), ok: castOk(e) })
      map.set(e.objective_id, list)
    }
    return map
  }, [events])

  const geometry = (o: ObjectiveRow): Geometry | null => {
    if (ask && o.objective_id === ask.objective_id) return { left: 0.4, width: zone - 0.8 }
    return blocks[o.objective_id] ?? null
  }

  return (
    <div className="timeline">
      <div className="timeline-inner">
        <div className="lane axis" aria-hidden="true">
          <span />
          <div className="track">
            {zone ? (
              <span className="tick first" style={{ left: 0 }}>
                ask
              </span>
            ) : null}
            {ticks.map((t, i) => (
              <span key={i} className={`tick ${t.pct === 0 ? 'first' : ''}`} style={{ left: `${t.pct}%` }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
        {lanes.map((lane) => {
          const context =
            lane.player?.context_tokens && lane.player.context_window
              ? { used: lane.player.context_tokens, window: lane.player.context_window }
              : null
          return (
            <div key={lane.id} className="lane" style={{ '--swatch': lane.color } as CSSProperties}>
              <div className="lane-label">
                <span className="lane-name">
                  {lane.kind === 'head_coach' ? (
                    <UserRound size={15} aria-hidden="true" />
                  ) : lane.kind === 'referee' ? (
                    <Gavel size={15} aria-hidden="true" />
                  ) : (
                    <span className="swatch" aria-hidden="true" />
                  )}
                  <span>{lane.label}</span>
                </span>
                <span className="lane-meta" title={lane.player?.model ?? lane.meta}>
                  {lane.meta}
                </span>
                {context ? (
                  <span
                    className="context-bar"
                    title={`Context ${fmtInt(context.used)} of ${fmtInt(context.window)} tokens (${fmtPercent(context.used, context.window)})`}
                  >
                    <span style={{ width: `${Math.max(2, Math.min(100, (context.used / context.window) * 100))}%` }} />
                  </span>
                ) : null}
              </div>
              <div className="track">
                {ticks.map((t, i) => (
                  <span key={i} className="gridline" style={{ left: `${t.pct}%` }} />
                ))}
                {lane.objectives.map((o) => {
                  const g = geometry(o)
                  if (!g) return null
                  const start = ts(o.started_at)
                  const end = o.status === 'running' ? now : ts(o.ended_at)
                  const spanOf = Math.max(end - start, 1)
                  const color = lane.kind === 'player' ? lane.color : lane.kind === 'head_coach' ? '#c98a12' : '#7d8ea1'
                  return (
                    <button
                      key={o.objective_id}
                      type="button"
                      className={`block ${o.status ?? ''}`}
                      aria-pressed={o.objective_id === selectedId}
                      title={`${o.name}: ${o.status}${o.description ? `\n${o.description}` : ''}`}
                      onClick={() => onSelect(o)}
                      style={
                        {
                          left: `${g.left}%`,
                          width: `${g.width}%`,
                          ...(o.status === 'turnover'
                            ? {}
                            : { '--block-bg': hexAlpha(color, 0.14), '--block-line': hexAlpha(color, 0.6) }),
                        } as CSSProperties
                      }
                    >
                      <span className="block-name">{o.name}</span>
                      <span className="block-time">{fmtDuration(durationOf(o, now))}</span>
                      {(casts.get(o.objective_id) ?? []).map((c, i) =>
                        Number.isFinite(c.t) ? (
                          <span
                            key={i}
                            className={`cast-tick ${c.ok ? '' : 'bad'}`}
                            style={{ left: `${Math.min(97, Math.max(1, ((c.t - start) / spanOf) * 100))}%` }}
                          />
                        ) : null,
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
