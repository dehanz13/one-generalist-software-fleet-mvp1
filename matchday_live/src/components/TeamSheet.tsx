import type { CSSProperties } from 'react'
import type { PlayerRow, ProcessRow } from '../../shared/types'
import { playerColor } from '../lib/events'
import { durationOf, fmtInt, fmtPercent, modelName, modelProvider } from '../lib/format'

/** Who played: each player's club, model and how full its context ended. */
export function TeamSheet({ players }: { players: PlayerRow[] }) {
  return (
    <section className="panel" aria-label="Team sheet" data-tour="teamsheet">
      <div className="panel-head">
        <h2>Team sheet</h2>
        <span className="muted">
          {players.length} {players.length === 1 ? 'player' : 'players'}
        </span>
      </div>
      {players.length ? (
        <ul className="sheet">
          {players.map((p, index) => {
            const color = playerColor(p, undefined, index)
            const context =
              p.context_tokens && p.context_window ? fmtPercent(p.context_tokens, p.context_window) : null
            return (
              <li key={p.player} style={{ '--swatch': color } as CSSProperties}>
                <span className="swatch" aria-hidden="true" />
                <span style={{ minWidth: 0 }}>
                  <span className="name">{p.player}</span>
                  <span className="sub" title={p.model ?? ''}>
                    {[p.club ?? 'still playing', modelProvider(p.model), modelName(p.model)].filter(Boolean).join(', ')}
                  </span>
                  {context ? (
                    <span
                      className="context-bar"
                      title={`${fmtInt(p.context_tokens)} of ${fmtInt(p.context_window)} tokens in context after its last turn`}
                    >
                      <span style={{ width: `${Math.max(2, Math.min(100, ((p.context_tokens ?? 0) / (p.context_window ?? 1)) * 100))}%` }} />
                    </span>
                  ) : null}
                </span>
                <span className="side">{context ? `${context} context` : p.club ? '' : 'on the pitch'}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="panel-body muted">No player has taken the pitch yet.</p>
      )}
    </section>
  )
}

/** What the match has running right now, by process, so a hung one can be found. */
export function OnPitch({ processes, now }: { processes: ProcessRow[]; now: number }) {
  const alive = processes.filter((p) => !p.ended_at)
  return (
    <section className="panel" aria-label="On pitch" data-tour="onpitch">
      <div className="panel-head">
        <h2>On pitch</h2>
        <span className="muted">{alive.length ? `${alive.length} running` : 'Nothing running'}</span>
      </div>
      {processes.length ? (
        <ul className="sheet">
          {processes.map((p) => (
            <li key={p.process_id}>
              <span className="swatch" style={{ background: p.ended_at ? 'var(--line-strong)' : 'var(--good)' }} aria-hidden="true" />
              <span style={{ minWidth: 0 }}>
                <span className="name">{p.kind === 'setpiece' ? 'Set piece' : p.name || 'Player'}</span>
                <span className="sub mono" title={p.command ?? ''}>
                  pid {p.pid ?? '?'}: {p.command}
                </span>
              </span>
              <span className="side">
                {p.ended_at ? 'ended' : `${Math.round(durationOf({ ...p, status: 'running' }, now) / 1000)}s`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-body muted">No process recorded yet.</p>
      )}
    </section>
  )
}
