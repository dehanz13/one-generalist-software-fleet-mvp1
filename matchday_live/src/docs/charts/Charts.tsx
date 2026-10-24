/**
 * The docs' charts: small SVG bars with HTML labels, so the text stays
 * readable at any width and the bars stretch. No chart library. Every chart
 * names its source under it.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { compact, money, percent } from '../../../shared/report'
import { DEMO_SOURCE, GATE_CASES, TIME_SPLIT, gatePasses, loadDemoPlayers, type PlayerPoint } from './data'

/** One horizontal bar, `share` of the full width (0..1). */
function Bar({ share, tone, title }: { share: number; tone: string; title?: string }) {
  const width = Math.max(0, Math.min(1, share)) * 100
  return (
    <svg className="chart-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect className="chart-track" x="0" y="0" width="100" height="10" rx="0" />
      <rect className={`chart-fill tone-${tone}`} x="0" y="0" width={width} height="10">
        {title ? <title>{title}</title> : null}
      </rect>
    </svg>
  )
}

function ChartFigure({ title, source, children }: { title: string; source: string; children: ReactNode }) {
  return (
    <figure className="doc-chart">
      <figcaption className="doc-chart-title">{title}</figcaption>
      {children}
      <p className="doc-chart-source">Source: {source}</p>
    </figure>
  )
}

/** A known player gets its lane colour; anyone else the accent. */
function toneOf(player: string): string {
  return ['playmaker', 'builder', 'ranger', 'safety_officer', 'bard'].includes(player) ? player : 'accent'
}

function label(player: string): string {
  return player.replace(/_/g, ' ')
}

// ── time split ───────────────────────────────────────────────────────────────

export function TimeSplit() {
  let offset = 0
  return (
    <ChartFigure title="Where the run time went" source={TIME_SPLIT.source}>
      <svg className="chart-stack" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {TIME_SPLIT.parts.map((part) => {
          const x = offset
          offset += part.share * 100
          return <rect key={part.key} className={`chart-fill tone-${part.key}`} x={x} y="0" width={part.share * 100} height="10" />
        })}
      </svg>
      <ul className="chart-legend">
        {TIME_SPLIT.parts.map((part) => (
          <li key={part.key}>
            <span className={`chart-swatch tone-${part.key}`} aria-hidden="true" />
            <span className="chart-legend-label">{part.label}</span>
            <span className="chart-value">{percent(part.share)}</span>
          </li>
        ))}
      </ul>
    </ChartFigure>
  )
}

// ── the progressive gate ─────────────────────────────────────────────────────

export function ProgressiveGate() {
  const max = Math.max(...GATE_CASES.cases.flatMap((c) => [c.before, c.after]))
  return (
    <ChartFigure title="The progressive gate: totals do not decide, new problems do" source={GATE_CASES.source}>
      <div className="chart-gate">
        {GATE_CASES.cases.map((c) => {
          const green = gatePasses(c.added)
          return (
            <div className="chart-gate-case" key={c.label}>
              <div className="chart-gate-head">
                <span className="chart-gate-label">{c.label}</span>
                <span className={`chart-verdict ${green ? 'good' : 'bad'}`}>{green ? 'green' : 'red'}</span>
              </div>
              <div className="chart-row">
                <span className="chart-row-label">before</span>
                <Bar share={c.before / max} tone="muted" />
                <span className="chart-value">{c.before}</span>
              </div>
              <div className="chart-row">
                <span className="chart-row-label">after</span>
                <Bar share={c.after / max} tone={green ? 'good' : 'bad'} />
                <span className="chart-value">{c.after}</span>
              </div>
              <p className="chart-note">
                {c.added === 0 ? 'No new problem' : `${c.added} new problem${c.added === 1 ? '' : 's'}`}, {c.after - c.before === 0 ? 'same total' : `${c.after - c.before > 0 ? '+' : ''}${c.after - c.before} in total`}
              </p>
            </div>
          )
        })}
      </div>
    </ChartFigure>
  )
}

// ── per player, from the demo ────────────────────────────────────────────────

function useDemoPlayers(): { players: PlayerPoint[] | null; error: string | null } {
  const [players, setPlayers] = useState<PlayerPoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    loadDemoPlayers().then(
      (points) => live && setPlayers(points),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      live = false
    }
  }, [])
  return { players, error }
}

function DemoState({ error }: { error: string | null }) {
  return <p className="chart-note">{error ? `The demo recording did not load: ${error}` : 'Loading the demo recording…'}</p>
}

export function CostByPlayer() {
  const { players, error } = useDemoPlayers()
  const max = players ? Math.max(...players.map((p) => p.cost), 0) : 0
  return (
    <ChartFigure title="Cost per player, the whole demo recording" source={DEMO_SOURCE}>
      {players === null ? (
        <DemoState error={error} />
      ) : (
        <div className="chart-rows">
          {players.map((p) => (
            <div className="chart-row" key={p.player}>
              <span className="chart-row-label">{label(p.player)}</span>
              <Bar share={max ? p.cost / max : 0} tone={toneOf(p.player)} />
              <span className="chart-value">
                {money(p.cost)}
                <span className="chart-sub">
                  {' '}
                  · {p.objectives} objective{p.objectives === 1 ? '' : 's'}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </ChartFigure>
  )
}

export function TokensByPlayer() {
  const { players, error } = useDemoPlayers()
  const max = players ? Math.max(...players.flatMap((p) => [p.billed, p.read + p.written]), 0) : 0
  return (
    <ChartFigure title="Tokens per player: read and written, against billed" source={DEMO_SOURCE}>
      {players === null ? (
        <DemoState error={error} />
      ) : (
        <>
          <ul className="chart-legend">
            <li>
              <span className="chart-swatch tone-read" aria-hidden="true" />
              <span className="chart-legend-label">read + written</span>
            </li>
            <li>
              <span className="chart-swatch tone-billed" aria-hidden="true" />
              <span className="chart-legend-label">billed (cached context re-counted each turn)</span>
            </li>
          </ul>
          <div className="chart-rows">
            {players.map((p) => (
              <div className="chart-pair" key={p.player}>
                <span className="chart-row-label">{label(p.player)}</span>
                <div className="chart-pair-bars">
                  <div className="chart-pair-line">
                    <Bar share={max ? (p.read + p.written) / max : 0} tone="read" />
                    <span className="chart-value">
                      {compact(p.read)} read · {compact(p.written)} written
                    </span>
                  </div>
                  <div className="chart-pair-line">
                    <Bar share={max ? p.billed / max : 0} tone="billed" />
                    <span className="chart-value">{compact(p.billed)} billed</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </ChartFigure>
  )
}

// ── by name ──────────────────────────────────────────────────────────────────

const CHARTS: Record<string, () => ReactNode> = {
  'time-split': () => <TimeSplit />,
  'progressive-gate': () => <ProgressiveGate />,
  'cost-by-player': () => <CostByPlayer />,
  'tokens-by-player': () => <TokensByPlayer />,
}

export const CHART_NAMES = Object.keys(CHARTS)

/** A `<!-- chart: <name> -->` marker, drawn. An unknown name draws nothing. */
export function Chart({ name }: { name: string }) {
  const draw = CHARTS[name]
  return draw ? <>{draw()}</> : null
}
