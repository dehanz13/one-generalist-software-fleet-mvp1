import { useMemo } from 'react'
import { LiveFeed } from '../components/LiveFeed'
import { ObjectivePanel } from '../components/ObjectivePanel'
import { Scoreboard } from '../components/Scoreboard'
import { OnPitch, TeamSheet } from '../components/TeamSheet'
import { Timeline } from '../components/Timeline'
import { Notice } from '../components/common'
import { useMatch, useNow } from '../data/hooks'
import { ApiFailure, type Source } from '../data/source'
import { hrefFor, navigate } from '../lib/router'

export function MatchPage({ source, matchId, objectiveId }: { source: Source; matchId: string; objectiveId: string | null }) {
  const state = useMatch(source, matchId)
  const now = useNow(source, 1000)
  const { detail, events, reports, reviews, processes } = state
  const ownerOf = useMemo(
    () => new Map((detail?.objectives ?? []).map((o) => [o.objective_id, o.owner])),
    [detail?.objectives],
  )
  const selected = detail?.objectives.find((o) => o.objective_id === objectiveId) ?? null
  const select = (id: string | null) => navigate({ page: 'match', matchId, objectiveId: id })

  const crumbs = (
    <nav className="crumbs" aria-label="Breadcrumb">
      <a href={hrefFor({ page: 'matches' })}>Matches</a>
      <span aria-hidden="true">/</span>
      <span className="mono">{matchId}</span>
      {selected ? (
        <>
          <span aria-hidden="true">/</span>
          <span>{selected.name}</span>
        </>
      ) : null}
    </nav>
  )

  if (state.error) {
    const signIn = state.error instanceof ApiFailure && state.error.status === 401
    return (
      <>
        {crumbs}
        <Notice tone={signIn ? 'warn' : 'bad'}>
          <p>
            {signIn ? (
              <>
                The cloud store needs you to sign in. <a href={hrefFor({ page: 'sign-in' })}>Sign in</a>.
              </>
            ) : (
              state.error.message
            )}
          </p>
        </Notice>
      </>
    )
  }
  if (state.notFound) {
    return (
      <>
        {crumbs}
        <div className="empty">
          <h2>No match {matchId}</h2>
          <p>It is not in this source. It may be on another Mac, or the source changed.</p>
          <a className="button" href={hrefFor({ page: 'matches' })}>
            See every match
          </a>
        </div>
      </>
    )
  }
  if (state.waiting) {
    return (
      <>
        {crumbs}
        <div className="empty">
          <h2>Not kicked off yet</h2>
          <p>The replay has not reached match {matchId}. This page fills in when it starts.</p>
        </div>
      </>
    )
  }
  if (!detail) {
    return (
      <>
        {crumbs}
        <p className="muted">Loading the match…</p>
      </>
    )
  }

  return (
    <>
      {crumbs}
      <Scoreboard detail={detail} now={now} />
      <div className="match-grid">
        <div>
          <section className="panel" aria-label="Timeline" data-tour="timeline">
            <div className="panel-head">
              <h2>Timeline</h2>
              <span className="muted">Pick an objective to open it</span>
            </div>
            {detail.objectives.length ? (
              <Timeline
                detail={detail}
                events={events}
                now={now}
                selectedId={selected?.objective_id ?? null}
                onSelect={(o) => select(o.objective_id === selected?.objective_id ? null : o.objective_id)}
              />
            ) : (
              <p className="panel-body muted">No objective has started yet.</p>
            )}
          </section>
          {selected ? (
            <ObjectivePanel
              source={source}
              matchId={matchId}
              objective={selected}
              events={events}
              reports={reports}
              reviews={reviews}
              now={now}
              onClose={() => select(null)}
            />
          ) : (
            <section className="panel">
              <p className="panel-body muted">
                Open an objective on the timeline, or a line in the live feed, to see its events, its match reports, the
                official reviews it passed or failed, and the team talks its player was given.
              </p>
            </section>
          )}
        </div>
        <aside>
          <LiveFeed
            events={events}
            players={detail.players}
            ownerOf={ownerOf}
            onPick={(id) => select(id)}
            live={detail.match.status === 'running'}
          />
          <TeamSheet players={detail.players} />
          <OnPitch processes={processes} now={now} />
        </aside>
      </div>
    </>
  )
}
