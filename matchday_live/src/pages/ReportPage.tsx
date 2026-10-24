/**
 * The multi-day report: a period's summary and totals, then agent performance
 * front and centre (to judge every player across set pieces and days), models
 * and set pieces, cost and matches per day, what is worth a look, and every
 * day folded underneath. Downloads as PDF or Markdown.
 */
import { useEffect, useMemo, useState } from 'react'
import { longDate, rangeBounds, rangeReport } from '../../shared/report'
import { rangeReportMarkdown } from '../../shared/report-markdown'
import { DayBody, DayDownloads } from '../components/DayCard'
import { LoadError } from '../components/LoadError'
import {
  AgentCharts,
  AgentTable,
  DailyChart,
  DownloadButtons,
  KeyFigures,
  ModelsTable,
  NotableList,
  SetPiecesTable,
} from '../components/Report'
import { useCalendarNow, usePlanned, useReportFacts } from '../data/hooks'
import type { Source } from '../data/source'
import { downloadMarkdown, downloadPdf } from '../lib/download'
import { PLAYER_PALETTE } from '../lib/events'
import {
  currentSprint,
  dailySeries,
  dayOf,
  daysBetween,
  lastDays,
  playerColors,
  reportFileName,
  reportPresets,
  viewerZone,
  zoneLabel,
} from '../lib/report-view'
import { hrefFor, navigate, validDate } from '../lib/router'

/** The longest period one report reads at once. */
export const MAX_REPORT_DAYS = 186

export function ReportPage({ source, from, to }: { source: Source; from: string | null; to: string | null }) {
  const timeZone = useMemo(viewerZone, [])
  const now = useCalendarNow(source)
  const today = dayOf(now, timeZone)
  const planned = usePlanned(source, false)
  const sprint = useMemo(() => currentSprint(planned.upcoming, today), [planned.upcoming, today])
  const presets = reportPresets(today, sprint)

  // No period in the address: the last 7 days, written back so the link can be shared.
  useEffect(() => {
    if (from && to) return
    const fallback = lastDays(today, 7)
    window.location.replace(hrefFor({ page: 'report', from: from ?? fallback.from, to: to ?? fallback.to }))
  }, [from, to, today])

  const [customFrom, setCustomFrom] = useState(from ?? '')
  const [customTo, setCustomTo] = useState(to ?? '')
  useEffect(() => {
    setCustomFrom(from ?? '')
    setCustomTo(to ?? '')
  }, [from, to])

  const tooLong = Boolean(from && to && daysBetween(from, to).length > MAX_REPORT_DAYS)
  const bounds = useMemo(() => (from && to && !tooLong ? rangeBounds(from, to, timeZone) : null), [from, to, tooLong, timeZone])
  const { facts, loading, error } = useReportFacts(source, bounds?.since ?? null, bounds?.until ?? null)
  const report = useMemo(() => (facts ? rangeReport(facts, { timeZone }) : null), [facts, timeZone])
  const colors = useMemo(
    () => (facts && report ? playerColors(facts.players, report.agents.map((a) => a.player), PLAYER_PALETTE) : {}),
    [facts, report],
  )
  const series = useMemo(() => (report && from && to ? dailySeries(report, from, to) : []), [report, from, to])
  const activePreset = presets.find((p) => p.from === from && p.to === to)?.id ?? 'custom'

  const period = from && to ? (from === to ? longDate(from) : `${longDate(from)} to ${longDate(to)}`) : ''

  return (
    <div className="page report-page" data-tour="report">
      <nav className="crumbs" aria-label="Breadcrumb">
        <a href={hrefFor({ page: 'days', date: null })}>Daily reports</a>
        <span aria-hidden="true">/</span>
        <span>Multi-day report</span>
      </nav>
      <div className="page-head">
        <div>
          <h1>Multi-day report</h1>
          <p>
            {period ? <strong>{period}</strong> : null} · days in {zoneLabel(timeZone, now)}
          </p>
        </div>
        {report && from && to ? (
          <div className="toolbar">
            <DownloadButtons
              onPdf={() => downloadPdf(reportFileName(from, to, 'pdf'), { kind: 'range', report, from, to, colors })}
              onMarkdown={() => downloadMarkdown(reportFileName(from, to, 'md'), rangeReportMarkdown(report))}
            />
          </div>
        ) : null}
      </div>

      <div className="toolbar period-bar">
        <div className="segmented" role="group" aria-label="Period">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={activePreset === p.id}
              onClick={() => navigate({ page: 'report', from: p.from, to: p.to })}
            >
              {p.label}
            </button>
          ))}
          <button type="button" aria-pressed={activePreset === 'custom'} onClick={() => document.getElementById('report-from')?.focus()}>
            Custom
          </button>
        </div>
        <form
          className="custom-range"
          onSubmit={(event) => {
            event.preventDefault()
            const a = validDate(customFrom)
            const b = validDate(customTo)
            if (a && b) navigate({ page: 'report', from: a <= b ? a : b, to: a <= b ? b : a })
          }}
        >
          <label>
            <span>From</span>
            <input className="input" id="report-from" type="date" value={customFrom} max={today} onChange={(e) => setCustomFrom(e.target.value)} required />
          </label>
          <label>
            <span>To</span>
            <input className="input" type="date" value={customTo} max={today} onChange={(e) => setCustomTo(e.target.value)} required />
          </label>
          <button type="submit" className="button">
            Show
          </button>
        </form>
      </div>

      {tooLong ? (
        <div className="notice warn" role="status">
          <div>
            <p>A report covers at most {MAX_REPORT_DAYS} days. Pick a shorter period.</p>
          </div>
        </div>
      ) : null}
      <LoadError error={error} what="reports" />
      {loading && !report ? <p className="muted">Reading the period…</p> : null}

      {report && from && to ? (
        <>
          <section className="panel report-summary" aria-labelledby="report-summary">
            <div className="panel-body">
              <h2 id="report-summary" className="visually-hidden">
                Summary
              </h2>
              <p className="day-summary">{report.summary}</p>
              <KeyFigures
                totals={report.totals}
                first={report.days[0]?.first ?? null}
                last={report.days.at(-1)?.last ?? null}
                timeZone={timeZone}
                withDays
              />
            </div>
          </section>

          <section className="panel agents-panel" aria-labelledby="agents-title">
            <div className="panel-head">
              <h2 id="agents-title">Agent performance</h2>
              <span className="muted">every player across the period</span>
            </div>
            <div className="panel-body">
              <p className="lede">
                How often each player scored, how often on the first try (no corrected reply, every official review green at
                once), how much extra time and correction it needed, and what it cost.
              </p>
              <AgentTable agents={report.agents} colors={colors} />
              <AgentCharts agents={report.agents} colors={colors} />
            </div>
          </section>

          <div className="report-columns two">
            <section className="panel">
              <div className="panel-head">
                <h2>Models used</h2>
              </div>
              <div className="panel-body">
                <ModelsTable models={report.models} />
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Set pieces</h2>
              </div>
              <div className="panel-body">
                <SetPiecesTable pieces={report.setPieces} />
              </div>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Cost and matches per day</h2>
            </div>
            <div className="panel-body">
              <DailyChart series={series} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Worth a look</h2>
            </div>
            <div className="panel-body">
              <NotableList notable={report.notable} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Day by day</h2>
              <span className="muted">{report.days.length} day{report.days.length === 1 ? '' : 's'} with matches</span>
            </div>
            <div className="panel-body day-folds">
              {report.days.length === 0 ? <p className="muted">No matches in this period.</p> : null}
              {[...report.days].reverse().map((day) => (
                <details key={day.date} className="day-fold">
                  <summary>
                    <span className="fold-date">{longDate(day.date)}</span>
                    <span className="day-tally">
                      <span className="tally touchdown">{day.totals.touchdowns}</span>
                      <span className="tally turnover">{day.totals.turnovers}</span>
                      {day.totals.running ? <span className="tally running">{day.totals.running}</span> : null}
                    </span>
                    <span className="muted fold-cost">{day.totals.matches} matches</span>
                  </summary>
                  <div className="fold-body">
                    <div className="fold-actions">
                      <a className="button" href={hrefFor({ page: 'days', date: day.date })}>
                        Open the day
                      </a>
                      <DayDownloads day={day} timeZone={timeZone} colors={colors} small />
                    </div>
                    <DayBody day={day} timeZone={timeZone} colors={colors} now={now} />
                  </div>
                </details>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
