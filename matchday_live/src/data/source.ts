/**
 * One interface over the three places the page can read from: the demo
 * recording, this deployment's API (the cloud store on Vercel, or a Mac's
 * own file when `ogsf var` serves the page), or a fleet at another address.
 * Every page talks only to this.
 */
import type {
  EventRow,
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

export type SourceKind = 'demo' | 'here' | 'fleet'

/** Where the page reads from. Saved in localStorage; never holds a secret. */
export type SourceChoice = { kind: 'demo' } | { kind: 'here' } | { kind: 'fleet'; url: string }

export type ArchivedFilter = '0' | '1' | 'all'

/** How the live connection is doing. */
export type LiveState = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'replay'

export interface MatchHandlers {
  onEvents(events: EventRow[], cursor: number): void
  onMatch(detail: MatchDetail): void
  /** Everything shown so far is no longer true (a replay restarted): load again. */
  onReset(): void
  onState?(state: LiveState): void
}

export interface Source {
  readonly kind: SourceKind
  /** Short name for the top bar. */
  readonly label: string
  /** "Now" in the source's time frame: the wall clock, or the replay's clock. */
  now(): number
  /**
   * "Now" on the calendar the reports and Upcoming Matches are kept in. The
   * wall clock for a real API; for the demo, the moment the recording has
   * reached in its own original timestamps (the replay squeezes every match
   * into today, but its days and due times keep their real dates).
   */
  calendarNow(): number
  health(): Promise<HealthResponse>
  matches(archived: ArchivedFilter): Promise<MatchSummary[]>
  match(id: string): Promise<MatchDetail | null>
  events(id: string, after: number, limit?: number): Promise<EventsPage>
  reports(id: string): Promise<MatchReportRow[]>
  reviews(id: string): Promise<OfficialReviewRow[]>
  processes(id: string): Promise<ProcessRow[]>
  teamTalks(id: string, player: string): Promise<TeamTalks>
  archive(id: string, archived: boolean): Promise<void>
  /** Version 2. The rows every report is computed from, for matches that started in [since, until). */
  reportFacts(since: string, until: string): Promise<ReportFacts>
  /** Version 2. The planned tickets, by due time. */
  upcoming(): Promise<UpcomingMatchRow[]>
  /** Version 2. "Run this now" requests, newest first. */
  requests(limit?: number): Promise<RequestRow[]>
  /** Version 2. Queue a request; the Mac that accepts it claims it. */
  createRequest(request: NewRequest): Promise<RequestRow>
  /** Version 2. Cancel a request that is still queued. */
  cancelRequest(id: string): Promise<RequestRow>
  /** Call `onChange` whenever any match changes. Returns a stop function. */
  watchMatches(onChange: () => void, onState?: (state: LiveState) => void): () => void
  /** Stream one match from `after`. Returns a stop function. */
  watchMatch(id: string, after: number, handlers: MatchHandlers): () => void
  /** Stop timers and streams. */
  close(): void
}

/**
 * A version 2 route the server does not have (404 on /api/upcoming and the
 * like): its `ogsf` or deployment is older than this page.
 */
export function isMissingRoute(error: unknown): boolean {
  return error instanceof ApiFailure && (error.status === 404 || error.status === 405 || error.status === 501)
}

/** An API answer that was not a success; `status` 401 means "sign in". */
export class ApiFailure extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const STORAGE_KEY = 'matchday.source'

/**
 * A link can ask for the demo: `https://<app>/?demo` (or `?source=demo`)
 * opens the recording whatever this browser saved, so a demo link can be
 * shared. It is not saved: the next visit without it reads as before.
 */
export function linkedChoice(search: string): SourceChoice | null {
  const params = new URLSearchParams(search)
  return params.has('demo') || params.get('source') === 'demo' ? { kind: 'demo' } : null
}

export function loadChoice(): SourceChoice | null {
  const linked = typeof window === 'undefined' ? null : linkedChoice(window.location.search)
  if (linked) return linked
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SourceChoice> & { url?: unknown }
    if (parsed.kind === 'demo' || parsed.kind === 'here') return { kind: parsed.kind }
    if (parsed.kind === 'fleet' && typeof parsed.url === 'string') return { kind: 'fleet', url: parsed.url }
  } catch {
    // Storage can be blocked (private windows); the page then asks the server.
  }
  return null
}

export function saveChoice(choice: SourceChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice))
  } catch {
    // Not remembered, but still used for this visit.
  }
}

/** A fleet address, cleaned: http(s) only, no trailing slash, /api appended once. */
export function fleetApiBase(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const path = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${path.endsWith('/api') ? path : `${path}/api`}`
}
