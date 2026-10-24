/**
 * The vidiprinter: every event of the match as one line, the newest at the
 * bottom, the way results used to come in on a Saturday afternoon. It
 * follows the newest line until you scroll up.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { EventRow, PlayerRow } from '../../shared/types'
import { EVENT_LABEL, eventText, eventTone } from '../lib/events'
import { fmtClock } from '../lib/format'

const SHOWN = 600

export function LiveFeed({
  events,
  players,
  ownerOf,
  onPick,
  live,
}: {
  events: EventRow[]
  players: PlayerRow[]
  ownerOf: Map<string, string | null>
  onPick: (objectiveId: string) => void
  live: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)
  const seenAtMount = useRef<number | null>(null)
  if (seenAtMount.current === null) seenAtMount.current = events[events.length - 1]?.cursor ?? 0
  const shown = events.slice(-SHOWN)
  const colors = new Map(players.map((p) => [p.player, p.color]))

  useEffect(() => {
    const el = box.current
    if (el && follow) el.scrollTop = el.scrollHeight
  }, [events.length, follow])

  const onScroll = () => {
    const el = box.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    if (atBottom !== follow) setFollow(atBottom)
  }

  return (
    <section className="panel" aria-label="Live feed" data-tour="feed">
      <div className="panel-head">
        <h2>Live feed</h2>
        <span className="muted">{events.length} events</span>
      </div>
      <div className="vidiprinter" ref={box} onScroll={onScroll} role="log" aria-live={live ? 'polite' : 'off'} aria-relevant="additions">
        {shown.length ? (
          shown.map((e) => {
            const owner = e.objective_id ? ownerOf.get(e.objective_id) : null
            const color = owner ? colors.get(owner) : null
            const tone = eventTone(e)
            return (
              <div
                key={e.event_id}
                className={`vp-line ${e.cursor > (seenAtMount.current ?? 0) ? 'fresh' : ''} ${tone === 'neutral' ? 'mute' : ''}`}
                onClick={() => e.objective_id && onPick(e.objective_id)}
                style={color ? ({ boxShadow: `inset 3px 0 0 ${color}` } as CSSProperties) : undefined}
                title={owner ? `${owner}: ${eventText(e)}` : eventText(e)}
              >
                <span className="t">{fmtClock(e.ended_at ?? e.started_at)}</span>
                <span className={`k tone-${tone}`}>{EVENT_LABEL[e.type ?? ''] ?? e.type}</span>
                <span className="x">{eventText(e)}</span>
              </div>
            )
          })
        ) : (
          <p className="muted" style={{ padding: '0 14px' }}>
            Waiting for the first event.
          </p>
        )}
      </div>
      <div className="feed-foot">
        <span>{events.length > SHOWN ? `Showing the last ${SHOWN}` : 'Every event so far'}</span>
        {follow ? (
          <span>Following the newest</span>
        ) : (
          <button type="button" className="archive-button" onClick={() => setFollow(true)}>
            Jump to the newest
          </button>
        )}
      </div>
    </section>
  )
}
