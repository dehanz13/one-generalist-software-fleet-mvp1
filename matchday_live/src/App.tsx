import { Moon, Sun } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Notice, PitchMark } from './components/common'
import { DemoBar, Walkthrough } from './components/Demo'
import { SourceProvider, useSource } from './data/context'
import { type Page, type Route, hrefFor, useRoute } from './lib/router'
import { useTheme } from './lib/theme'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { MatchPage } from './pages/MatchPage'
import { MatchesPage } from './pages/MatchesPage'
import { SignInPage } from './pages/SignInPage'

// Pages most visits never open load on their first visit, so the match pages stay quick.
const DaysPage = lazy(() => import('./pages/DaysPage').then((m) => ({ default: m.DaysPage })))
const ReportPage = lazy(() => import('./pages/ReportPage').then((m) => ({ default: m.ReportPage })))
const UpcomingPage = lazy(() => import('./pages/UpcomingPage').then((m) => ({ default: m.UpcomingPage })))
const DocsPage = lazy(() => import('./pages/DocsPage').then((m) => ({ default: m.DocsPage })))
const GuidePage = lazy(() => import('./pages/GuidePage').then((m) => ({ default: m.GuidePage })))

const loading = <p className="muted">Loading…</p>

export function App() {
  return (
    <SourceProvider>
      <Shell />
    </SourceProvider>
  )
}

const TOUR_SEEN = 'matchday.tour-seen'

/** The main navigation: each entry and the pages that light it up. */
const NAV: Array<{ route: Route; label: string; pages: Page[] }> = [
  { route: { page: 'matches' }, label: 'Matches', pages: ['matches', 'match'] },
  { route: { page: 'days', date: null }, label: 'Daily reports', pages: ['days', 'report'] },
  { route: { page: 'upcoming' }, label: 'Upcoming Matches', pages: ['upcoming'] },
  { route: { page: 'docs', slug: null }, label: 'Docs', pages: ['docs'] },
  { route: { page: 'guide', slug: null }, label: 'Guide', pages: ['guide'] },
  { route: { page: 'connections' }, label: 'Connections', pages: ['connections', 'sign-in'] },
]

function Shell() {
  const route = useRoute()
  const [theme, cycleTheme] = useTheme()
  const { source, demo, error } = useSource()
  const [touring, setTouring] = useState(false)
  const nav = useRef<HTMLElement>(null)

  // The first visit to the demo opens the walkthrough once.
  useEffect(() => {
    if (!demo) return
    try {
      if (localStorage.getItem(TOUR_SEEN)) return
      localStorage.setItem(TOUR_SEEN, '1')
    } catch {
      return
    }
    const timer = setTimeout(() => setTouring(true), 1800)
    return () => clearTimeout(timer)
  }, [demo])

  // On a phone the navigation scrolls sideways: keep the current page in view.
  useEffect(() => {
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (current && nav.current && nav.current.scrollWidth > nav.current.clientWidth) {
      nav.current.scrollTo({ left: current.offsetLeft - 16, behavior: 'smooth' })
    }
  }, [route.page])

  const dark =
    theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const page = (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" href={hrefFor({ page: 'matches' })} aria-label="Matchday Live, all matches">
          <PitchMark />
          <span className="wordmark-text">Matchday Live</span>
        </a>
        <nav className="nav" aria-label="Main" ref={nav}>
          {NAV.map((item) => (
            <a key={item.label} href={hrefFor(item.route)} aria-current={item.pages.includes(route.page) ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="topbar-end">
          <a className="source-pill" href={hrefFor({ page: 'connections' })} title="Change what this page reads">
            <span className={`live-dot ${source ? (source.kind === 'demo' ? 'replay' : 'live') : 'connecting'}`} aria-hidden="true" />
            <span className="source-name">{source?.label ?? 'Connecting…'}</span>
          </a>
          <button
            type="button"
            className="icon-button"
            onClick={cycleTheme}
            aria-label={dark ? 'Use the light theme' : 'Use the dark theme'}
            title={dark ? 'Light theme' : 'Dark theme'}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>
      <main id="main">
        {error ? (
          <Notice tone="bad">
            <p>
              {error} <a href={hrefFor({ page: 'connections' })}>Choose another source.</a>
            </p>
          </Notice>
        ) : null}
        <Suspense fallback={loading}>
          {route.page === 'connections' ? (
            <ConnectionsPage />
          ) : route.page === 'sign-in' ? (
            <SignInPage />
          ) : route.page === 'docs' ? (
            <DocsPage slug={route.slug} />
          ) : route.page === 'guide' ? (
            <GuidePage slug={route.slug} />
          ) : !source ? (
            error ? null : <p className="muted">Connecting…</p>
          ) : route.page === 'match' ? (
            <MatchPage key={route.matchId} source={source} matchId={route.matchId} objectiveId={route.objectiveId} />
          ) : route.page === 'days' ? (
            <DaysPage key={route.date ?? 'all'} source={source} date={route.date} />
          ) : route.page === 'report' ? (
            <ReportPage source={source} from={route.from} to={route.to} />
          ) : route.page === 'upcoming' ? (
            <UpcomingPage source={source} />
          ) : (
            <MatchesPage source={source} />
          )}
        </Suspense>
      </main>
      {demo ? <DemoBar demo={demo} onTour={() => setTouring(true)} /> : null}
    </div>
  )

  // The walkthrough sits beside the page, not inside it, so it keeps its place from page to page.
  return (
    <>
      {page}
      {demo && touring ? <Walkthrough demo={demo} onClose={() => setTouring(false)} /> : null}
    </>
  )
}
