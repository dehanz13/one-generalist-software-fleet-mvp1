/**
 * Daily reports: one card per day, newest first, the last 14 days to start
 * with. Days are cut in the viewer's zone. Tick days to build a multi-day
 * report from them; open one to see it whole.
 */
import { ChevronLeft, ChevronRight, LineChart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dailyReports, longDate, rangeBounds } from '../../shared/report'
import { DayCard } from '../components/DayCard'
import { LoadError } from '../components/LoadError'
import { useCalendarNow, useReportFacts } from '../data/hooks'
import type { Source } from '../data/source'
import { PLAYER_PALETTE } from '../lib/events'
import { addDays, dayOf, lastDays, playerColors, viewerZone, zoneLabel } from '../lib/report-view'
import { hrefFor, navigate } from '../lib/router'

const PAGE_DAYS = 14

/** "Mon 12 Oct": a long date without its year. */
const dayName = (date: string) => longDate(date).replace(/ \d{4}$/, '')

export function DaysPage({ source, date }: { source: Source; date: string | null }) {
  const timeZone = useMemo(viewerZone, [])
  const now = useCalendarNow(source)
  const today = dayOf(now, timeZone)
  const [count, setCount] = useState(PAGE_DAYS)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const span = date ? { from: date, to: date } : lastDays(today, count)
  const { since, until } = useMemo(() => rangeBounds(span.from, span.to, timeZone), [span.from, span.to, timeZone])
  const { facts, loading, error } = useReportFacts(source, since, until)
  const days = useMemo(() => (facts ? dailyReports(facts, { timeZone }) : []), [facts, timeZone])
  const colors = useMemo(
    () => (facts ? playerColors(facts.players, days.flatMap((d) => d.agents.map((a) => a.player)), PLAYER_PALETTE) : {}),
    [facts, days],
  )

  const picked = [...selected].sort()
  const from = picked[0]
  const to = picked[picked.length - 1]
  const toggle = (day: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(day)
      else next.delete(day)
      return next
    })

  const zone = (
    <p>
      Times and days in <strong>{zoneLabel(timeZone, now)}</strong>, your zone.
      {source.kind === 'demo' ? ' The demo keeps the recording’s own dates.' : ''}
    </p>
  )

  if (date) {
    const day = days[0]
    return (
      <div className="page" data-tour="days">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href={hrefFor({ page: 'days', date: null })}>Daily reports</a>
          <span aria-hidden="true">/</span>
          <span>{longDate(date)}</span>
        </nav>
        <div className="page-head">
          <div>
            <h1>{longDate(date)}</h1>
            {zone}
          </div>
          <div className="toolbar">
            <a className="button" href={hrefFor({ page: 'days', date: addDays(date, -1) })}>
              <ChevronLeft size={16} aria-hidden="true" /> {dayName(addDays(date, -1))}
            </a>
            {date < today ? (
              <a className="button" href={hrefFor({ page: 'days', date: addDays(date, 1) })}>
                {dayName(addDays(date, 1))} <ChevronRight size={16} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
        <LoadError error={error} what="daily reports" />
        {day ? (
          <DayCard day={day} timeZone={timeZone} colors={colors} now={now} full />
        ) : loading ? (
          <p className="muted">Reading the day…</p>
        ) : error ? null : (
          <div className="empty">
            <h2>No matches on {longDate(date)}</h2>
            <p>Nothing kicked off that day{date > today ? ' (it has not happened yet)' : ''}.</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page" data-tour="days">
      <div className="page-head">
        <div>
          <h1>Daily reports</h1>
          {zone}
        </div>
        <div className="toolbar">
          <a className="button" href={hrefFor({ page: 'report', from: null, to: null })}>
            <LineChart size={16} aria-hidden="true" /> Multi-day report
          </a>
        </div>
      </div>

      <div className="pick-bar" role="region" aria-label="Days selected for a multi-day report" data-active={picked.length ? 'true' : undefined}>
        {from && to ? (
          <>
            <span>
              <strong>{picked.length}</strong> day{picked.length === 1 ? '' : 's'} selected
              {from !== to ? (
                <>
                  : the report covers {longDate(from)} to {longDate(to)}
                </>
              ) : null}
            </span>
            <span className="pick-actions">
              <button type="button" className="button" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button type="button" className="button primary" onClick={() => navigate({ page: 'report', from, to })}>
                Build multi-day report
              </button>
            </span>
          </>
        ) : (
          <span className="muted">Tick days to build a multi-day report from them.</span>
        )}
      </div>

      <LoadError error={error} what="daily reports" />
      {loading && !facts ? <p className="muted">Reading the last {count} days…</p> : null}
      {facts && days.length === 0 ? (
        <div className="empty">
          <h2>No matches in the last {count} days</h2>
          <p>A day appears here as soon as a match kicks off in it.</p>
        </div>
      ) : null}
      <div className="day-list">
        {days.map((day) => (
          <DayCard
            key={day.date}
            day={day}
            timeZone={timeZone}
            colors={colors}
            now={now}
            selected={selected.has(day.date)}
            onSelect={(on) => toggle(day.date, on)}
          />
        ))}
      </div>
      {facts ? (
        <div className="more">
          <span className="muted">
            Showing {longDate(span.from)} to {longDate(span.to)}.
          </span>
          <button type="button" className="button" onClick={() => setCount((n) => n + PAGE_DAYS)} disabled={loading}>
            Show older
          </button>
        </div>
      ) : null}
    </div>
  )
}
