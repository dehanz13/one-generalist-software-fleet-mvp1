/**
 * Upcoming Matches: the planned tickets on a two-week sprint board (or as a
 * list), "Run now" for a ticket, a form to ask for any set piece, and the
 * requests with where each one got to. Requests are only queued here; a Mac
 * whose Scheduler accepts them claims and plays them.
 */
import { CalendarDays, ChevronLeft, ChevronRight, FileText, List, Play, Send, X } from 'lucide-react'
import { type FormEvent, useMemo, useState } from 'react'
import { longDate } from '../../shared/report'
import type { RequestRow, RequestStatus, UpcomingMatchRow, UpcomingStatus } from '../../shared/types'
import { LoadError } from '../components/LoadError'
import { useSource } from '../data/context'
import { DEMO_READ_ONLY } from '../data/demo'
import { useCalendarNow, usePlanned } from '../data/hooks'
import { ApiFailure, type Source } from '../data/source'
import { fmtAgo } from '../lib/format'
import { addDays, currentSprint, dayOf, dueTimes, mondayOf, shortDay, sprintBoard, viewerZone, zoneLabel } from '../lib/report-view'
import { hrefFor } from '../lib/router'

/** Every set piece a request can name. */
export const SET_PIECES = [
  'ask',
  'scout-opposition',
  'team-talk',
  'attack',
  'talk-attack',
  'attack-var',
  'attack-review',
  'run-normal',
  'run-heroic',
  'run-mythic',
  'bard',
  'qa',
  'play',
] as const

const VIEW_KEY = 'matchday.upcoming-view'

type Status = UpcomingStatus | RequestStatus

const STATUS_TEXT: Record<Status, string> = {
  scheduled: 'Scheduled',
  due: 'Due',
  queued: 'Queued',
  claimed: 'Claimed',
  running: 'Running',
  touchdown: 'Touchdown',
  turnover: 'Turnover',
  skipped: 'Skipped',
  refused: 'Refused',
  cancelled: 'Cancelled',
}

export function PlannedChip({ status }: { status: Status | null }) {
  const value = status ?? 'scheduled'
  return (
    <span className={`pchip ${value}`}>
      {value === 'running' ? <span className="pulse" aria-hidden="true" /> : null}
      {STATUS_TEXT[value] ?? value}
    </span>
  )
}

function SourceChip({ row }: { row: UpcomingMatchRow }) {
  if (row.source === 'linear') {
    return (
      <span className="chip source-chip" title="Linear tickets are designed for and arrive in a later version">
        Linear · coming later
      </span>
    )
  }
  const file = (row.source_ref ?? '').split('/').filter(Boolean).at(-1) ?? 'markdown'
  return (
    <span className="chip source-chip" title={row.source_ref ?? undefined}>
      <FileText size={12} aria-hidden="true" /> {file}
    </span>
  )
}

const RUNNABLE = new Set<Status | null>(['scheduled', 'due', 'skipped', 'turnover'])

interface Actions {
  canAct: boolean
  busy: string | null
  run: (ticket: UpcomingMatchRow) => void
}

function TicketCard({ row, viewer, actions }: { row: UpcomingMatchRow; viewer: string; actions: Actions }) {
  const times = dueTimes(row, viewer)
  return (
    <article className={`ticket ${row.status ?? ''}`} aria-label={`${row.ticket_id}: ${row.title ?? ''}`}>
      <header className="ticket-head">
        <span className="mono ticket-id">{row.ticket_id}</span>
        <span className={`mode ${row.mode ?? 'manual'}`} title={row.mode === 'auto' ? 'The Scheduler starts it when it is due' : 'A person starts it'}>
          {row.mode ?? 'manual'}
        </span>
        <PlannedChip status={row.status} />
      </header>
      <h3 className="ticket-title">{row.title ?? row.prompt ?? row.ticket_id}</h3>
      <p className="ticket-meta">
        <span className="tag">{row.set_piece ?? 'no set piece'}</span>
        <span className="ticket-time" title={row.due_at ?? undefined}>
          {times.own}
          {times.viewer ? <span className="muted"> · {times.viewer} for you</span> : null}
        </span>
      </p>
      <p className="ticket-foot">
        <SourceChip row={row} />
        {row.match_id ? (
          <a className="mono" href={hrefFor({ page: 'match', matchId: row.match_id, objectiveId: null })}>
            match {row.match_id}
          </a>
        ) : null}
        {actions.canAct && RUNNABLE.has(row.status) ? (
          <button
            type="button"
            className="button run-now"
            disabled={actions.busy === row.ticket_id}
            onClick={() => actions.run(row)}
            title="Queue this ticket for a Mac that accepts requests"
          >
            <Play size={13} aria-hidden="true" /> {actions.busy === row.ticket_id ? 'Queuing…' : 'Run now'}
          </button>
        ) : null}
      </p>
      {row.note ? <p className="ticket-note">{row.note}</p> : null}
    </article>
  )
}

function Board({ rows, today, viewer, actions }: { rows: UpcomingMatchRow[]; today: string; viewer: string; actions: Actions }) {
  const sprint = currentSprint(rows, today)
  const [shift, setShift] = useState(0)
  const anchor = addDays(mondayOf(sprint?.from ?? today), shift * 14)
  const board = sprintBoard(rows, anchor)
  const end = addDays(board.start, 13)
  const cell = (date: string) => {
    const list = board.byDate.get(date) ?? []
    return (
      <div key={date} className={`board-day ${date === today ? 'today' : ''} ${date < today ? 'past' : ''}`}>
        <h3 className="board-day-head">
          {shortDay(date)}
          {date === today ? <span className="today-mark">today</span> : null}
        </h3>
        {list.map((row) => (
          <TicketCard key={row.ticket_id} row={row} viewer={viewer} actions={actions} />
        ))}
      </div>
    )
  }
  return (
    <section className="sprint" aria-label="Sprint board">
      <div className="sprint-head">
        <h2>
          {sprint?.name ?? 'Two weeks'} <span className="muted">· {longDate(board.start).replace(/ \d{4}$/, '')} to {longDate(end)}</span>
        </h2>
        <span className="toolbar">
          <button type="button" className="icon-button" onClick={() => setShift((n) => n - 1)} aria-label="The two weeks before">
            <ChevronLeft size={18} />
          </button>
          {shift !== 0 ? (
            <button type="button" className="button" onClick={() => setShift(0)}>
              This sprint
            </button>
          ) : null}
          <button type="button" className="icon-button" onClick={() => setShift((n) => n + 1)} aria-label="The two weeks after">
            <ChevronRight size={18} />
          </button>
        </span>
      </div>
      <div className="board-scroll">
        {board.weeks.map((week, i) => (
          <div key={week[0]} className="board-week" aria-label={`Week ${i + 1}`}>
            {week.map(cell)}
          </div>
        ))}
        <div className="board-weekend" aria-label="Weekends">
          <span className="weekend-label">Weekend</span>
          {board.weekend.map(cell)}
        </div>
      </div>
      {board.outside.length ? (
        <p className="muted outside-note">
          {board.outside.length} ticket{board.outside.length === 1 ? ' is' : 's are'} dated outside these two weeks; the list shows them all.
        </p>
      ) : null}
    </section>
  )
}

function ListView({ rows, viewer, actions }: { rows: UpcomingMatchRow[]; viewer: string; actions: Actions }) {
  return (
    <div className="table-wrap">
      <table className="report-table upcoming-table">
        <thead>
          <tr>
            <th>Due</th>
            <th>Ticket</th>
            <th>Set piece</th>
            <th>Mode</th>
            <th>Status</th>
            <th>Source</th>
            <th>Match</th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const times = dueTimes(row, viewer)
            return (
              <tr key={row.ticket_id}>
                <td>
                  {row.date ? longDate(row.date) : '—'}
                  <div className="muted">
                    {times.own}
                    {times.viewer ? ` · ${times.viewer} for you` : ''}
                  </div>
                </td>
                <td>
                  <span className="mono">{row.ticket_id}</span>
                  <div>{row.title}</div>
                  {row.note ? <div className="ticket-note">{row.note}</div> : null}
                </td>
                <td>{row.set_piece}</td>
                <td>
                  <span className={`mode ${row.mode ?? 'manual'}`}>{row.mode ?? 'manual'}</span>
                </td>
                <td>
                  <PlannedChip status={row.status} />
                </td>
                <td>
                  <SourceChip row={row} />
                </td>
                <td>
                  {row.match_id ? (
                    <a className="mono" href={hrefFor({ page: 'match', matchId: row.match_id, objectiveId: null })}>
                      {row.match_id}
                    </a>
                  ) : null}
                </td>
                <td>
                  {actions.canAct && RUNNABLE.has(row.status) ? (
                    <button type="button" className="button run-now" disabled={actions.busy === row.ticket_id} onClick={() => actions.run(row)}>
                      <Play size={13} aria-hidden="true" /> Run now
                    </button>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Explain() {
  return (
    <ul className="explain">
      <li>
        A request runs only on a Mac whose <code>ogsf scheduler</code> runs with <code>scheduler.accept_remote: true</code> in its
        config. Until one claims it, it waits as <em>queued</em>.
      </li>
      <li>
        A set-piece request must name one of that Mac’s <code>scheduler.allowed_set_pieces</code>, or it is <em>refused</em>{' '}
        with the reason. A ticket you wrote may start any set piece.
      </li>
    </ul>
  )
}

function EmptyUpcoming() {
  return (
    <div className="empty upcoming-empty">
      <h2>No upcoming matches yet</h2>
      <p>
        Plan work in markdown files under <code>set_pieces/upcoming/*.md</code> in your repository. Each ticket is a level-two heading,
        a few <code>key: value</code> lines, a blank line and the prompt. <code>mode: auto</code> lets the Scheduler start it when it
        is due; <code>manual</code> waits for you.
      </p>
      <pre className="code">{`---
sprint: Sprint 14
timezone: America/Chicago
---

## KICK-7 · Add a /health endpoint
date: 2026-10-19
time: 09:30
set piece: run-heroic
mode: auto

Add a /health endpoint that answers ok.`}</pre>
    </div>
  )
}

function NewRequestForm({ canAct, onSubmit }: { canAct: boolean; onSubmit: (request: { set_piece: string; prompt: string; machine: string; player: string }) => Promise<void> }) {
  const [setPiece, setSetPiece] = useState<string>('ask')
  const [prompt, setPrompt] = useState('')
  const [machine, setMachine] = useState('')
  const [player, setPlayer] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    onSubmit({ set_piece: setPiece, prompt, machine, player })
      .then(() => setPrompt(''))
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }
  return (
    <form className="request-form" onSubmit={submit} aria-label="New request">
      <label className="field">
        <span>Set piece</span>
        <select className="input" value={setPiece} onChange={(e) => setSetPiece(e.target.value)} disabled={!canAct}>
          {SET_PIECES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {setPiece === 'ask' ? (
        <label className="field">
          <span>
            Player <span className="muted">(optional: who answers)</span>
          </span>
          <input className="input" value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="ranger" disabled={!canAct} />
        </label>
      ) : null}
      <label className="field wide">
        <span>Prompt</span>
        <textarea
          className="input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          required={setPiece !== 'qa'}
          placeholder={setPiece === 'run-mythic' ? 'The quest spec’s path, or the request' : 'What the match should do'}
          disabled={!canAct}
        />
      </label>
      <label className="field">
        <span>
          Machine <span className="muted">(optional)</span>
        </span>
        <input className="input" value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="any Mac that accepts requests" disabled={!canAct} />
      </label>
      <div className="form-foot">
        <button type="submit" className="button primary" disabled={!canAct || busy}>
          <Send size={15} aria-hidden="true" /> {busy ? 'Queuing…' : 'Queue request'}
        </button>
      </div>
    </form>
  )
}

function RequestsList({ rows, now, canAct, busy, cancel }: { rows: RequestRow[]; now: number; canAct: boolean; busy: string | null; cancel: (row: RequestRow) => void }) {
  if (!rows.length) return <p className="muted">No requests yet.</p>
  return (
    <ul className="requests">
      {rows.map((r) => (
        <li key={r.request_id} className="request">
          <div className="request-main">
            <PlannedChip status={r.status} />
            <strong>{r.kind === 'ticket' ? `ticket ${r.ticket_id ?? ''}` : (r.set_piece ?? 'set piece')}</strong>
            {r.prompt ? <span className="request-prompt">“{r.prompt}”</span> : null}
          </div>
          <div className="request-meta muted">
            <span className="mono">{r.request_id}</span>
            <span>asked by {r.requested_by ?? 'someone'}</span>
            <span title={r.created_at ?? undefined}>{fmtAgo(r.created_at, now)}</span>
            {r.machine ? <span>for {r.machine}</span> : null}
            {r.claimed_by ? <span>claimed by {r.claimed_by}</span> : r.status === 'queued' ? <span>not claimed yet</span> : null}
            {r.match_id ? (
              <a className="mono" href={hrefFor({ page: 'match', matchId: r.match_id, objectiveId: null })}>
                match {r.match_id}
              </a>
            ) : null}
          </div>
          {r.note ? <p className="ticket-note">{r.note}</p> : null}
          {canAct && r.status === 'queued' ? (
            <button type="button" className="button danger cancel" disabled={busy === r.request_id} onClick={() => cancel(r)}>
              <X size={14} aria-hidden="true" /> {busy === r.request_id ? 'Cancelling…' : 'Cancel'}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function readView(): 'board' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board'
  } catch {
    return 'board'
  }
}

export function UpcomingPage({ source }: { source: Source }) {
  const { health } = useSource()
  const viewer = useMemo(viewerZone, [])
  const now = useCalendarNow(source)
  const today = dayOf(now, viewer)
  const { upcoming, requests, loading, upcomingError, requestsError, reload } = usePlanned(source)
  const [view, setView] = useState<'board' | 'list'>(readView)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  const canAct = source.kind !== 'demo'

  const choose = (next: 'board' | 'list') => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Not remembered; still switched.
    }
  }

  const failed = (err: unknown, doing: string) => {
    const text =
      err instanceof ApiFailure && err.status === 401
        ? `Sign in to ${doing}: the cloud store only takes requests from a signed-in page.`
        : err instanceof ApiFailure && (err.status === 404 || err.status === 405)
          ? `This fleet cannot take requests yet: update ogsf (or redeploy) to version 2.`
          : err instanceof Error
            ? err.message
            : String(err)
    setMessage({ tone: 'bad', text })
  }

  const actions: Actions = {
    canAct,
    busy,
    run: (ticket) => {
      setBusy(ticket.ticket_id)
      setMessage(null)
      source
        .createRequest({ kind: 'ticket', ticket_id: ticket.ticket_id })
        .then((row) => {
          setMessage({ tone: 'good', text: `${ticket.ticket_id} is queued as ${row.request_id}. It runs when a Mac whose Scheduler accepts requests claims it.` })
          reload()
        })
        .catch((err: unknown) => failed(err, 'run a ticket'))
        .finally(() => setBusy(null))
    },
  }

  const where = health?.source === 'cloud' ? 'the cloud store' : source.kind === 'fleet' ? 'that fleet' : 'this Mac'

  return (
    <div className="page upcoming-page" data-tour="upcoming">
      <div className="page-head">
        <div>
          <h1>Upcoming Matches</h1>
          <p>
            Planned work and requests to run it, from {source.kind === 'demo' ? 'the demo recording' : where}. Times in{' '}
            {zoneLabel(viewer, now)}.
          </p>
        </div>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'board'} onClick={() => choose('board')}>
            <CalendarDays size={14} aria-hidden="true" /> Board
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => choose('list')}>
            <List size={14} aria-hidden="true" /> List
          </button>
        </div>
      </div>

      {source.kind === 'demo' ? (
        <p className="demo-note" role="note">
          {DEMO_READ_ONLY}
        </p>
      ) : null}
      {message ? (
        <div className={`notice ${message.tone === 'bad' ? 'bad' : 'good'}`} role={message.tone === 'bad' ? 'alert' : 'status'}>
          <div>
            <p>{message.text}</p>
          </div>
        </div>
      ) : null}

      <LoadError error={upcomingError} what="Upcoming Matches" />
      {loading && !upcoming.length && !upcomingError ? <p className="muted">Reading the plan…</p> : null}
      {!loading && !upcomingError && upcoming.length === 0 ? <EmptyUpcoming /> : null}
      {upcoming.length ? (
        view === 'board' ? (
          <Board rows={upcoming} today={today} viewer={viewer} actions={actions} />
        ) : (
          <ListView rows={upcoming} viewer={viewer} actions={actions} />
        )
      ) : null}

      <div className="requests-area">
        <section className="panel" aria-labelledby="new-request">
          <div className="panel-head">
            <h2 id="new-request">Ask for a match</h2>
          </div>
          <div className="panel-body">
            <Explain />
            <NewRequestForm
              canAct={canAct}
              onSubmit={async ({ set_piece, prompt, machine, player }) => {
                setMessage(null)
                try {
                  const row = await source.createRequest({
                    kind: 'set_piece',
                    set_piece,
                    ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
                    ...(machine.trim() ? { machine: machine.trim() } : {}),
                    ...(set_piece === 'ask' && player.trim() ? { player: player.trim() } : {}),
                  })
                  setMessage({ tone: 'good', text: `${set_piece} is queued as ${row.request_id}.` })
                  reload()
                } catch (err) {
                  failed(err, 'ask for a match')
                  throw err
                }
              }}
            />
          </div>
        </section>
        <section className="panel" aria-labelledby="requests-title">
          <div className="panel-head">
            <h2 id="requests-title">Requests</h2>
            <span className="muted">newest first</span>
          </div>
          <div className="panel-body">
            <LoadError error={requestsError} what="requests" />
            {requestsError ? null : (
              <RequestsList
                rows={requests}
                now={now}
                canAct={canAct}
                busy={busy}
                cancel={(row) => {
                  setBusy(row.request_id)
                  setMessage(null)
                  source
                    .cancelRequest(row.request_id)
                    .then(() => {
                      setMessage({ tone: 'good', text: `${row.request_id} is cancelled.` })
                      reload()
                    })
                    .catch((err: unknown) => failed(err, 'cancel a request'))
                    .finally(() => setBusy(null))
                }}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
