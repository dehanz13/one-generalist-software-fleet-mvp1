/**
 * The pieces a report is made of on the page: key figures, the day's
 * timeline, the agent performance table and its charts, models, set pieces,
 * what is worth a look, the per-day chart and the download buttons. The
 * numbers come from shared/report.ts, the same ones the PDF and Markdown use.
 */
import { Download, FileText } from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import {
  type AgentPerformance,
  type MatchLine,
  type ModelUse,
  type Notable,
  type SetPieceUse,
  type Totals,
  compact,
  duration,
  money,
  percent,
} from '../../shared/report'
import { PLAYER_PALETTE } from '../lib/events'
import { modelName } from '../lib/format'
import { type DayPoint, clockIn, countMax, dayClockIn, dayTimeline, niceMax, playerTint } from '../lib/report-view'
import { hrefFor } from '../lib/router'

export type PlayerColors = Record<string, string>

function colorOf(player: string, colors: PlayerColors): string {
  return colors[player] ?? playerTint(player, PLAYER_PALETTE)
}

const playerName = (player: string) => player.replace(/_/g, ' ')

const OUTCOME_LABEL: Record<string, string> = {
  touchdown: 'Touchdown',
  turnover: 'Turnover',
  abandoned: 'Stopped by the provider',
  running: 'Running',
}

export function OutcomeChip({ outcome }: { outcome: string }) {
  return <span className={`outcome ${outcome}`}>{OUTCOME_LABEL[outcome] ?? outcome}</span>
}

// ── figures ──────────────────────────────────────────────────────────────────

export function KeyFigures({
  totals,
  first,
  last,
  timeZone,
  withDays = false,
}: {
  totals: Totals
  first: string | null
  last: string | null
  timeZone: string
  /** Over several days: say which day the first start and the last end fell on. */
  withDays?: boolean
}) {
  const at = (iso: string) => (withDays ? dayClockIn(iso, timeZone) : clockIn(iso, timeZone))
  return (
    <dl className="key-figures">
      <div>
        <dt>Matches</dt>
        <dd>{totals.matches}</dd>
        <p>
          <span className="good-ink">{totals.touchdowns} touchdown{totals.touchdowns === 1 ? '' : 's'}</span> ·{' '}
          <span className="bad-ink">{totals.turnovers} turnover{totals.turnovers === 1 ? '' : 's'}</span>
          {totals.abandoned ? <> · {totals.abandoned} stopped by the provider</> : null}
          {totals.running ? <> · {totals.running} running</> : null}
        </p>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>{money(totals.cost)}</dd>
        <p>{totals.objectives} objectives, {totals.extraTime} in extra time</p>
      </div>
      <div>
        <dt>Billed tokens</dt>
        <dd>{compact(totals.tokens.billed)}</dd>
        <p>
          {compact(totals.tokens.read)} read · {compact(totals.tokens.written)} written
        </p>
      </div>
      <div>
        <dt>Time in matches</dt>
        <dd>{duration(totals.matchSeconds)}</dd>
        <p>
          {first ? at(first) : '—'} → {last ? at(last) : totals.running ? 'still playing' : '—'}
        </p>
      </div>
      <div>
        <dt>Official reviews</dt>
        <dd>
          {totals.reviewsPassed}
          <small> / {totals.reviewsPassed + totals.reviewsFailed}</small>
        </dd>
        <p>
          {totals.reviewsFailed} failed · {totals.invalidReplies} replies corrected
        </p>
      </div>
    </dl>
  )
}

// ── the day's timeline ───────────────────────────────────────────────────────

/** The day's matches on one axis, a bar each, coloured by outcome; each opens its match. */
export function DayTimelineChart({ matches, timeZone, now }: { matches: MatchLine[]; timeZone: string; now: number }) {
  const t = dayTimeline(matches, now)
  if (!t.bars.length) return null
  return (
    <figure className="day-timeline" style={{ '--lanes': t.lanes } as CSSProperties}>
      <div className="dt-plot">
        {t.ticks.map((tick) => (
          <span key={tick.at} className="dt-tick" style={{ left: `${tick.pct}%` }} aria-hidden="true">
            <span>{clockIn(tick.at, timeZone)}</span>
          </span>
        ))}
        {t.bars.map((bar) => (
          <a
            key={bar.match.match_id}
            className={`dt-bar ${bar.match.outcome}`}
            href={hrefFor({ page: 'match', matchId: bar.match.match_id, objectiveId: null })}
            style={{ left: `${bar.left}%`, width: `${bar.width}%`, '--lane': bar.lane, '--w': bar.width } as CSSProperties}
            title={`${clockIn(bar.match.started_at, timeZone)} ${bar.match.setPiece} · ${OUTCOME_LABEL[bar.match.outcome] ?? bar.match.outcome} · ${duration(bar.match.seconds)} · ${money(bar.match.cost)}\n${bar.match.ask}`}
            aria-label={`${bar.match.setPiece} at ${clockIn(bar.match.started_at, timeZone)}: ${OUTCOME_LABEL[bar.match.outcome] ?? bar.match.outcome}`}
          >
            <span>{bar.match.setPiece}</span>
          </a>
        ))}
      </div>
      <figcaption className="chart-key">
        <span className="key touchdown">touchdown</span>
        <span className="key turnover">turnover</span>
        <span className="key abandoned">stopped by the provider</span>
        <span className="key running">running</span>
      </figcaption>
    </figure>
  )
}

export function MatchesTable({ matches, timeZone }: { matches: MatchLine[]; timeZone: string }) {
  if (!matches.length) return <p className="muted">No matches.</p>
  return (
    <div className="table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            <th>Start</th>
            <th>Match</th>
            <th>Set piece</th>
            <th>Result</th>
            <th className="num">Time</th>
            <th className="num">Cost</th>
            <th className="num">Tokens</th>
            <th>Models</th>
            <th>Ask</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => (
            <tr key={m.match_id}>
              <td className="mono">{clockIn(m.started_at, timeZone)}</td>
              <td className="mono">
                <a href={hrefFor({ page: 'match', matchId: m.match_id, objectiveId: null })}>{m.match_id}</a>
              </td>
              <td>{m.setPiece}</td>
              <td>
                <OutcomeChip outcome={m.outcome} />
                {m.reason ? <div className="reason">{m.reason}</div> : null}
              </td>
              <td className="num">{duration(m.seconds)}</td>
              <td className="num">{money(m.cost)}</td>
              <td className="num">{compact(m.billedTokens)}</td>
              <td>{m.models.map(modelName).join(', ')}</td>
              <td className="ask-cell">{m.ask}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── agent performance ────────────────────────────────────────────────────────

export function AgentTable({ agents, colors }: { agents: AgentPerformance[]; colors: PlayerColors }) {
  if (!agents.length) return <p className="muted">No player objectives in this period.</p>
  return (
    <div className="table-wrap">
      <table className="report-table agents">
        <thead>
          <tr>
            <th>Player</th>
            <th>Models</th>
            <th className="num">Objectives</th>
            <th className="num">Touchdowns</th>
            <th className="num" title="Passed with no corrected reply and every official review green at once">
              First try
            </th>
            <th className="num">Extra time</th>
            <th className="num">Review fails</th>
            <th className="num">Corrected replies</th>
            <th className="num">Breaches</th>
            <th className="num">Cost</th>
            <th className="num">Cost / objective</th>
            <th className="num">Avg time</th>
            <th className="num" title="Cache reads as a share of all input">
              Cache share
            </th>
            <th className="num" title="The fullest its context window got">
              Peak context
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.player}>
              <th scope="row">
                <span className="swatch" style={{ background: colorOf(a.player, colors) }} aria-hidden="true" />
                {playerName(a.player)}
              </th>
              <td title={a.models.join(', ')}>{a.models.map(modelName).join(', ')}</td>
              <td className="num">{a.objectives}</td>
              <td className="num">
                {a.touchdowns} <span className="muted">({percent(a.successRate)})</span>
              </td>
              <td className="num">{percent(a.firstTryRate)}</td>
              <td className="num">{a.extraTime}</td>
              <td className={`num ${a.reviewFailures ? 'bad-ink' : ''}`}>{a.reviewFailures}</td>
              <td className={`num ${a.invalidReplies ? 'warn-ink' : ''}`}>{a.invalidReplies}</td>
              <td className={`num ${a.breaches ? 'bad-ink' : ''}`}>{a.breaches}</td>
              <td className="num">{money(a.cost)}</td>
              <td className="num">{money(a.costPerObjective)}</td>
              <td className="num">{duration(a.avgSeconds)}</td>
              <td className="num">{percent(a.cacheShare)}</td>
              <td className={`num ${a.peakContext !== null && a.peakContext > 0.8 ? 'warn-ink' : ''}`}>
                {a.peakContext === null ? '—' : percent(a.peakContext)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ChartRow {
  player: string
  parts: Array<{ value: number; color: string }>
  display: string
}

function BarsChart({ title, note, rows, max, keyItems }: { title: string; note: string; rows: ChartRow[]; max: number; keyItems?: Array<{ label: string; color: string }> }) {
  return (
    <figure className="bars-chart">
      <figcaption>
        <strong>{title}</strong>
        {keyItems ? (
          <span className="chart-key">
            {keyItems.map((k) => (
              <span key={k.label} className="key" style={{ '--key': k.color } as CSSProperties}>
                {k.label}
              </span>
            ))}
          </span>
        ) : null}
        <span className="muted">{note}</span>
      </figcaption>
      <ul>
        {rows.map((row) => (
          <li key={row.player}>
            <span className="bars-label">{playerName(row.player)}</span>
            <span className="bars-track" aria-hidden="true">
              {row.parts.map((part, i) => (
                <span
                  key={i}
                  style={{ width: `${max > 0 ? Math.min(100, (Math.max(part.value, 0) / max) * 100) : 0}%`, background: part.color }}
                />
              ))}
            </span>
            <span className="bars-value mono">{row.display}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

/** Six small charts to judge the players by, side by side. */
export function AgentCharts({ agents, colors }: { agents: AgentPerformance[]; colors: PlayerColors }) {
  if (!agents.length) return null
  const one = (value: (a: AgentPerformance) => number, display: (a: AgentPerformance) => string): ChartRow[] =>
    agents.map((a) => ({ player: a.player, parts: [{ value: value(a), color: colorOf(a.player, colors) }], display: display(a) }))
  return (
    <div className="agent-charts">
      <BarsChart title="Touchdown rate" note="objectives won" rows={one((a) => a.successRate, (a) => percent(a.successRate))} max={1} />
      <BarsChart
        title="First-try rate"
        note="no correction, every review green at once"
        rows={one((a) => a.firstTryRate, (a) => percent(a.firstTryRate))}
        max={1}
      />
      <BarsChart
        title="Cost per objective"
        note="what one objective cost"
        rows={one((a) => a.costPerObjective, (a) => money(a.costPerObjective))}
        max={niceMax(Math.max(0, ...agents.map((a) => a.costPerObjective)))}
      />
      <BarsChart
        title="Extra time and corrections"
        note="iterate/revise objectives, then failed reviews and corrected replies"
        keyItems={[
          { label: 'extra time', color: 'var(--warn)' },
          { label: 'corrections', color: 'var(--bad)' },
        ]}
        rows={agents.map((a) => ({
          player: a.player,
          parts: [
            { value: a.extraTime, color: 'var(--warn)' },
            { value: a.invalidReplies + a.reviewFailures, color: 'var(--bad)' },
          ],
          display: `${a.extraTime} + ${a.invalidReplies + a.reviewFailures}`,
        }))}
        max={niceMax(Math.max(1, ...agents.map((a) => a.extraTime + a.invalidReplies + a.reviewFailures)))}
      />
      <BarsChart title="Cache share" note="input served from cache" rows={one((a) => a.cacheShare, (a) => percent(a.cacheShare))} max={1} />
      <BarsChart
        title="Peak context"
        note="fullest context window"
        rows={one((a) => a.peakContext ?? 0, (a) => (a.peakContext === null ? 'n/a' : percent(a.peakContext)))}
        max={1}
      />
    </div>
  )
}

// ── models, set pieces, worth a look ─────────────────────────────────────────

export function ModelsTable({ models }: { models: ModelUse[] }) {
  if (!models.length) return <p className="muted">No models used.</p>
  return (
    <div className="table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Players</th>
            <th className="num">Objectives</th>
            <th className="num">Cost</th>
            <th className="num">Billed</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={`${m.model}:${m.club ?? ''}`}>
              <td className="model-cell" title={`${m.model}${m.club ? ` (${m.club})` : ''}`}>
                <span className="mono">{modelName(m.model)}</span>
              </td>
              <td>{m.players.map(playerName).join(', ')}</td>
              <td className="num">{m.objectives}</td>
              <td className="num">{money(m.cost)}</td>
              <td className="num">{compact(m.billedTokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SetPiecesTable({ pieces }: { pieces: SetPieceUse[] }) {
  if (!pieces.length) return <p className="muted">No set pieces played.</p>
  return (
    <div className="table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            <th>Set piece</th>
            <th className="num">Matches</th>
            <th className="num">Won</th>
            <th className="num">Lost</th>
            <th className="num">Avg cost</th>
            <th className="num">Avg time</th>
          </tr>
        </thead>
        <tbody>
          {pieces.map((p) => (
            <tr key={p.setPiece}>
              <td>{p.setPiece}</td>
              <td className="num">{p.matches}</td>
              <td className="num good-ink">{p.touchdowns}</td>
              <td className={`num ${p.turnovers ? 'bad-ink' : ''}`}>{p.turnovers}</td>
              <td className="num">{money(p.avgCost)}</td>
              <td className="num">{duration(p.avgSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const NOTABLE_LABEL: Record<Notable['kind'], string> = {
  turnover: 'turnover',
  abandoned: 'stopped',
  breach: 'breach',
  not_accepted: 'not accepted',
  extra_time: 'extra time',
}

export function NotableList({ notable }: { notable: Notable[] }) {
  if (!notable.length) return <p className="muted">Nothing to look at.</p>
  return (
    <ul className="notable">
      {notable.map((n, i) => (
        <li key={`${n.match_id}:${n.kind}:${i}`}>
          <span className={`notable-tag ${n.kind}`}>{NOTABLE_LABEL[n.kind]}</span>
          <a className="mono" href={hrefFor({ page: 'match', matchId: n.match_id, objectiveId: null })}>
            {n.match_id}
          </a>
          <span className="notable-text">{n.text}</span>
        </li>
      ))}
    </ul>
  )
}

// ── per day ──────────────────────────────────────────────────────────────────

/** Matches per day, stacked by outcome, with the day's cost as a line. */
export function DailyChart({ series }: { series: DayPoint[] }) {
  if (!series.length) return null
  const maxMatches = countMax(Math.max(...series.map((s) => s.matches)))
  const maxCost = niceMax(Math.max(...series.map((s) => s.cost)))
  const n = series.length
  const points = series.map((s, i) => ({ x: ((i + 0.5) / n) * 100, y: 100 - (s.cost / maxCost) * 100 }))
  const every = Math.ceil(n / 14)
  return (
    <figure className="daily-chart">
      <div className="dc-axis left" aria-hidden="true">
        <span>{maxMatches}</span>
        <span>{maxMatches / 2}</span>
        <span>0</span>
      </div>
      <div className="dc-plot" role="img" aria-label={series.map((s) => `${s.date}: ${s.matches} matches, ${money(s.cost)}`).join('; ')}>
        <div className="dc-columns">
          {series.map((s) => (
            <div key={s.date} className="dc-col" title={`${s.date}: ${s.matches} matches (${s.touchdowns} touchdowns, ${s.turnovers} turnovers), ${money(s.cost)}`}>
              <span className="dc-stack" style={{ height: `${(s.matches / maxMatches) * 100}%` }}>
                {s.running ? <span className="running" style={{ flexGrow: s.running }} /> : null}
                {s.turnovers ? <span className="turnover" style={{ flexGrow: s.turnovers }} /> : null}
                {s.touchdowns ? <span className="touchdown" style={{ flexGrow: s.touchdowns }} /> : null}
              </span>
            </div>
          ))}
        </div>
        <svg className="dc-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points.map((p) => `${p.x},${p.y}`).join(' ')} />
        </svg>
        {points.map((p, i) => (
          <span key={series[i]!.date} className="dc-dot" style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden="true" />
        ))}
      </div>
      <div className="dc-axis right" aria-hidden="true">
        <span>${maxCost.toFixed(2)}</span>
        <span>${(maxCost / 2).toFixed(2)}</span>
        <span>$0</span>
      </div>
      <div className="dc-dates" aria-hidden="true">
        {series.map((s, i) => (
          <span key={s.date}>{i % every === 0 ? `${Number(s.date.slice(8, 10))}/${Number(s.date.slice(5, 7))}` : ''}</span>
        ))}
      </div>
      <figcaption className="chart-key">
        <span className="key touchdown">touchdowns</span>
        <span className="key turnover">turnovers</span>
        <span className="key running">running</span>
        <span className="key cost-line">cost per day</span>
      </figcaption>
    </figure>
  )
}

// ── downloads ────────────────────────────────────────────────────────────────

/** PDF and Markdown buttons; the PDF builder loads on the first click. */
export function DownloadButtons({
  onPdf,
  onMarkdown,
  compact: small = false,
  what = 'this report',
}: {
  onPdf: () => Promise<void>
  onMarkdown: () => void
  compact?: boolean
  /** What is downloaded, for the buttons' names: "Mon 12 Oct 2026". */
  what?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="downloads">
      <button
        type="button"
        className="button"
        disabled={busy}
        title={`Download ${what} as PDF`}
        onClick={() => {
          setBusy(true)
          setError(null)
          onPdf()
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setBusy(false))
        }}
      >
        <Download size={15} aria-hidden="true" /> {busy ? 'Making PDF…' : small ? 'PDF' : 'Download PDF'}
        <span className="visually-hidden"> of {what}</span>
      </button>
      <button type="button" className="button" onClick={onMarkdown} title={`Download ${what} as Markdown`}>
        <FileText size={15} aria-hidden="true" /> {small ? 'Markdown' : 'Download Markdown'}
        <span className="visually-hidden"> of {what}</span>
      </button>
      {error ? (
        <span className="bad-ink" role="alert">
          The PDF failed: {error}
        </span>
      ) : null}
    </span>
  )
}

