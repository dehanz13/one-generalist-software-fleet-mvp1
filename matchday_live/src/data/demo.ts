/**
 * The demo source: a recording played back in the browser through the same
 * interface as a real API, so every page behaves exactly as it does live.
 * Nothing leaves the browser; the recording is a static file.
 */
import { factsFromMatches } from '../../shared/report-facts'
import type {
  ConnectorGrant,
  ConnectorStatus,
  DemoDataset,
  DemoMatch,
  EventsPage,
  HealthResponse,
  MatchDetail,
  MatchReportRow,
  MatchSummary,
  OfficialReviewRow,
  ProcessRow,
  ReportFacts,
  RequestRow,
  TeamTalks,
  UpcomingMatchRow,
} from '../../shared/types'
import { type MatchPhase, phaseOf, requestAt, upcomingAt } from './planned'
import {
  buildSchedule,
  detailOf,
  fingerprint,
  type MatchSnapshot,
  ms,
  type Schedule,
  snapshot,
  suggestSpeed,
  summaryOf,
} from './replay'
import { ApiFailure, type ArchivedFilter, type LiveState, type MatchHandlers, type Source } from './source'

/** What the demo says when asked to start or cancel work. */
export const DEMO_READ_ONLY = 'The demo recording only plays back: connect a fleet to run or cancel matches.'

/** The speeds the demo bar offers. Infinity is "jump to the end". */
export const SPEEDS = [1, 10, 60, 300] as const
export const INSTANT = Number.POSITIVE_INFINITY

export interface ClockState {
  virtualMs: number
  totalMs: number
  speed: number
  playing: boolean
  finished: boolean
}

/** The replay's clock: plays, pauses, changes speed, restarts. */
export class ReplayClock {
  private state: ClockState
  private anchor: number
  private timer: ReturnType<typeof setInterval> | undefined
  private lastReal = 0
  private readonly listeners = new Set<(state: ClockState, restarted: boolean) => void>()
  private readonly realNow: () => number

  constructor(totalMs: number, speed: number, realNow: () => number = () => Date.now()) {
    this.realNow = realNow
    this.anchor = realNow()
    this.state = { virtualMs: 0, totalMs, speed, playing: false, finished: totalMs === 0 }
  }

  get current(): ClockState {
    return this.state
  }

  /** The display-frame "now": the anchor plus the virtual time played. */
  now(): number {
    return this.anchor + this.state.virtualMs
  }

  get anchorMs(): number {
    return this.anchor
  }

  subscribe(listener: (state: ClockState, restarted: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(restarted = false) {
    for (const listener of [...this.listeners]) listener(this.state, restarted)
  }

  private set(patch: Partial<ClockState>, restarted = false) {
    const next = { ...this.state, ...patch }
    next.virtualMs = Math.min(Math.max(next.virtualMs, 0), next.totalMs)
    next.finished = next.virtualMs >= next.totalMs
    this.state = next
    this.emit(restarted)
  }

  /** Advance by `realMs` of wall-clock time at the current speed. */
  advance(realMs: number): void {
    if (!this.state.playing || this.state.finished) return
    this.set({ virtualMs: this.state.virtualMs + realMs * this.state.speed })
  }

  play(): void {
    if (this.state.finished) return
    this.set({ playing: true })
    this.startTimer()
  }

  pause(): void {
    this.set({ playing: false })
    this.stopTimer()
  }

  setSpeed(speed: number): void {
    if (speed === INSTANT) {
      this.set({ virtualMs: this.state.totalMs })
      this.stopTimer()
      return
    }
    this.set({ speed })
  }

  restart(): void {
    this.stopTimer()
    this.anchor = this.realNow()
    this.set({ virtualMs: 0, playing: true }, true)
    this.startTimer()
  }

  /** Jump to a virtual time (0..total), keeping the play state. */
  seek(virtualMs: number): void {
    const restarted = virtualMs < this.state.virtualMs
    if (restarted) this.anchor = this.realNow() - virtualMs
    this.set({ virtualMs }, restarted)
  }

  private startTimer() {
    if (this.timer || typeof setInterval === 'undefined') return
    this.lastReal = this.realNow()
    this.timer = setInterval(() => {
      const now = this.realNow()
      const dt = now - this.lastReal
      this.lastReal = now
      this.advance(dt)
      if (this.state.finished) this.stopTimer()
    }, 200)
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  dispose(): void {
    this.stopTimer()
    this.listeners.clear()
  }
}

export class DemoSource implements Source {
  readonly kind = 'demo' as const
  readonly label = 'Demo recording'
  readonly clock: ReplayClock
  readonly schedule: Schedule
  readonly dataset: DemoDataset
  private readonly archived = new Set<string>()
  private readonly stops = new Set<() => void>()

  constructor(dataset: DemoDataset, options: { speed?: number; realNow?: () => number } = {}) {
    this.dataset = dataset
    this.schedule = buildSchedule(dataset)
    const speed = options.speed ?? suggestSpeed(this.schedule, [...SPEEDS])
    this.clock = new ReplayClock(this.schedule.totalMs, speed, options.realNow)
  }

  now(): number {
    return this.clock.now()
  }

  /**
   * The recording's own "now": how far into its original timeline the replay
   * has got. It runs with each match and, in the short gap the replay leaves
   * between two matches, sweeps across the idle time the recording skipped,
   * so a ticket falls due and a request is queued before its match kicks off.
   * At the end it is the moment the recording was made.
   */
  calendarNow(): number {
    const { virtualMs } = this.clock.current
    const items = this.schedule.matches
    const first = items[0]
    if (!first) return this.clock.anchorMs
    if (virtualMs < first.offsetMs) return first.t0 - (first.offsetMs - virtualMs)
    for (let i = 0; i < items.length && virtualMs < this.schedule.totalMs; i++) {
      const item = items[i]!
      const end = item.offsetMs + item.durationMs
      if (virtualMs <= end) return item.t0 + (virtualMs - item.offsetMs)
      const next = items[i + 1]
      if (!next) break
      if (virtualMs < next.offsetMs) {
        const from = item.t0 + item.durationMs
        const to = Math.max(from, next.t0)
        return from + ((virtualMs - end) / (next.offsetMs - end)) * (to - from)
      }
    }
    // Past the last match: the moment the recording was made, so what was
    // asked for after the last final whistle shows too.
    const last = items[items.length - 1]!
    const lastEnd = last.t0 + last.durationMs
    const made = Date.parse(this.dataset.generated_at)
    return Number.isFinite(made) ? Math.max(lastEnd, made) : lastEnd
  }

  private phase(matchId: string | null | undefined): MatchPhase | null {
    if (!matchId) return null
    const item = this.schedule.matches.find((m) => m.data.match.match_id === matchId)
    return item ? phaseOf(item, this.clock.current.virtualMs) : null
  }

  private snapshots(): MatchSnapshot[] {
    const { virtualMs } = this.clock.current
    const out: MatchSnapshot[] = []
    for (const item of this.schedule.matches) {
      const snap = snapshot(item, virtualMs, this.clock.anchorMs)
      if (snap) out.push(snap)
    }
    return out
  }

  private find(id: string): MatchSnapshot | null {
    const item = this.schedule.matches.find((m) => m.data.match.match_id === id)
    if (!item) return null
    const snap = snapshot(item, this.clock.current.virtualMs, this.clock.anchorMs)
    if (!snap) return null
    snap.match = { ...snap.match, archived: this.archived.has(id) ? 1 : 0 }
    return snap
  }

  async health(): Promise<HealthResponse> {
    return { ok: true, source: 'local', matches: this.dataset.matches.length, store: 'demo recording' }
  }

  async matches(archived: ArchivedFilter): Promise<MatchSummary[]> {
    return this.snapshots()
      .map((snap) => summaryOf({ ...snap, match: { ...snap.match, archived: this.archived.has(snap.match.match_id) ? 1 : 0 } }))
      .filter((m) => archived === 'all' || (archived === '1' ? m.archived === 1 : m.archived !== 1))
      .sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))
  }

  async match(id: string): Promise<MatchDetail | null> {
    const snap = this.find(id)
    return snap ? detailOf(snap) : null
  }

  async events(id: string, after: number, limit = 1000): Promise<EventsPage> {
    const snap = this.find(id)
    const events = (snap?.events ?? []).filter((e) => e.cursor > after).slice(0, limit)
    const last = events[events.length - 1]
    return { events, cursor: last ? last.cursor : after, has_more: events.length === limit }
  }

  async reports(id: string): Promise<MatchReportRow[]> {
    return this.find(id)?.reports ?? []
  }

  async reviews(id: string): Promise<OfficialReviewRow[]> {
    return this.find(id)?.reviews ?? []
  }

  async processes(id: string): Promise<ProcessRow[]> {
    return this.find(id)?.processes ?? []
  }

  async teamTalks(id: string, player: string): Promise<TeamTalks> {
    const talk = this.find(id)?.teamTalks.find((t) => t.player === player)
    return { system: talk?.system ?? null, user: talk?.user ?? null }
  }

  async archive(id: string, archived: boolean): Promise<void> {
    if (archived) this.archived.add(id)
    else this.archived.delete(id)
    this.pokeLists()
  }

  /** Every match the replay has reached, in its original timestamps; one still playing is cut where the replay is. */
  async reportFacts(since: string, until: string): Promise<ReportFacts> {
    const { virtualMs } = this.clock.current
    const shown: DemoMatch[] = []
    for (const item of this.schedule.matches) {
      // An anchor of t0 - offset shifts by nothing: the recording's own clock.
      const snap = snapshot(item, virtualMs, item.t0 - item.offsetMs)
      if (!snap) continue
      shown.push({
        match: snap.match,
        objectives: snap.objectives,
        players: snap.players,
        events: snap.events,
        reports: snap.reports,
        reviews: snap.reviews,
        processes: snap.processes,
        team_talks: snap.teamTalks,
      })
    }
    return factsFromMatches(shown, since, until)
  }

  async upcoming(): Promise<UpcomingMatchRow[]> {
    const now = this.calendarNow()
    const byTicket = new Map<string, string>()
    for (const m of this.dataset.matches) if (m.match.ticket_id) byTicket.set(m.match.ticket_id, m.match.match_id)
    return (this.dataset.upcoming ?? [])
      .map((row) => upcomingAt(row, this.phase(row.match_id ?? byTicket.get(row.ticket_id)), now))
      .sort((a, b) => (ms(a.due_at) || 0) - (ms(b.due_at) || 0) || a.ticket_id.localeCompare(b.ticket_id))
  }

  async requests(limit = 50): Promise<RequestRow[]> {
    const now = this.calendarNow()
    return (this.dataset.requests ?? [])
      .map((row) => requestAt(row, this.phase(row.match_id), now))
      .filter((row): row is RequestRow => row !== null)
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .slice(0, limit)
  }

  /**
   * What the Connections page shows for the Claude connector in the demo: an
   * example of a ready connector with one connection from the Claude app.
   * Nothing in it is live.
   */
  connector(): { status: ConnectorStatus; grants: ConnectorGrant[] } {
    const made = Date.parse(this.dataset.generated_at)
    const at = (offsetMs: number) => new Date((Number.isFinite(made) ? made : this.clock.anchorMs) + offsetMs).toISOString()
    const day = 86_400_000
    return {
      status: { url: 'https://matchday.example/api/mcp', ready: true, reason: null, connections: 1 },
      grants: [
        {
          grant_id: 'grant_demo_claude',
          client_id: 'client_demo_claude',
          client_name: 'Claude',
          redirect_hosts: ['claude.ai'],
          created_at: at(-3 * day),
          last_used_at: at(-2 * 3_600_000),
          expires_at: at(27 * day),
        },
      ],
    }
  }

  async createRequest(): Promise<RequestRow> {
    throw new ApiFailure(403, DEMO_READ_ONLY)
  }

  async cancelRequest(): Promise<RequestRow> {
    throw new ApiFailure(403, DEMO_READ_ONLY)
  }

  private readonly listWatchers = new Set<() => void>()

  /** Archiving changes the list without the clock moving: tell the list watchers now. */
  private pokeLists() {
    for (const watcher of this.listWatchers) watcher()
  }

  watchMatches(onChange: () => void, onState?: (state: LiveState) => void): () => void {
    onState?.('replay')
    let last = ''
    const check = () => {
      const signature = this.snapshots()
        .map((s) => `${s.match.match_id}:${s.match.status}:${s.objectives.length}:${s.match.total_tokens}`)
        .join('|')
      if (signature !== last) {
        last = signature
        onChange()
      }
    }
    const poke = () => {
      last = ''
      check()
    }
    this.listWatchers.add(poke)
    const unsubscribe = this.clock.subscribe((_, restarted) => {
      if (restarted) last = ''
      check()
    })
    const stop = () => {
      unsubscribe()
      this.listWatchers.delete(poke)
      this.stops.delete(stop)
    }
    this.stops.add(stop)
    return stop
  }

  watchMatch(id: string, after: number, handlers: MatchHandlers): () => void {
    handlers.onState?.('replay')
    let cursor = after
    let lastPrint = ''
    const check = (restarted: boolean) => {
      if (restarted) {
        cursor = 0
        lastPrint = ''
        handlers.onReset()
        return
      }
      const snap = this.find(id)
      if (!snap) return
      const fresh = snap.events.filter((e) => e.cursor > cursor)
      const last = fresh[fresh.length - 1]
      if (last) {
        cursor = last.cursor
        handlers.onEvents(fresh, cursor)
      }
      const print = fingerprint(snap)
      if (print !== lastPrint) {
        lastPrint = print
        handlers.onMatch(detailOf(snap))
      }
    }
    const unsubscribe = this.clock.subscribe((_, restarted) => check(restarted))
    const stop = () => {
      unsubscribe()
      this.stops.delete(stop)
    }
    this.stops.add(stop)
    return stop
  }

  close(): void {
    for (const stop of [...this.stops]) stop()
    this.clock.dispose()
  }
}

/** Load the bundled recording. */
export async function loadDemoDataset(url = `${import.meta.env.BASE_URL}demo/matchday-demo.json`): Promise<DemoDataset> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The demo recording did not load (${response.status}).`)
  const data = (await response.json()) as DemoDataset
  if ((data.version !== 1 && data.version !== 2) || !Array.isArray(data.matches)) {
    throw new Error('The demo recording is not in a format this page reads.')
  }
  return data
}
