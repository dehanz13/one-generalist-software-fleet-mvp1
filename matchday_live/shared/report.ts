/**
 * Daily reports, the multi-day report and agent performance, computed from
 * `ReportFacts` (GET /api/report-facts). One module, so the page, the PDF and
 * Markdown downloads and the Claude connector all count the same way.
 *
 * Pure: no fetching, no clock except the one passed in. Days are calendar days
 * in a named time zone (the viewer's, normally), so a match that started at
 * 23:50 in Dallas belongs to that Dallas day wherever the server is.
 */
import type {
  MatchRow,
  ObjectiveRow,
  PlayerRow,
  RaiderEndPayload,
  ReportFacts,
  UsageBreakdown,
} from './types.js'

// ── time ─────────────────────────────────────────────────────────────────────

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>()

/** The calendar day (YYYY-MM-DD) an instant falls on in a time zone. */
export function dayKey(iso: string, timeZone: string): string {
  let format = dayFormatters.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    dayFormatters.set(timeZone, format)
  }
  return format.format(new Date(iso))
}

/** Minutes a zone is ahead of UTC at an instant (Dallas in October: -300). */
function zoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000)
}

/** The instant a local day starts, as ISO UTC with milliseconds and +00:00, the match log's own format. */
export function dayStart(date: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y!, m! - 1, d!)
  // Two passes settle the offset even when the guess lands across a DST change.
  let instant = guess - zoneOffsetMinutes(guess, timeZone) * 60000
  instant = guess - zoneOffsetMinutes(instant, timeZone) * 60000
  return toLogTime(instant)
}

/** The day after a YYYY-MM-DD date. */
export function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10)
}

/** [since, until) for local days from..to inclusive: what /api/report-facts takes. */
export function rangeBounds(from: string, to: string, timeZone: string): { since: string; until: string } {
  return { since: dayStart(from, timeZone), until: dayStart(nextDay(to), timeZone) }
}

/** An instant in the match log's text format: 2026-10-17T21:04:05.123+00:00. */
export function toLogTime(instant: number): string {
  return new Date(instant).toISOString().replace('Z', '+00:00')
}

function seconds(start: string | null, end: string | null): number {
  const a = parseTime(start)
  const b = parseTime(end)
  return a !== null && b !== null && b >= a ? (b - a) / 1000 : 0
}

// ── shapes ───────────────────────────────────────────────────────────────────

/** Token counts, in the club's own terms. `billed` re-counts cached context on every turn. */
export interface TokenTotals {
  billed: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** The thinking share of output, never added to it. */
  reasoning: number
  /** Raw material read the first time: input + cache writes. */
  read: number
  /** Generated: output. */
  written: number
}

export interface Totals {
  matches: number
  touchdowns: number
  turnovers: number
  running: number
  /** Turnovers the provider caused (no credits, a limit, an outage): not a verdict on the work. */
  abandoned: number
  cost: number
  tokens: TokenTotals
  /** Sum of match durations, seconds. */
  matchSeconds: number
  objectives: number
  objectiveTouchdowns: number
  /** Objectives spent in extra time: iterate_* and revise_*. */
  extraTime: number
  reviewsPassed: number
  reviewsFailed: number
  /** Replies that did not parse as the report asked for, each one corrected in the same session. */
  invalidReplies: number
  /** A player wrote where it was not allowed; rolled back. */
  breaches: number
  /** Every objective passed but the set piece's own test did not. */
  notAccepted: number
  qaChecks: number
  qaFailed: number
}

/** One player (an agent role) over the period. */
export interface AgentPerformance {
  player: string
  models: string[]
  clubs: string[]
  matches: number
  objectives: number
  touchdowns: number
  turnovers: number
  /** touchdowns / objectives, 0..1 */
  successRate: number
  /** Objectives that passed with no corrected reply and every review green on the first attempt, 0..1 of objectives. */
  firstTryRate: number
  reviewFailures: number
  invalidReplies: number
  breaches: number
  /** Objectives it played in extra time (iterate_*, revise_*). */
  extraTime: number
  cost: number
  costPerObjective: number
  tokens: TokenTotals
  /** cache reads / (input + cache reads + cache writes), 0..1: how much of its context was served from cache. */
  cacheShare: number
  seconds: number
  avgSeconds: number
  /** The fullest its context window got: context_tokens / context_window, 0..1, or null when unknown. */
  peakContext: number | null
}

export interface ModelUse {
  model: string
  club: string | null
  players: string[]
  objectives: number
  cost: number
  billedTokens: number
}

export interface SetPieceUse {
  setPiece: string
  matches: number
  touchdowns: number
  turnovers: number
  cost: number
  avgSeconds: number
  avgCost: number
}

export interface MatchLine {
  match_id: string
  setPiece: string
  ask: string
  status: string
  /** touchdown | turnover | running | abandoned */
  outcome: string
  /** Why a turnover happened: the failed objective and its error, or the reason not accepted. */
  reason: string | null
  started_at: string | null
  ended_at: string | null
  seconds: number
  cost: number
  billedTokens: number
  founder: string | null
  machine: string | null
  ticket_id: string | null
  players: string[]
  models: string[]
}

/** Something a reader should look at. */
export interface Notable {
  match_id: string
  kind: 'turnover' | 'abandoned' | 'breach' | 'not_accepted' | 'extra_time'
  text: string
  at: string | null
}

export interface DayReport {
  /** YYYY-MM-DD in the report's time zone. */
  date: string
  /** First match start and last match end that day. */
  first: string | null
  last: string | null
  totals: Totals
  matches: MatchLine[]
  models: ModelUse[]
  setPieces: SetPieceUse[]
  agents: AgentPerformance[]
  notable: Notable[]
  /** A plain paragraph saying what the day was. */
  summary: string
}

export interface RangeReport {
  since: string
  until: string
  timeZone: string
  /** First and last day that had a match. */
  from: string | null
  to: string | null
  generatedAt: string
  days: DayReport[]
  totals: Totals
  agents: AgentPerformance[]
  models: ModelUse[]
  setPieces: SetPieceUse[]
  notable: Notable[]
  summary: string
}

// ── building blocks ──────────────────────────────────────────────────────────

function emptyTokens(): TokenTotals {
  return { billed: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, read: 0, written: 0 }
}

function addUsage(t: TokenTotals, usage: UsageBreakdown | undefined, billed: number): void {
  t.billed += billed
  if (!usage) return
  t.input += usage.input_tokens ?? 0
  t.output += usage.output_tokens ?? 0
  t.cacheRead += usage.cache_read_tokens ?? 0
  t.cacheWrite += usage.cache_write_tokens ?? 0
  t.reasoning += usage.reasoning_tokens ?? 0
  t.read += (usage.input_tokens ?? 0) + (usage.cache_write_tokens ?? 0)
  t.written += usage.output_tokens ?? 0
}

function emptyTotals(): Totals {
  return {
    matches: 0,
    touchdowns: 0,
    turnovers: 0,
    running: 0,
    abandoned: 0,
    cost: 0,
    tokens: emptyTokens(),
    matchSeconds: 0,
    objectives: 0,
    objectiveTouchdowns: 0,
    extraTime: 0,
    reviewsPassed: 0,
    reviewsFailed: 0,
    invalidReplies: 0,
    breaches: 0,
    notAccepted: 0,
    qaChecks: 0,
    qaFailed: 0,
  }
}

function parsePayload<T>(json: string | null): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

const isExtraTime = (name: string | null) => /^(iterate|revise)_\d+$/.test(name ?? '')

/** A provider stop reads "provider error" in the failed objective's error. */
const isAbandonError = (text: string | null | undefined) => /provider error/i.test(text ?? '')

function uniq(items: Iterable<string | null | undefined>): string[] {
  return [...new Set([...items].filter((x): x is string => Boolean(x)))].sort()
}

function round(n: number, places = 6): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/** Everything about one match the aggregates need, indexed once. */
interface MatchFacts {
  match: MatchRow
  objectives: ObjectiveRow[]
  players: PlayerRow[]
  spends: Array<{ objective_id: string | null; player: string; cost: number; billed: number; usage?: UsageBreakdown; context: number | null }>
  reviewsByObjective: Map<string, Array<{ passed: boolean; attempt: number }>>
  invalidByObjective: Map<string, number>
  breachesByPlayer: Map<string, number>
  notAccepted: string | null
  qa: Array<{ passed: boolean }>
}

function index(facts: ReportFacts): Map<string, MatchFacts> {
  const byMatch = new Map<string, MatchFacts>()
  for (const match of facts.matches) {
    byMatch.set(match.match_id, {
      match,
      objectives: [],
      players: [],
      spends: [],
      reviewsByObjective: new Map(),
      invalidByObjective: new Map(),
      breachesByPlayer: new Map(),
      notAccepted: null,
      qa: [],
    })
  }
  for (const o of facts.objectives) byMatch.get(o.match_id)?.objectives.push(o)
  for (const p of facts.players) byMatch.get(p.match_id)?.players.push(p)
  for (const r of facts.raider_ends) {
    const m = byMatch.get(r.match_id)
    if (!m || !r.player) continue
    const payload = parsePayload<RaiderEndPayload>(r.payload_json) ?? {}
    const context =
      payload.context_tokens && payload.context_window ? payload.context_tokens / payload.context_window : null
    m.spends.push({
      objective_id: r.objective_id,
      player: r.player,
      cost: payload.cost ?? payload.usage?.total_cost ?? 0,
      billed: r.tokens ?? payload.usage?.total_tokens ?? 0,
      usage: payload.usage,
      context,
    })
  }
  for (const v of facts.reviews) {
    const m = byMatch.get(v.match_id)
    if (!m || !v.objective_id) continue
    const list = m.reviewsByObjective.get(v.objective_id) ?? []
    list.push({ passed: v.passed === 1, attempt: v.attempt ?? 1 })
    m.reviewsByObjective.set(v.objective_id, list)
  }
  for (const r of facts.reports) {
    const m = byMatch.get(r.match_id)
    if (!m || !r.objective_id || r.valid !== 0) continue
    m.invalidByObjective.set(r.objective_id, (m.invalidByObjective.get(r.objective_id) ?? 0) + 1)
  }
  for (const e of facts.errors) {
    const m = byMatch.get(e.match_id)
    if (!m) continue
    if (e.name === 'permission_breach') {
      const payload = parsePayload<{ player?: string }>(e.payload_json)
      const player = payload?.player ?? 'unknown'
      m.breachesByPlayer.set(player, (m.breachesByPlayer.get(player) ?? 0) + 1)
    } else if (e.name === 'not_accepted') {
      m.notAccepted = parsePayload<{ reason?: string }>(e.payload_json)?.reason ?? 'not accepted'
    }
  }
  for (const q of facts.qa_casts) {
    const m = byMatch.get(q.match_id)
    if (!m) continue
    const payload = parsePayload<{ passed?: boolean }>(q.payload_json)
    m.qa.push({ passed: payload?.passed === true })
  }
  for (const m of byMatch.values()) m.objectives.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  return byMatch
}

function outcomeOf(m: MatchFacts): { outcome: string; reason: string | null } {
  const status = m.match.status ?? 'running'
  if (status === 'running') return { outcome: 'running', reason: null }
  if (status === 'touchdown') return { outcome: 'touchdown', reason: null }
  const failed = m.objectives.find((o) => o.status === 'turnover')
  if (failed && isAbandonError(failed.error)) {
    return { outcome: 'abandoned', reason: `${failed.name}: ${firstLine(failed.error)}` }
  }
  if (failed) return { outcome: 'turnover', reason: `${failed.name}: ${firstLine(failed.error)}` }
  if (m.notAccepted) return { outcome: 'turnover', reason: m.notAccepted }
  return { outcome: 'turnover', reason: null }
}

function firstLine(text: string | null): string {
  return (text ?? '').split('\n')[0]!.slice(0, 200)
}

function lineOf(m: MatchFacts): MatchLine {
  const { outcome, reason } = outcomeOf(m)
  const billed = m.spends.reduce((n, s) => n + s.billed, 0)
  return {
    match_id: m.match.match_id,
    setPiece: m.match.setpiece_name ?? '(unknown)',
    ask: (m.match.ask ?? '').replace(/\s+/g, ' ').trim(),
    status: m.match.status ?? 'running',
    outcome,
    reason,
    started_at: m.match.started_at,
    ended_at: m.match.ended_at,
    seconds: seconds(m.match.started_at, m.match.ended_at),
    cost: round(m.match.total_cost ?? m.spends.reduce((n, s) => n + s.cost, 0)),
    billedTokens: m.match.total_tokens ?? billed,
    founder: m.match.founder,
    machine: m.match.machine,
    ticket_id: m.match.ticket_id ?? null,
    players: uniq(m.players.map((p) => p.player)),
    models: uniq(m.players.map((p) => p.model)),
  }
}

function accumulate(list: MatchFacts[]): {
  totals: Totals
  agents: AgentPerformance[]
  models: ModelUse[]
  setPieces: SetPieceUse[]
  notable: Notable[]
  lines: MatchLine[]
} {
  const totals = emptyTotals()
  const agents = new Map<string, AgentPerformance & { _contexts: number[]; _matches: Set<string>; _models: Set<string>; _clubs: Set<string> }>()
  const models = new Map<string, ModelUse & { _players: Set<string> }>()
  const pieces = new Map<string, SetPieceUse & { _seconds: number }>()
  const notable: Notable[] = []
  const lines: MatchLine[] = []

  const agent = (player: string) => {
    let a = agents.get(player)
    if (!a) {
      a = {
        player,
        models: [],
        clubs: [],
        matches: 0,
        objectives: 0,
        touchdowns: 0,
        turnovers: 0,
        successRate: 0,
        firstTryRate: 0,
        reviewFailures: 0,
        invalidReplies: 0,
        breaches: 0,
        extraTime: 0,
        cost: 0,
        costPerObjective: 0,
        tokens: emptyTokens(),
        cacheShare: 0,
        seconds: 0,
        avgSeconds: 0,
        peakContext: null,
        _contexts: [],
        _matches: new Set(),
        _models: new Set(),
        _clubs: new Set(),
      }
      agents.set(player, a)
    }
    return a
  }
  const firstTryCounts = new Map<string, number>()

  for (const m of list) {
    const line = lineOf(m)
    lines.push(line)
    totals.matches++
    if (line.outcome === 'touchdown') totals.touchdowns++
    else if (line.outcome === 'running') totals.running++
    else {
      totals.turnovers++
      if (line.outcome === 'abandoned') totals.abandoned++
      notable.push({
        match_id: line.match_id,
        kind: line.outcome === 'abandoned' ? 'abandoned' : 'turnover',
        text: `${line.setPiece}: ${line.reason ?? 'turnover'}`,
        at: line.ended_at ?? line.started_at,
      })
    }
    totals.cost += line.cost
    totals.matchSeconds += line.seconds
    if (m.notAccepted) {
      totals.notAccepted++
      notable.push({ match_id: line.match_id, kind: 'not_accepted', text: m.notAccepted, at: line.ended_at })
    }
    totals.qaChecks += m.qa.length
    totals.qaFailed += m.qa.filter((q) => !q.passed).length

    const piece = pieces.get(line.setPiece) ?? {
      setPiece: line.setPiece,
      matches: 0,
      touchdowns: 0,
      turnovers: 0,
      cost: 0,
      avgSeconds: 0,
      avgCost: 0,
      _seconds: 0,
    }
    piece.matches++
    if (line.outcome === 'touchdown') piece.touchdowns++
    if (line.outcome === 'turnover' || line.outcome === 'abandoned') piece.turnovers++
    piece.cost += line.cost
    piece._seconds += line.seconds
    pieces.set(line.setPiece, piece)

    for (const s of m.spends) addUsage(totals.tokens, s.usage, s.billed)
    if (m.spends.length === 0) totals.tokens.billed += line.billedTokens

    for (const [player, n] of m.breachesByPlayer) {
      totals.breaches += n
      agent(player).breaches += n
      notable.push({ match_id: line.match_id, kind: 'breach', text: `${player} wrote outside what it may change; rolled back`, at: line.ended_at })
    }

    const modelOf = new Map(m.players.map((p) => [p.player, p] as const))
    for (const o of m.objectives) {
      totals.objectives++
      if (o.status === 'touchdown') totals.objectiveTouchdowns++
      const extra = isExtraTime(o.name)
      if (extra) totals.extraTime++
      const reviews = m.reviewsByObjective.get(o.objective_id) ?? []
      totals.reviewsPassed += reviews.filter((r) => r.passed).length
      totals.reviewsFailed += reviews.filter((r) => !r.passed).length
      const invalid = m.invalidByObjective.get(o.objective_id) ?? 0
      totals.invalidReplies += invalid
      if (o.kind !== 'player' || !o.owner) continue

      const a = agent(o.owner)
      a._matches.add(m.match.match_id)
      const row = modelOf.get(o.owner)
      if (row?.model) a._models.add(row.model)
      if (row?.club) a._clubs.add(row.club)
      a.objectives++
      if (o.status === 'touchdown') a.touchdowns++
      if (o.status === 'turnover') a.turnovers++
      if (extra) a.extraTime++
      a.reviewFailures += reviews.filter((r) => !r.passed).length
      a.invalidReplies += invalid
      const firstTry = o.status === 'touchdown' && invalid === 0 && reviews.every((r) => r.passed && r.attempt <= 1)
      if (firstTry) firstTryCounts.set(o.owner, (firstTryCounts.get(o.owner) ?? 0) + 1)
      a.seconds += seconds(o.started_at, o.ended_at)
      for (const s of m.spends.filter((x) => x.objective_id === o.objective_id)) {
        a.cost += s.cost
        addUsage(a.tokens, s.usage, s.billed)
        if (s.context !== null) a._contexts.push(s.context)
        const modelName = row?.model ?? 'unknown'
        const use = models.get(modelName) ?? {
          model: modelName,
          club: row?.club ?? null,
          players: [],
          objectives: 0,
          cost: 0,
          billedTokens: 0,
          _players: new Set<string>(),
        }
        use._players.add(o.owner)
        use.objectives++
        use.cost += s.cost
        use.billedTokens += s.billed
        models.set(modelName, use)
      }
      if (extra) {
        notable.push({ match_id: m.match.match_id, kind: 'extra_time', text: `${o.owner} played ${o.name}`, at: o.started_at })
      }
    }
  }

  const agentList: AgentPerformance[] = [...agents.values()]
    .map(({ _contexts, _matches, _models, _clubs, ...a }) => {
      const objectives = a.objectives || 0
      const cacheBase = a.tokens.input + a.tokens.cacheRead + a.tokens.cacheWrite
      return {
        ...a,
        models: [..._models].sort(),
        clubs: [..._clubs].sort(),
        matches: _matches.size,
        successRate: objectives ? a.touchdowns / objectives : 0,
        firstTryRate: objectives ? (firstTryCounts.get(a.player) ?? 0) / objectives : 0,
        cost: round(a.cost),
        costPerObjective: objectives ? round(a.cost / objectives) : 0,
        cacheShare: cacheBase ? a.tokens.cacheRead / cacheBase : 0,
        avgSeconds: objectives ? a.seconds / objectives : 0,
        peakContext: _contexts.length ? Math.max(..._contexts) : null,
      }
    })
    .sort((x, y) => y.objectives - x.objectives || x.player.localeCompare(y.player))

  totals.cost = round(totals.cost)
  return {
    totals,
    agents: agentList,
    models: [...models.values()]
      .map(({ _players, ...u }) => ({ ...u, players: [..._players].sort(), cost: round(u.cost) }))
      .sort((x, y) => y.cost - x.cost),
    setPieces: [...pieces.values()]
      .map(({ _seconds, ...p }) => ({
        ...p,
        cost: round(p.cost),
        avgSeconds: p.matches ? _seconds / p.matches : 0,
        avgCost: p.matches ? round(p.cost / p.matches) : 0,
      }))
      .sort((x, y) => y.matches - x.matches || x.setPiece.localeCompare(y.setPiece)),
    notable: notable.sort((x, y) => (x.at ?? '').localeCompare(y.at ?? '')),
    lines: lines.sort((x, y) => (x.started_at ?? '').localeCompare(y.started_at ?? '')),
  }
}

// ── words ────────────────────────────────────────────────────────────────────

export function money(n: number): string {
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

export function duration(totalSeconds: number): string {
  const s = Math.round(totalSeconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function summaryOf(totals: Totals, agents: AgentPerformance[], models: ModelUse[], period: string): string {
  if (totals.matches === 0) return `No matches ${period}.`
  const parts = [
    `${plural(totals.matches, 'match', 'matches')} ${period}: ${plural(totals.touchdowns, 'touchdown')}, ${plural(totals.turnovers, 'turnover')}` +
      (totals.running ? `, ${totals.running} still running` : '') +
      (totals.abandoned ? ` (${totals.abandoned} stopped by the provider)` : '') +
      '.',
    `${money(totals.cost)} spent on ${compact(totals.tokens.billed)} billed tokens ` +
      `(${compact(totals.tokens.read)} read, ${compact(totals.tokens.written)} written).`,
  ]
  const busiest = agents[0]
  if (busiest) {
    parts.push(
      `The ${busiest.player.replace(/_/g, ' ')} played the most: ${plural(busiest.objectives, 'objective')}, ` +
        `${percent(busiest.successRate)} touchdowns, ${percent(busiest.firstTryRate)} on the first try.`,
    )
  }
  if (totals.extraTime) parts.push(`${plural(totals.extraTime, 'objective')} went to extra time.`)
  if (totals.breaches) parts.push(`${plural(totals.breaches, 'restricted-area breach', 'restricted-area breaches')} rolled back.`)
  if (models.length) parts.push(`Models: ${models.map((m) => m.model.replace(/^[a-z]+\//, '')).join(', ')}.`)
  return parts.join(' ')
}

// ── the reports ──────────────────────────────────────────────────────────────

export interface ReportOptions {
  /** IANA zone the days are cut in: the viewer's, normally. */
  timeZone: string
  /** When the report is made; tests pass a fixed one. */
  now?: Date
}

function dayReport(date: string, list: MatchFacts[]): DayReport {
  const a = accumulate(list)
  const starts = list.map((m) => m.match.started_at).filter((x): x is string => Boolean(x)).sort()
  const ends = list.map((m) => m.match.ended_at).filter((x): x is string => Boolean(x)).sort()
  return {
    date,
    first: starts[0] ?? null,
    last: ends[ends.length - 1] ?? null,
    totals: a.totals,
    matches: a.lines,
    models: a.models,
    setPieces: a.setPieces,
    agents: a.agents,
    notable: a.notable,
    summary: summaryOf(a.totals, a.agents, a.models, `on ${longDate(date)}`),
  }
}

/** "Mon 12 Oct 2026" for a YYYY-MM-DD date, the same in every browser. */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(y!, m! - 1, d!)))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`
}

/** One report per day that had a match, newest first. */
export function dailyReports(facts: ReportFacts, options: ReportOptions): DayReport[] {
  const byDay = new Map<string, MatchFacts[]>()
  for (const m of index(facts).values()) {
    if (!m.match.started_at) continue
    const key = dayKey(m.match.started_at, options.timeZone)
    byDay.set(key, [...(byDay.get(key) ?? []), m])
  }
  return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([date, list]) => dayReport(date, list))
}

/**
 * The multi-day report: every day in the facts, the period's totals, and the
 * agent performance over the whole period, to judge each player across set
 * pieces and days.
 */
export function rangeReport(facts: ReportFacts, options: ReportOptions): RangeReport {
  const days = dailyReports(facts, options).reverse()
  const a = accumulate([...index(facts).values()])
  const from = days[0]?.date ?? null
  const to = days[days.length - 1]?.date ?? null
  const period =
    from && to ? (from === to ? `on ${longDate(from)}` : `from ${longDate(from)} to ${longDate(to)}`) : 'in this period'
  return {
    since: facts.since,
    until: facts.until,
    timeZone: options.timeZone,
    from,
    to,
    generatedAt: (options.now ?? new Date()).toISOString(),
    days,
    totals: a.totals,
    agents: a.agents,
    models: a.models,
    setPieces: a.setPieces,
    notable: a.notable,
    summary: summaryOf(a.totals, a.agents, a.models, period),
  }
}
