import type { MatchDetail } from '../../shared/types'
import { durationOf, fmtCost, fmtDate, fmtMatchClock, fmtTokens } from '../lib/format'
import { StatusChip } from './common'

/** The one loud thing on the page: the match's clock and score, on the board. */
export function Scoreboard({ detail, now }: { detail: MatchDetail; now: number }) {
  const { match, usage, objectives } = detail
  const done = objectives.filter((o) => o.status === 'touchdown').length
  const failed = objectives.filter((o) => o.status === 'turnover').length
  const elapsed = durationOf(match, now)
  return (
    <section className="scoreboard" aria-label="Scoreboard" data-tour="scoreboard">
      <div className="board-title">
        <span className="fixture-id">{match.match_id}</span>
        <h1>{match.setpiece_name || 'Set piece'}</h1>
        <p className="board-ask" title={match.ask ?? ''}>
          {match.ask || 'No ask recorded.'}
        </p>
      </div>
      <div className="board-clock">
        <span className="clock" aria-label={`Match time ${fmtMatchClock(elapsed)}`}>
          {fmtMatchClock(elapsed)}
        </span>
        <StatusChip status={match.status} />
      </div>
      <div className="board-stats">
        <div className="board-stat" title="Dollars billed for this match, every player combined">
          <span className="k">Cost</span>
          <span className="v">{fmtCost(match.total_cost)}</span>
        </div>
        <div
          className="board-stat"
          title="Billed tokens: every turn re-sends the whole conversation, so this is spend, not size"
        >
          <span className="k">Billed tokens</span>
          <span className="v">{fmtTokens(match.total_tokens)}</span>
        </div>
        <div className="board-stat" title="Objectives that ended in a touchdown, out of those started">
          <span className="k">Objectives</span>
          <span className="v">
            {done}/{objectives.length}
            {failed ? <span className="board-lost"> ({failed} lost)</span> : null}
          </span>
        </div>
        <div
          className="board-stat"
          title="Raw tokens the models took in the first time they entered a context: new input plus cache writes"
        >
          <span className="k">Read</span>
          <span className="v">{fmtTokens(usage.read)}</span>
        </div>
        <div className="board-stat" title="Tokens the models generated, each counted once">
          <span className="k">Written</span>
          <span className="v">{fmtTokens(usage.written)}</span>
        </div>
        <div className="board-stat" title="Players who have taken the pitch in this match">
          <span className="k">Players</span>
          <span className="v">{detail.players.length}</span>
        </div>
      </div>
      <div className="board-meta">
        <span>
          Founder <b>{match.founder || 'unknown'}</b>
        </span>
        <span>
          Machine <b>{match.machine || 'unknown'}</b>
        </span>
        {match.project ? (
          <span>
            Project <b>{match.project}</b>
          </span>
        ) : null}
        <span>
          Kick-off <b>{fmtDate(match.started_at)}</b>
        </span>
        {match.ended_at ? (
          <span>
            Full time <b>{fmtDate(match.ended_at)}</b>
          </span>
        ) : null}
      </div>
    </section>
  )
}
