/**
 * Everything about one objective: what it was for, what happened in it,
 * what its player handed back, what the officials checked, and the exact
 * prompts the player was sent.
 */
import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { parsePayload } from '../../shared/players'
import type {
  EventRow,
  MatchReportRow,
  ObjectiveRow,
  OfficialReviewRow,
  RaiderEndPayload,
  RaiderStartPayload,
  TeamTalks,
} from '../../shared/types'
import type { Source } from '../data/source'
import {
  EVENT_LABEL,
  KIND_LABEL,
  eventDurationMs,
  eventText,
  eventTone,
  reviewChecks,
  stringList,
  toolCast,
} from '../lib/events'
import { durationOf, fmtClock, fmtDate, fmtDuration, fmtInt, fmtMoney, fmtTokens } from '../lib/format'
import { JsonBlock } from '../lib/json'
import { Markdown } from '../lib/markdown'
import { Notice, StatusChip } from './common'

type Tab = 'overview' | 'events' | 'reports' | 'reviews' | 'talks'

export function ObjectivePanel({
  source,
  matchId,
  objective,
  events,
  reports,
  reviews,
  now,
  onClose,
}: {
  source: Source
  matchId: string
  objective: ObjectiveRow
  events: EventRow[]
  reports: MatchReportRow[]
  reviews: OfficialReviewRow[]
  now: number
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('overview')
  useEffect(() => setTab('overview'), [objective.objective_id])

  const own = useMemo(() => events.filter((e) => e.objective_id === objective.objective_id), [events, objective.objective_id])
  const ownReports = reports.filter((r) => r.objective_id === objective.objective_id)
  const ownReviews = reviews.filter((r) => r.objective_id === objective.objective_id)
  const isPlayer = objective.kind === 'player'

  const tabs: Array<[Tab, string, number | null]> = [
    ['overview', 'Overview', null],
    ['events', 'Events', own.length],
    ['reports', 'Match reports', ownReports.length],
    ['reviews', 'Official reviews', ownReviews.length],
    ...(isPlayer ? ([['talks', 'Team talks', null]] as Array<[Tab, string, number | null]>) : []),
  ]

  return (
    <section className="panel" aria-label={`Objective ${objective.name}`} data-tour="objective">
      <div className="objective-head">
        <div>
          <h2>{objective.name}</h2>
          {objective.description ? <p>{objective.description}</p> : null}
          <div className="tags">
            <StatusChip status={objective.status} />
            <span className="tag">
              {objective.kind ? KIND_LABEL[objective.kind] : 'Objective'} <b>{objective.owner ?? 'unknown'}</b>
            </span>
            <span className="tag">
              Time <b>{fmtDuration(durationOf(objective, now))}</b>
            </span>
            <span className="tag" title="Corrections sent after a failed official review, out of those allowed">
              Retries <b>{objective.attempt ?? 0}/{objective.retries ?? 0}</b>
            </span>
          </div>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close the objective">
          <X size={18} />
        </button>
      </div>

      <div className="tabs" role="tablist" aria-label="Objective detail">
        {tabs.map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
            {count !== null ? <span className="count">{count}</span> : null}
          </button>
        ))}
      </div>

      <div className="tab-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' ? <Overview objective={objective} events={own} /> : null}
        {tab === 'events' ? <EventsList events={own} /> : null}
        {tab === 'reports' ? <Reports reports={ownReports} /> : null}
        {tab === 'reviews' ? <Reviews reviews={ownReviews} /> : null}
        {tab === 'talks' && objective.owner ? <Talks source={source} matchId={matchId} player={objective.owner} /> : null}
      </div>
    </section>
  )
}

function Overview({ objective, events }: { objective: ObjectiveRow; events: EventRow[] }) {
  const ask = useMemo(() => {
    if (objective.kind !== 'head_coach') return null
    for (const e of events) {
      const input = parsePayload(e.payload_json)?.input
      if (e.type === 'log' && typeof input === 'string' && input.trim()) return input
    }
    return null
  }, [objective.kind, events])
  const start = events.find((e) => e.type === 'raider_start')
  const config = start ? ((parsePayload(start.payload_json) ?? {}) as RaiderStartPayload) : null
  const end = events.find((e) => e.type === 'raider_end')
  const spent = end ? ((parsePayload(end.payload_json) ?? {}) as RaiderEndPayload) : null

  return (
    <>
      {objective.error ? (
        <Notice tone="bad">
          <p style={{ whiteSpace: 'pre-wrap' }}>{objective.error}</p>
        </Notice>
      ) : null}
      {ask ? (
        <>
          <h3 className="section-title">The ask</h3>
          <pre className="code">{ask}</pre>
        </>
      ) : null}
      <h3 className="section-title">Objective</h3>
      <dl className="kv">
        <dt>Id</dt>
        <dd className="mono">{objective.objective_id}</dd>
        <dt>Kick-off</dt>
        <dd>{fmtDate(objective.started_at)}</dd>
        <dt>Full time</dt>
        <dd>{objective.ended_at ? fmtDate(objective.ended_at) : objective.status === 'running' ? 'Still playing' : '—'}</dd>
      </dl>
      {config ? (
        <>
          <h3 className="section-title">Player</h3>
          <dl className="kv">
            {config.club ? (
              <>
                <dt>Club</dt>
                <dd>{config.club}</dd>
              </>
            ) : null}
            {config.model ? (
              <>
                <dt>Model</dt>
                <dd className="mono">{config.model}</dd>
              </>
            ) : null}
            {config.thinking ? (
              <>
                <dt>Thinking</dt>
                <dd>{config.thinking}</dd>
              </>
            ) : null}
            {config.purpose ? (
              <>
                <dt>Purpose</dt>
                <dd>{config.purpose}</dd>
              </>
            ) : null}
            {config.tools !== undefined ? (
              <>
                <dt>Tools</dt>
                <dd>
                  {config.tools === null ? (
                    'Every tool'
                  ) : (
                    <span className="chips">
                      {config.tools.map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                </dd>
              </>
            ) : null}
            {config.enchantments !== undefined ? (
              <>
                <dt>Enchantments</dt>
                <dd>
                  {config.enchantments.length ? (
                    <span className="chips">
                      {config.enchantments.map((t) => (
                        <span key={t} className="chip">
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : (
                    'None'
                  )}
                </dd>
              </>
            ) : null}
            {config.session_id ? (
              <>
                <dt>Club session</dt>
                <dd className="mono">{config.session_id}</dd>
              </>
            ) : null}
          </dl>
        </>
      ) : null}
      {spent ? <UsageTable spent={spent} tokens={end?.tokens ?? 0} /> : null}
    </>
  )
}

function UsageTable({ spent, tokens }: { spent: RaiderEndPayload; tokens: number }) {
  const u = spent.usage
  const rows: Array<{ label: string; tokens: number; cost: number; kind?: 'nested' | 'total'; title?: string }> = u
    ? [
        { label: 'Input', tokens: u.input_tokens, cost: u.input_cost, title: 'Uncached input; cache reads are billed apart' },
        { label: 'Output', tokens: u.output_tokens, cost: u.output_cost },
        ...(u.reasoning_tokens
          ? [
              {
                label: 'of which thinking',
                tokens: u.reasoning_tokens,
                cost: u.output_tokens ? (u.output_cost * u.reasoning_tokens) / u.output_tokens : 0,
                kind: 'nested' as const,
                title: 'Part of output above, billed at the output rate; not added to the total',
              },
            ]
          : []),
        { label: 'Cache read', tokens: u.cache_read_tokens, cost: u.cache_read_cost },
        { label: 'Cache write', tokens: u.cache_write_tokens, cost: u.cache_write_cost },
        { label: 'Total', tokens: u.total_tokens, cost: u.total_cost, kind: 'total' as const },
      ]
    : [{ label: 'Total', tokens, cost: spent.cost ?? 0, kind: 'total' as const }]
  return (
    <>
      <h3 className="section-title">What it cost</h3>
      <table className="usage-table">
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Tokens</th>
            <th scope="col">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={r.kind ?? ''} title={r.title}>
              <td>{r.label}</td>
              <td>{fmtInt(r.tokens)}</td>
              <td>{fmtMoney(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!u ? <p className="muted">This match predates the breakdown by part: only the total was recorded.</p> : null}
    </>
  )
}

export function EventsList({ events }: { events: EventRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  if (!events.length) return <p className="muted">No events in this objective yet.</p>
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <div className="events-list">
      {events.map((e) => {
        const duration = eventDurationMs(e)
        const call = toolCast(e)
        const expanded = open.has(e.event_id)
        return (
          <div key={e.event_id}>
            <button type="button" className="event-row" aria-expanded={expanded} onClick={() => toggle(e.event_id)}>
              <span className="t">{fmtClock(e.started_at)}</span>
              <span className={`kind tone-${eventTone(e)}`}>{EVENT_LABEL[e.type ?? ''] ?? e.type}</span>
              <span className="text" title={eventText(e)}>
                {eventText(e)}
              </span>
              <span className="extra">
                {Number.isFinite(duration) ? fmtDuration(duration) : ''}
                {e.tokens ? ` ${fmtTokens(e.tokens)} tok` : ''}
              </span>
            </button>
            {expanded ? (
              <div className="event-detail">
                {call ? (
                  <>
                    <h4 className="section-title">Arguments</h4>
                    <JsonBlock value={call.args ?? {}} />
                    {call.result_snippet ? (
                      <>
                        <h4 className="section-title">Result{call.ok === false ? ' (the tool reported an error)' : ''}</h4>
                        <pre className="code">{call.result_snippet}</pre>
                      </>
                    ) : null}
                  </>
                ) : e.payload_json ? (
                  <JsonBlock raw={e.payload_json} />
                ) : (
                  <p className="muted">No payload.</p>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** The fields worth reading first, pulled out of a report. */
function headline(payload: Record<string, unknown>): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const text = (key: string, label: string) => {
    const v = payload[key]
    if (typeof v === 'string' && v.trim()) out.push([label, v])
  }
  text('summary', 'Summary')
  if (typeof payload.ruling === 'string') {
    out.push(['Ruling', `${payload.ruling}${typeof payload.ruling_reason === 'string' && payload.ruling_reason ? `: ${payload.ruling_reason}` : ''}`])
  }
  if (typeof payload.approved === 'boolean') out.push(['Approved', payload.approved ? 'Yes' : 'No'])
  for (const [key, label] of [
    ['blocking', 'Blocking'],
    ['changed_files', 'Changed files'],
    ['artifacts', 'Artifacts'],
    ['failures', 'Failures'],
    ['documented_files', 'Documented files'],
  ] as const) {
    const v = payload[key]
    if (Array.isArray(v) && v.length) out.push([label, v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n')])
  }
  text('document_path', 'Write-up')
  text('commit_message', 'Commit message')
  text('notes_for_next_player', 'Notes for the next player')
  return out
}

function Reports({ reports }: { reports: MatchReportRow[] }) {
  if (!reports.length) return <p className="muted">No match report from this objective yet.</p>
  return (
    <div className="stack">
      {reports.map((r) => {
        const payload = parsePayload(r.payload_json) ?? {}
        const valid = r.valid === 1
        const status = typeof payload.status === 'string' ? payload.status : null
        return (
          <article key={r.report_id} className="item">
            <div className="item-head">
              <span className={`mark ${valid ? 'good' : 'bad'}`} aria-hidden="true">
                {valid ? '✓' : '✗'}
              </span>
              <strong className="grow">
                {r.report_type} from {r.player}
              </strong>
              <span className="tag">
                Attempt <b>{r.attempt ?? 0}</b>
              </span>
              {valid ? (
                status ? <span className={`status ${status}`}>{status}</span> : null
              ) : (
                <span className="status turnover">Did not parse</span>
              )}
            </div>
            <div className="item-body">
              {valid ? (
                <dl className="kv">
                  {headline(payload).map(([label, value]) => (
                    <div key={label} style={{ display: 'contents' }}>
                      <dt>{label}</dt>
                      <dd style={{ whiteSpace: 'pre-wrap' }}>{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted">
                  The player's reply was not valid {r.report_type} JSON, so it was sent a correction. The last 2,000 characters of what it said:
                </p>
              )}
              <details style={{ marginTop: 10 }}>
                <summary>Whole report</summary>
                <JsonBlock raw={r.payload_json} />
              </details>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function Reviews({ reviews }: { reviews: OfficialReviewRow[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(reviews.filter((r) => r.passed !== 1).map((r) => r.review_id)))
  if (!reviews.length) return <p className="muted">No official review ran in this objective.</p>
  return (
    <div className="stack">
      {reviews.map((r) => {
        const checks = reviewChecks(r.checks_json)
        const violations = stringList(r.violations_json)
        const failed = checks ? checks.filter((c) => !c.ok).length : violations.length
        const passed = r.passed === 1
        const expanded = open.has(r.review_id)
        return (
          <article key={r.review_id} className="item">
            <button
              type="button"
              className="item-head"
              aria-expanded={expanded}
              onClick={() =>
                setOpen((s) => {
                  const next = new Set(s)
                  if (next.has(r.review_id)) next.delete(r.review_id)
                  else next.add(r.review_id)
                  return next
                })
              }
            >
              <span className={`mark ${passed ? 'good' : 'bad'}`} aria-hidden="true">
                {passed ? '✓' : '✗'}
              </span>
              <strong className="grow mono">{r.review}</strong>
              <span className="tag">
                {checks ? (failed ? `${failed} of ${checks.length} failed` : `${checks.length} checked`) : passed ? 'Passed' : 'Failed'}
              </span>
              <span className="tag">
                Attempt <b>{r.attempt ?? 0}</b>
              </span>
              <span className="muted">{fmtClock(r.created_at)}</span>
            </button>
            {expanded ? (
              <div className="item-body">
                {checks === null ? (
                  <p className="muted">This review recorded its verdict but not the items it checked.</p>
                ) : !checks.length ? (
                  <p className="muted">Nothing to check: the review looked at no items.</p>
                ) : (
                  <ul className="check-list">
                    {checks.map((c, i) => (
                      <li key={i}>
                        <span className={`mark ${c.ok ? 'good' : 'bad'}`} aria-label={c.ok ? 'ok' : 'failed'}>
                          {c.ok ? '✓' : '✗'}
                        </span>
                        <span className="item-text">
                          <span className="mono">{c.item}</span>
                          {c.note && !c.note.includes('\n') ? <span className="note">: {c.note}</span> : null}
                          {c.note && c.note.includes('\n') ? <pre className="code">{c.note}</pre> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {!passed && violations.length ? (
                  <>
                    <h4 className="section-title">Sent back to the player</h4>
                    <pre className="code">{violations.map((v) => `- ${v}`).join('\n')}</pre>
                  </>
                ) : null}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

function Talks({ source, matchId, player }: { source: Source; matchId: string; player: string }) {
  const [talks, setTalks] = useState<TeamTalks | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  useEffect(() => {
    let cancelled = false
    setTalks(null)
    setError(null)
    source
      .teamTalks(matchId, player)
      .then((t) => !cancelled && setTalks(t))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      cancelled = true
    }
  }, [source, matchId, player])

  if (error) return <Notice tone="bad"><p>{error}</p></Notice>
  if (!talks) return <p className="muted">Loading the team talks…</p>
  if (talks.system === null && talks.user === null) {
    return <p className="muted">No team talk was recorded for {player} in this match.</p>
  }
  return (
    <>
      <div className="segmented" role="group" aria-label="How to show the prompts" style={{ marginBottom: 12 }}>
        <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
          Formatted
        </button>
        <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
          Plain text
        </button>
      </div>
      {(
        [
          ['System prompt', talks.system],
          ['User prompt', talks.user],
        ] as const
      ).map(([title, text]) =>
        text === null ? null : (
          <section key={title}>
            <h3 className="section-title">
              {title} <span className="muted">({text.split('\n').length} lines)</span>
            </h3>
            {raw ? <pre className="code">{text}</pre> : <div className="code prose"><Markdown source={text} /></div>}
          </section>
        ),
      )}
    </>
  )
}
