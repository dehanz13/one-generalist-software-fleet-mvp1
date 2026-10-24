import { Archive, ArchiveRestore, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { MatchSummary } from '../../shared/types'
import { Figure, Notice, ObjectiveDots, StatusChip } from '../components/common'
import { useMatches, useNow } from '../data/hooks'
import { ApiFailure, type ArchivedFilter, type Source } from '../data/source'
import { durationOf, fmtAgo, fmtCost, fmtDate, fmtDuration, fmtTokens } from '../lib/format'
import { hrefFor } from '../lib/router'

type StatusFilter = 'all' | 'running' | 'touchdown' | 'turnover'

const STATUS_FILTERS: Array<[StatusFilter, string]> = [
  ['all', 'All'],
  ['running', 'Running'],
  ['touchdown', 'Touchdown'],
  ['turnover', 'Turnover'],
]

export function MatchesPage({ source }: { source: Source }) {
  const [archived, setArchived] = useState<ArchivedFilter>('0')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const { matches, loading, error } = useMatches(source, archived)
  const now = useNow(source, 1000)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return matches.filter((m) => {
      if (hidden.has(m.match_id)) return false
      if (status !== 'all' && m.status !== status) return false
      if (!q) return true
      return [m.match_id, m.setpiece_name, m.ask, m.founder, m.machine, m.project]
        .filter(Boolean)
        .some((text) => (text as string).toLowerCase().includes(q))
    })
  }, [matches, status, query, hidden])

  const counts = useMemo(() => {
    const c = { all: matches.length, running: 0, touchdown: 0, turnover: 0 }
    for (const m of matches) if (m.status && m.status in c) c[m.status as 'running' | 'touchdown' | 'turnover']++
    return c
  }, [matches])

  const toggleArchive = async (m: MatchSummary) => {
    const next = m.archived !== 1
    // Out of the list at once; a failed write brings it back.
    setHidden((h) => new Set(h).add(m.match_id))
    try {
      await source.archive(m.match_id, next)
    } finally {
      setHidden((h) => {
        const copy = new Set(h)
        copy.delete(m.match_id)
        return copy
      })
    }
  }

  const needsSignIn = error instanceof ApiFailure && error.status === 401

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Matches</h1>
          <p>
            {archived === '1' ? 'Archived matches' : 'Every set piece run, the newest first'}
            {matches.length ? `. ${matches.length} ${matches.length === 1 ? 'match' : 'matches'}.` : '.'}
          </p>
        </div>
      </div>

      <div className="toolbar" data-tour="filters">
        <div className="segmented" role="group" aria-label="Filter by result">
          {STATUS_FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>
              {label} <span className="muted">{counts[value]}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <span className="visually-hidden">Search matches</span>
          <span className="search-wrap">
            <Search size={16} aria-hidden="true" />
            <input
              className="input"
              type="search"
              placeholder="Search by id, set piece, ask, machine"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={archived === '1'} onChange={(e) => setArchived(e.target.checked ? '1' : '0')} />
          Show archived
        </label>
      </div>

      {needsSignIn ? (
        <Notice tone="warn">
          <p>
            The cloud store needs you to sign in. <a href={hrefFor({ page: 'sign-in' })}>Sign in</a>, or{' '}
            <a href={hrefFor({ page: 'connections' })}>watch the demo or a local fleet instead</a>.
          </p>
        </Notice>
      ) : error ? (
        <Notice tone="bad">
          <p>{error.message}</p>
        </Notice>
      ) : null}

      {!error && !loading && !shown.length ? (
        <div className="empty">
          {matches.length ? (
            <>
              <h2>No match fits these filters</h2>
              <p>Clear the search or choose All to see every match.</p>
            </>
          ) : archived === '1' ? (
            <>
              <h2>Nothing archived</h2>
              <p>Archive a match from the list once you have reviewed it; it moves here.</p>
            </>
          ) : (
            <>
              <h2>No matches yet</h2>
              <p>
                Run a set piece on a Mac, for example <code>ogsf ask "summarise this repo"</code>, and it appears here as it plays.
              </p>
            </>
          )}
        </div>
      ) : null}

      {shown.length ? (
        <ol className="fixtures" data-tour="matches">
          {shown.map((m) => (
            <li key={m.match_id} className={`fixture ${m.status ?? ''}`}>
              <a className="fixture-link" href={hrefFor({ page: 'match', matchId: m.match_id, objectiveId: null })}>
                <span className="visually-hidden">
                  Open match {m.match_id}, {m.setpiece_name}, {m.status}
                </span>
              </a>
              <div className="fixture-main">
                <div className="fixture-title">
                  <span className="fixture-setpiece">{m.setpiece_name || 'set piece'}</span>
                  <span className="fixture-id">{m.match_id}</span>
                </div>
                <div className="fixture-ask" title={m.ask ?? ''}>
                  {m.ask || <span className="muted">No ask recorded</span>}
                </div>
              </div>
              <div className="fixture-progress">
                <StatusChip status={m.status} />
                <ObjectiveDots objectives={m.objectives} players={m.players} />
                <span className="players">{m.players.map((p) => p.player).join(', ') || 'No players yet'}</span>
              </div>
              <div className="fixture-figures">
                <Figure label="Cost" value={fmtCost(m.total_cost)} title="Dollars billed, every player combined" />
                <Figure
                  label="Tokens"
                  value={fmtTokens(m.total_tokens)}
                  title="Billed tokens: every turn re-sends the conversation, so this is spend, not size"
                />
                <Figure label="Time" value={fmtDuration(durationOf(m, now))} />
              </div>
              <div className="fixture-end">
                <span title={fmtDate(m.started_at)}>{fmtAgo(m.started_at, now)}</span>
                <span className="who">
                  {[m.founder, m.machine].filter(Boolean).join(' on ') || 'unknown'}
                </span>
                <button
                  type="button"
                  className="archive-button"
                  onClick={() => void toggleArchive(m)}
                  aria-label={`${m.archived === 1 ? 'Restore' : 'Archive'} match ${m.match_id}`}
                >
                  {m.archived === 1 ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  {m.archived === 1 ? 'Restore' : 'Archive'}
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {loading && !matches.length && !error ? <p className="muted">Loading matches…</p> : null}
    </>
  )
}
