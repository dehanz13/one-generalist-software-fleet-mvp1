import { AlertTriangle, Check, Info, X } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import type { MatchStatus, ObjectiveRow, ObjectiveStatus, PlayerRow } from '../../shared/types'
import { playerColor } from '../lib/events'

const STATUS_TEXT: Record<string, string> = {
  running: 'Running',
  touchdown: 'Touchdown',
  turnover: 'Turnover',
  queued: 'Queued',
}

export function StatusChip({ status }: { status: MatchStatus | ObjectiveStatus | null }) {
  const value = status ?? 'turnover'
  return (
    <span className={`status ${value}`}>
      {value === 'running' ? (
        <span className="pulse" aria-hidden="true" />
      ) : value === 'touchdown' ? (
        <Check size={14} strokeWidth={3} aria-hidden="true" />
      ) : value === 'turnover' ? (
        <X size={14} strokeWidth={3} aria-hidden="true" />
      ) : null}
      {STATUS_TEXT[value] ?? value}
    </span>
  )
}

/** The colour each objective's owner plays in: a player's own colour, else by kind. */
export function ownerColors(objectives: ObjectiveRow[], players: PlayerRow[]): Map<string, string> {
  const colors = new Map<string, string>()
  let index = 0
  for (const o of objectives) {
    if (o.kind !== 'player' || !o.owner || colors.has(o.owner)) continue
    colors.set(o.owner, playerColor(players.find((p) => p.player === o.owner), undefined, index++))
  }
  return colors
}

export function kindColor(kind: string | null): string {
  if (kind === 'head_coach') return 'var(--warn)'
  if (kind === 'referee') return 'var(--ink-3)'
  return 'var(--accent)'
}

/** One dot per objective, in order: filled when done, hollow while running, square on a turnover. */
export function ObjectiveDots({ objectives, players }: { objectives: ObjectiveRow[]; players: PlayerRow[] }) {
  const colors = ownerColors(objectives, players)
  const ordered = [...objectives].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  if (!ordered.length) return <span className="muted">No objectives yet</span>
  return (
    <span className="dots" role="img" aria-label={`${ordered.length} objectives: ${ordered.map((o) => `${o.name} ${o.status}`).join(', ')}`}>
      {ordered.map((o) => (
        <span
          key={o.objective_id}
          className={`dot ${o.status ?? ''}`}
          title={`${o.name} (${o.owner}): ${o.status}`}
          style={{ '--dot': (o.owner && colors.get(o.owner)) || kindColor(o.kind) } as CSSProperties}
        />
      ))}
    </span>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'bad' | 'warn'; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : AlertTriangle
  return (
    <div className={`notice ${tone === 'info' ? '' : tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}

/** The mark: a pitch from above, halfway line and centre circle. */
export function PitchMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 36 26" aria-hidden="true">
      <rect x="1" y="1" width="34" height="24" rx="3" fill="var(--good)" />
      <g fill="none" stroke="#fff" strokeWidth="1.4" opacity="0.92">
        <rect x="3" y="3" width="30" height="20" rx="1" />
        <line x1="18" y1="3" x2="18" y2="23" />
        <circle cx="18" cy="13" r="4" />
        <rect x="3" y="8" width="4" height="10" />
        <rect x="29" y="8" width="4" height="10" />
      </g>
    </svg>
  )
}

export function Figure({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <span className="figure" title={title}>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </span>
  )
}
