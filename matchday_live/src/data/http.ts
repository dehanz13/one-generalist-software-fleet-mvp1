/**
 * The source for a real API: this deployment's (same origin, signed-in
 * cookie) or a fleet at another address (`ogsf var` on a Mac, no cookie).
 * Live updates come over server-sent events; only if those cannot connect
 * does it fall back to asking every few seconds.
 */
import type {
  EventsPage,
  HealthResponse,
  MatchDetail,
  MatchReportRow,
  MatchSummary,
  NewRequest,
  OfficialReviewRow,
  ProcessRow,
  ReportFacts,
  RequestRow,
  TeamTalks,
  UpcomingMatchRow,
} from '../../shared/types'
import { ApiFailure, type ArchivedFilter, type LiveState, type MatchHandlers, type Source, type SourceKind } from './source'

const POLL_FALLBACK_MS = 3000
/** Consecutive stream failures before giving up on streaming for this view. */
const STREAM_FAILURES_BEFORE_POLLING = 4

export class HttpSource implements Source {
  readonly kind: SourceKind
  readonly label: string
  private readonly base: string
  private readonly credentials: RequestCredentials
  private readonly stops = new Set<() => void>()

  constructor(base: string, kind: SourceKind, label: string) {
    this.base = base.replace(/\/+$/, '')
    this.kind = kind
    this.label = label
    this.credentials = kind === 'here' ? 'same-origin' : 'omit'
  }

  now(): number {
    return Date.now()
  }

  calendarNow(): number {
    return Date.now()
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.base}${path}`, {
        ...init,
        credentials: this.credentials,
        headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
      })
    } catch {
      throw new ApiFailure(0, `Could not reach ${this.base}. Check that the fleet is running and the address is right.`)
    }
    if (!response.ok) {
      let message = `${init.method ?? 'GET'} ${path} answered ${response.status}`
      try {
        const body = (await response.json()) as { error?: unknown }
        if (typeof body.error === 'string') message = body.error
      } catch {
        // Not JSON: keep the status line.
      }
      throw new ApiFailure(response.status, message)
    }
    try {
      return (await response.json()) as T
    } catch {
      // An older server can answer an unknown route with the page itself.
      throw new ApiFailure(404, `${path} is not on this server: it answered with a page, not data.`)
    }
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health')
  }

  async matches(archived: ArchivedFilter): Promise<MatchSummary[]> {
    return this.request<MatchSummary[]>(`/matches?limit=200&archived=${archived}`)
  }

  async match(id: string): Promise<MatchDetail | null> {
    try {
      return await this.request<MatchDetail>(`/matches/${encodeURIComponent(id)}`)
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) return null
      throw error
    }
  }

  events(id: string, after: number, limit = 1000): Promise<EventsPage> {
    return this.request<EventsPage>(`/matches/${encodeURIComponent(id)}/events?after=${after}&limit=${limit}`)
  }

  reports(id: string): Promise<MatchReportRow[]> {
    return this.request<MatchReportRow[]>(`/matches/${encodeURIComponent(id)}/reports`)
  }

  reviews(id: string): Promise<OfficialReviewRow[]> {
    return this.request<OfficialReviewRow[]>(`/matches/${encodeURIComponent(id)}/reviews`)
  }

  processes(id: string): Promise<ProcessRow[]> {
    return this.request<ProcessRow[]>(`/matches/${encodeURIComponent(id)}/processes`)
  }

  async teamTalks(id: string, player: string): Promise<TeamTalks> {
    try {
      return await this.request<TeamTalks>(
        `/matches/${encodeURIComponent(id)}/players/${encodeURIComponent(player)}/team-talks`,
      )
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) return { system: null, user: null }
      throw error
    }
  }

  async archive(id: string, archived: boolean): Promise<void> {
    await this.request(`/matches/${encodeURIComponent(id)}/archive`, {
      method: 'POST',
      body: JSON.stringify({ archived }),
    })
  }

  reportFacts(since: string, until: string): Promise<ReportFacts> {
    return this.request<ReportFacts>(`/report-facts?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`)
  }

  upcoming(): Promise<UpcomingMatchRow[]> {
    return this.request<UpcomingMatchRow[]>('/upcoming')
  }

  requests(limit = 50): Promise<RequestRow[]> {
    return this.request<RequestRow[]>(`/requests?limit=${limit}`)
  }

  createRequest(request: NewRequest): Promise<RequestRow> {
    return this.request<RequestRow>('/requests', { method: 'POST', body: JSON.stringify(request) })
  }

  cancelRequest(id: string): Promise<RequestRow> {
    return this.request<RequestRow>(`/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
  }

  watchMatches(onChange: () => void, onState?: (state: LiveState) => void): () => void {
    return this.stream(
      `${this.base}/live`,
      { matches: () => onChange() },
      onState,
      () => onChange(),
    )
  }

  watchMatch(id: string, after: number, handlers: MatchHandlers): () => void {
    let cursor = after
    return this.stream(
      `${this.base}/live?match=${encodeURIComponent(id)}&after=${after}`,
      {
        events: (data) => {
          const page = data as { events?: EventsPage['events']; cursor?: number }
          const events = (page.events ?? []).filter((e) => e.cursor > cursor)
          if (typeof page.cursor === 'number') cursor = Math.max(cursor, page.cursor)
          if (events.length) handlers.onEvents(events, cursor)
        },
        match: (data) => handlers.onMatch(data as MatchDetail),
      },
      handlers.onState,
      async () => {
        // The polling fallback: what the stream would have sent.
        let page = await this.events(id, cursor, 1000)
        while (page.events.length) {
          cursor = Math.max(cursor, page.cursor)
          handlers.onEvents(page.events, cursor)
          if (!page.has_more) break
          page = await this.events(id, cursor, 1000)
        }
        const detail = await this.match(id)
        if (detail) handlers.onMatch(detail)
      },
    )
  }

  /**
   * Follow an SSE stream. EventSource reconnects on its own (resuming from
   * the last id); when it cannot get through at all, poll instead.
   */
  private stream(
    url: string,
    listeners: Record<string, (data: unknown) => void>,
    onState: ((state: LiveState) => void) | undefined,
    poll: () => void | Promise<void>,
  ): () => void {
    let source: EventSource | null = null
    let timer: ReturnType<typeof setInterval> | undefined
    let failures = 0
    let stopped = false

    const startPolling = () => {
      source?.close()
      source = null
      onState?.('polling')
      const run = () => {
        if (!stopped) Promise.resolve(poll()).catch(() => undefined)
      }
      run()
      timer = setInterval(run, POLL_FALLBACK_MS)
    }

    if (typeof EventSource === 'undefined') {
      startPolling()
    } else {
      onState?.('connecting')
      source = new EventSource(url, { withCredentials: this.kind === 'here' })
      source.onopen = () => {
        failures = 0
        onState?.('live')
      }
      source.onerror = () => {
        failures += 1
        if (stopped) return
        if (source?.readyState === EventSource.CLOSED || failures >= STREAM_FAILURES_BEFORE_POLLING) startPolling()
        else onState?.('reconnecting')
      }
      for (const [name, listener] of Object.entries(listeners)) {
        source.addEventListener(name, (message) => {
          try {
            listener(JSON.parse((message as MessageEvent<string>).data) as unknown)
          } catch {
            // A message that does not parse is skipped; the next one carries on.
          }
        })
      }
    }

    const stop = () => {
      stopped = true
      source?.close()
      if (timer) clearInterval(timer)
      this.stops.delete(stop)
    }
    this.stops.add(stop)
    return stop
  }

  close(): void {
    for (const stop of [...this.stops]) stop()
  }
}
