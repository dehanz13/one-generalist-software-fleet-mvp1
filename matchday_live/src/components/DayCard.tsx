/** One day's report: on Daily reports, on its own page, and folded inside the multi-day report. */
import { type DayReport, longDate } from '../../shared/report'
import { dailyReportMarkdown } from '../../shared/report-markdown'
import { downloadMarkdown, downloadPdf } from '../lib/download'
import { reportFileName } from '../lib/report-view'
import { hrefFor } from '../lib/router'
import {
  AgentCharts,
  AgentTable,
  DayTimelineChart,
  DownloadButtons,
  KeyFigures,
  MatchesTable,
  ModelsTable,
  NotableList,
  type PlayerColors,
  SetPiecesTable,
} from './Report'

export interface DayCardProps {
  day: DayReport
  timeZone: string
  colors: PlayerColors
  /** "Now" in the facts' time frame: where a running match's bar ends. */
  now: number
  /** The whole day: the matches table and the agent charts too. */
  full?: boolean
  selected?: boolean
  onSelect?: (selected: boolean) => void
}

export function DayDownloads({ day, timeZone, colors, small }: { day: DayReport; timeZone: string; colors: PlayerColors; small?: boolean }) {
  return (
    <DownloadButtons
      compact={small ?? false}
      what={longDate(day.date)}
      onPdf={() => downloadPdf(reportFileName(day.date, null, 'pdf'), { kind: 'day', day, timeZone, generatedAt: new Date(), colors })}
      onMarkdown={() => downloadMarkdown(reportFileName(day.date, null, 'md'), dailyReportMarkdown(day, timeZone))}
    />
  )
}

export function DayBody({ day, timeZone, colors, now, full }: Omit<DayCardProps, 'selected' | 'onSelect'>) {
  return (
    <>
      <p className="day-summary">{day.summary}</p>
      <KeyFigures totals={day.totals} first={day.first} last={day.last} timeZone={timeZone} />
      <h3 className="section-title">Timeline</h3>
      <DayTimelineChart matches={day.matches} timeZone={timeZone} now={now} />
      {full ? (
        <>
          <h3 className="section-title">Matches</h3>
          <MatchesTable matches={day.matches} timeZone={timeZone} />
        </>
      ) : null}
      <h3 className="section-title">Agent performance</h3>
      <AgentTable agents={day.agents} colors={colors} />
      {full ? <AgentCharts agents={day.agents} colors={colors} /> : null}
      <div className="report-columns">
        <section>
          <h3 className="section-title">Models used</h3>
          <ModelsTable models={day.models} />
        </section>
        <section>
          <h3 className="section-title">Set pieces</h3>
          <SetPiecesTable pieces={day.setPieces} />
        </section>
        <section>
          <h3 className="section-title">Worth a look</h3>
          <NotableList notable={day.notable} />
        </section>
      </div>
    </>
  )
}

export function DayCard({ day, timeZone, colors, now, full, selected, onSelect }: DayCardProps) {
  const title = longDate(day.date)
  return (
    <article className="panel day-card" aria-label={`Daily report, ${title}`} data-selected={selected ? 'true' : undefined}>
      <header className="panel-head day-head">
        {onSelect ? (
          <label className="day-pick" title="Add this day to a multi-day report">
            <input type="checkbox" checked={selected ?? false} onChange={(e) => onSelect(e.target.checked)} />
            <span className="visually-hidden">Select {title} for a multi-day report</span>
          </label>
        ) : null}
        <h2>{full ? title : <a href={hrefFor({ page: 'days', date: day.date })}>{title}</a>}</h2>
        <span className="day-tally" aria-label={`${day.totals.matches} matches`}>
          <span className="tally touchdown">{day.totals.touchdowns}</span>
          <span className="tally turnover">{day.totals.turnovers}</span>
          {day.totals.running ? <span className="tally running">{day.totals.running}</span> : null}
        </span>
        <span className="day-actions">
          <DayDownloads day={day} timeZone={timeZone} colors={colors} small />
        </span>
      </header>
      <div className="panel-body">
        <DayBody day={day} timeZone={timeZone} colors={colors} now={now} full={full ?? false} />
      </div>
    </article>
  )
}
