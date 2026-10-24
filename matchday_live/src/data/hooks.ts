import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  EventRow,
  MatchDetail,
  MatchReportRow,
  MatchSummary,
  OfficialReviewRow,
  ProcessRow,
  ReportFacts,
  RequestRow,
  UpcomingMatchRow,
} from '../../shared/types'
import type { ClockState, ReplayClock } from './demo'
import type { ArchivedFilter, LiveState, Source } from './source'

/** Call `onChange` (at most once per `debounceMs`) whenever any match changes. */
function useMatchesChanged(source: Source, onChange: () => void, debounceMs: number): void {
  const latest = useRef(onChange)
  latest.current = onChange
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined
    const stop = source.watchMatches(() => {
      if (pending) return
      pending = setTimeout(() => {
        pending = undefined
        latest.current()
      }, debounceMs)
    })
    return () => {
      stop()
      if (pending) clearTimeout(pending)
    }
  }, [source, debounceMs])
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/** The source's calendar "now" (the recording's own time in the demo), refreshed every `everyMs`. */
export function useCalendarNow(source: Source, everyMs = 5000): number {
  const [now, setNow] = useState(() => source.calendarNow())
  useEffect(() => {
    setNow(source.calendarNow())
    const timer = setInterval(() => setNow(source.calendarNow()), everyMs)
    return () => clearInterval(timer)
  }, [source, everyMs])
  // A replay can jump (to the end, or back to the start): follow it at once.
  useMatchesChanged(source, () => setNow(source.calendarNow()), 150)
  return now
}

/** The source's "now", refreshed every `everyMs` while mounted. */
export function useNow(source: Source, everyMs = 1000): number {
  const [now, setNow] = useState(() => source.now())
  useEffect(() => {
    setNow(source.now())
    const timer = setInterval(() => setNow(source.now()), everyMs)
    return () => clearInterval(timer)
  }, [source, everyMs])
  return now
}

export function useClock(clock: ReplayClock | null): ClockState | null {
  const [state, setState] = useState<ClockState | null>(clock?.current ?? null)
  useEffect(() => {
    if (!clock) return
    setState(clock.current)
    let frame = 0
    // Clock ticks arrive five times a second; one render per animation frame is plenty.
    return clock.subscribe((next) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setState(next))
    })
  }, [clock])
  return state
}

export interface MatchesState {
  matches: MatchSummary[]
  loading: boolean
  error: Error | null
  live: LiveState
  reload: () => void
}

export function useMatches(source: Source, archived: ArchivedFilter): MatchesState {
  const [matches, setMatches] = useState<MatchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [live, setLive] = useState<LiveState>('connecting')
  const generation = useRef(0)

  const load = useCallback(() => {
    const mine = ++generation.current
    source
      .matches(archived)
      .then((list) => {
        if (mine !== generation.current) return
        setMatches(list)
        setError(null)
      })
      .catch((err: unknown) => {
        if (mine === generation.current) setError(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(() => {
        if (mine === generation.current) setLoading(false)
      })
  }, [source, archived])

  useEffect(() => {
    setLoading(true)
    load()
    let pending: ReturnType<typeof setTimeout> | undefined
    const stop = source.watchMatches(() => {
      // Several changes in one moment become one refetch.
      if (pending) return
      pending = setTimeout(() => {
        pending = undefined
        load()
      }, 250)
    }, setLive)
    return () => {
      stop()
      if (pending) clearTimeout(pending)
    }
  }, [source, load])

  return { matches, loading, error, live, reload: load }
}

export interface MatchState {
  detail: MatchDetail | null
  events: EventRow[]
  reports: MatchReportRow[]
  reviews: OfficialReviewRow[]
  processes: ProcessRow[]
  loading: boolean
  notFound: boolean
  /** The replay has not reached this match yet. */
  waiting: boolean
  error: Error | null
  live: LiveState
}

const EMPTY: MatchState = {
  detail: null,
  events: [],
  reports: [],
  reviews: [],
  processes: [],
  loading: true,
  notFound: false,
  waiting: false,
  error: null,
  live: 'connecting',
}

/** Events that mean a side table (reports, reviews, processes) gained a row. */
const SIDE_TABLE_EVENTS = new Set([
  'gear_check_pass',
  'gear_check_fail',
  'trade',
  'raider_start',
  'raider_end',
  'objective_end',
  'error',
])

export function useMatch(source: Source, id: string): MatchState {
  const [state, setState] = useState<MatchState>(EMPTY)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    let cancelled = false
    let stop: (() => void) | undefined
    let sideTimer: ReturnType<typeof setTimeout> | undefined
    let cursor = 0
    setState(EMPTY)

    const refreshSide = () => {
      if (sideTimer) return
      sideTimer = setTimeout(() => {
        sideTimer = undefined
        Promise.all([source.reports(id), source.reviews(id), source.processes(id)])
          .then(([reports, reviews, processes]) => {
            if (!cancelled) setState((s) => ({ ...s, reports, reviews, processes }))
          })
          .catch(() => undefined)
      }, 300)
    }

    const load = async () => {
      try {
        const detail = await source.match(id)
        if (cancelled) return
        if (!detail) {
          if (source.kind === 'demo') {
            // In a replay the match may simply not have kicked off yet: wait for it.
            setState({ ...EMPTY, loading: false, waiting: true, live: 'replay' })
            stop = source.watchMatch(id, 0, {
              onEvents: () => undefined,
              onMatch: () => setEpoch((n) => n + 1),
              onReset: () => undefined,
            })
            return
          }
          setState({ ...EMPTY, loading: false, notFound: true })
          return
        }
        const events: EventRow[] = []
        for (;;) {
          const page = await source.events(id, cursor, 1000)
          events.push(...page.events)
          cursor = Math.max(cursor, page.cursor)
          if (!page.has_more || cancelled) break
        }
        const [reports, reviews, processes] = await Promise.all([
          source.reports(id),
          source.reviews(id),
          source.processes(id),
        ])
        if (cancelled) return
        setState((s) => ({ ...s, detail, events, reports, reviews, processes, loading: false, error: null }))
        stop = source.watchMatch(id, cursor, {
          onEvents: (fresh) => {
            const newer = fresh.filter((e) => e.cursor > cursor)
            const last = newer[newer.length - 1]
            if (!last) return
            cursor = last.cursor
            setState((s) => ({ ...s, events: [...s.events, ...newer] }))
            if (newer.some((e) => e.type && SIDE_TABLE_EVENTS.has(e.type))) refreshSide()
          },
          onMatch: (next) => {
            setState((s) => ({ ...s, detail: next }))
            refreshSide()
          },
          onReset: () => setEpoch((n) => n + 1),
          onState: (live) => setState((s) => ({ ...s, live })),
        })
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err : new Error(String(err)) }))
        }
      }
    }
    void load()
    return () => {
      cancelled = true
      stop?.()
      if (sideTimer) clearTimeout(sideTimer)
    }
  }, [source, id, epoch])

  return state
}

export interface FactsState {
  facts: ReportFacts | null
  loading: boolean
  error: Error | null
}

/**
 * The facts for matches that started in [since, until), fetched again
 * whenever a match changes so a day in progress keeps counting.
 */
export function useReportFacts(source: Source, since: string | null, until: string | null): FactsState {
  const [state, setState] = useState<FactsState>({ facts: null, loading: true, error: null })
  const generation = useRef(0)

  const load = useCallback(() => {
    if (!since || !until) return
    const mine = ++generation.current
    source
      .reportFacts(since, until)
      .then((facts) => {
        if (mine === generation.current) setState({ facts, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (mine === generation.current) setState((s) => ({ ...s, loading: false, error: asError(err) }))
      })
  }, [source, since, until])

  useEffect(() => {
    setState((s) => ({ facts: s.facts, loading: true, error: null }))
    load()
  }, [load])
  useMatchesChanged(source, load, 700)

  return state
}

/** How often Upcoming Matches and requests are asked for again with nothing else to go on. */
export const PLANNED_REFRESH_MS = 20_000

export interface PlannedState {
  upcoming: UpcomingMatchRow[]
  requests: RequestRow[]
  loading: boolean
  upcomingError: Error | null
  requestsError: Error | null
  reload: () => void
}

/** Upcoming Matches and the requests, fresh when a match changes and every 20 s besides. */
export function usePlanned(source: Source, withRequests = true): PlannedState {
  const [upcoming, setUpcoming] = useState<UpcomingMatchRow[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [upcomingError, setUpcomingError] = useState<Error | null>(null)
  const [requestsError, setRequestsError] = useState<Error | null>(null)
  const generation = useRef(0)

  const load = useCallback(() => {
    const mine = ++generation.current
    const tickets = source.upcoming().then(
      (rows) => {
        if (mine !== generation.current) return
        setUpcoming(rows)
        setUpcomingError(null)
      },
      (err: unknown) => {
        if (mine === generation.current) setUpcomingError(asError(err))
      },
    )
    const asked = withRequests
      ? source.requests(50).then(
          (rows) => {
            if (mine !== generation.current) return
            setRequests(rows)
            setRequestsError(null)
          },
          (err: unknown) => {
            if (mine === generation.current) setRequestsError(asError(err))
          },
        )
      : Promise.resolve()
    void Promise.all([tickets, asked]).finally(() => {
      if (mine === generation.current) setLoading(false)
    })
  }, [source, withRequests])

  useEffect(() => {
    setLoading(true)
    load()
    const timer = setInterval(load, PLANNED_REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])
  useMatchesChanged(source, load, 400)

  return { upcoming, requests, loading, upcomingError, requestsError, reload: load }
}
