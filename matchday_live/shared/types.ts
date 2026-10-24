/**
 * The API contract of Matchday Live (wiki/DATA-CONTRACT.md), as TypeScript.
 *
 * Every row type mirrors a table in the match log one-for-one. The same
 * shapes come back from `ogsf var` (local SQLite), from the Vercel Functions
 * (Supabase) and from the demo recording, so the page never knows which one
 * it is talking to. Nothing here is derived state: durations, lanes and
 * progress are computed in the page.
 */

/** matches.status: a match is running until it earns a touchdown. */
export type MatchStatus = 'running' | 'touchdown' | 'turnover'

/** objectives.status. `queued` only for declared objectives not yet entered. */
export type ObjectiveStatus = 'queued' | 'running' | 'touchdown' | 'turnover'

/** objectives.kind: who does the work, and so which lane it is drawn in. */
export type ObjectiveKind = 'head_coach' | 'player' | 'referee'

/** events.type, as the match feed writes them. */
export type EventType =
  | 'objective_start'
  | 'objective_end'
  | 'raider_start'
  | 'raider_end'
  | 'ability_cast'
  | 'trade'
  | 'gear_check_pass'
  | 'gear_check_fail'
  | 'log'
  | 'error'

export interface MatchRow {
  match_id: string
  /** The set piece(s) run under this id, in order: "team-talk + attack-var". */
  setpiece_name: string | null
  /** The founder's request, first 500 characters. */
  ask: string | null
  status: MatchStatus | null
  founder: string | null
  project: string | null
  /** Which Mac ran it. */
  machine: string | null
  started_at: string | null
  ended_at: string | null
  total_tokens: number | null
  total_cost: number | null
  /** 1 once archived out of the review list. Review state, not match state. */
  archived: number | null
  updated_at: string | null
  /** Version 2: the Upcoming Matches ticket this match played, or null. */
  ticket_id?: string | null
}

export interface ObjectiveRow {
  objective_id: string
  match_id: string
  seq: number | null
  name: string | null
  kind: ObjectiveKind | null
  owner: string | null
  description: string | null
  status: ObjectiveStatus | null
  attempt: number | null
  retries: number | null
  error: string | null
  started_at: string | null
  ended_at: string | null
}

export interface EventRow {
  /** Monotonic, insertion-ordered: SQLite rowid locally, an identity column in the cloud. */
  cursor: number
  event_id: string
  match_id: string
  objective_id: string | null
  parent_id: string | null
  type: EventType | null
  name: string | null
  /** Raw JSON as written by the match feed; parse at the point of display. */
  payload_json: string | null
  tokens: number | null
  started_at: string | null
  ended_at: string | null
}

export interface MatchReportRow {
  report_id: string
  match_id: string
  objective_id: string | null
  player: string | null
  /** TalkReport | AttackReport | AnalystReport | VarReport | BardReport | GenericReport | ChangesReport | QaReport */
  report_type: string | null
  /** For an invalid reply: {"raw": "<last 2000 characters>"}. */
  payload_json: string | null
  /** 0 = the reply did not parse. */
  valid: number | null
  attempt: number | null
  created_at: string | null
}

export interface OfficialReviewRow {
  review_id: string
  match_id: string
  objective_id: string | null
  attempt: number | null
  /** ball_in_play | ball_not_flat | replay_matches_report | decision_stands | json_parses | tests_pass(<cmd>) */
  review: string | null
  passed: number | null
  /** ["<item>: <note>"], [] on a pass. */
  violations_json: string | null
  /** [{"item","ok","note"}]: what the review actually looked at. */
  checks_json: string | null
  created_at: string | null
}

export interface ProcessRow {
  process_id: string
  match_id: string
  /** setpiece | player */
  kind: string | null
  name: string | null
  pid: number | null
  command: string | null
  started_at: string | null
  /** null = believed alive. */
  ended_at: string | null
}

/** A club_sessions row: one player's club session in a match. Supplies lane labels. */
export interface PlayerRow {
  match_id: string
  player: string
  /** pi | claude_code | scripted. null while the player is still running. */
  club: string | null
  model: string | null
  color: string | null
  session_id: string | null
  /** Window occupancy after the player's last turn, and the model's ceiling. null while running. */
  context_tokens: number | null
  context_window: number | null
  created_at: string | null
  last_used_at: string | null
}

export interface TeamTalkRow {
  match_id: string
  player: string
  system: string | null
  user: string | null
  updated_at: string | null
}

// ── payload shapes ───────────────────────────────────────────────────────────
// Every field is optional: a club reports what it reports.

export interface RaiderStartPayload {
  model?: string
  thinking?: string
  color?: string
  session_id?: string
  club?: string
  purpose?: string
  /** null = every tool. */
  tools?: string[] | null
  enchantments?: string[]
}

/** Tokens and dollars per component for one player objective, summed over every send. */
export interface UsageBreakdown {
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  /** The thinking SHARE of output, never added to it. */
  reasoning_tokens?: number
  total_tokens: number
  input_cost: number
  output_cost: number
  cache_read_cost: number
  cache_write_cost: number
  total_cost: number
}

export interface RaiderEndPayload {
  cost?: number
  usage?: UsageBreakdown
  context_tokens?: number
  context_window?: number
}

/** A club's tool call. */
export interface ToolCastPayload {
  tool?: string
  tool_call_id?: string
  args?: Record<string, unknown>
  ok?: boolean
  result_snippet?: string
  duration_ms?: number
  player?: string
}

/** A qa check run by the referee. */
export interface QaCastPayload {
  area?: string
  operation?: string
  command?: string
  returncode?: number
  passed?: boolean
  output_artifact?: string
}

export interface ReviewCheck {
  item: string
  ok: boolean
  note: string
}

// ── API responses ───────────────────────────────────────────────────────────

/** What moved through a match: raw tokens read the first time, and tokens written. */
export interface MatchUsage {
  read: number
  written: number
}

export interface MatchSummary extends MatchRow {
  objectives: ObjectiveRow[]
  objective_count: number
  players: PlayerRow[]
}

export interface MatchDetail {
  match: MatchRow
  usage: MatchUsage
  objectives: ObjectiveRow[]
  players: PlayerRow[]
}

export interface EventsPage {
  events: EventRow[]
  cursor: number
  has_more: boolean
}

export interface TeamTalks {
  system: string | null
  user: string | null
}

export interface HealthResponse {
  ok: boolean
  source: 'local' | 'cloud'
  matches: number
  /** The file on a Mac, or "supabase". */
  store: string
  /** Cloud only: false until DATABASE_URL is set. */
  configured?: boolean
  /** Cloud only: whether the API needs a signed-in cookie. */
  auth?: 'required' | 'none'
}

export interface ApiError {
  error: string
}

// ── the demo recording ───────────────────────────────────────────────────────

/** One finished match, everything the API would return for it once it is over. */
export interface DemoMatch {
  match: MatchRow
  objectives: ObjectiveRow[]
  /** The match's player rows (club_sessions), as the API returns them once the match is over. */
  players: PlayerRow[]
  /** Every event, in cursor order. */
  events: EventRow[]
  reports: MatchReportRow[]
  reviews: OfficialReviewRow[]
  processes: ProcessRow[]
  team_talks: Array<{ player: string; system: string | null; user: string | null }>
}

/**
 * public/demo/matchday-demo.json. Written by `ogsf demo --export`. Replayed in
 * the browser. Version 2 adds the planned work and the run requests, each in
 * its final state; a replay derives what they looked like at any moment from
 * their match's start and end.
 */
export interface DemoDataset {
  version: 1 | 2
  generated_at: string
  title: string
  matches: DemoMatch[]
  /** Version 2. */
  upcoming?: UpcomingMatchRow[]
  /** Version 2. */
  requests?: RequestRow[]
}

// ── version 2: Upcoming Matches, requests, reports ─────────────────────────────

/** Where a planned ticket came from. Linear is designed for and arrives later. */
export type TicketSource = 'markdown' | 'linear'

/** auto: the Mac's Scheduler starts it when due. manual: a person does. */
export type TicketMode = 'auto' | 'manual'

export type UpcomingStatus = 'scheduled' | 'due' | 'queued' | 'running' | 'touchdown' | 'turnover' | 'skipped'

/** An upcoming_matches row: one planned ticket. */
export interface UpcomingMatchRow {
  ticket_id: string
  source: TicketSource | null
  /** The markdown file, or the Linear issue URL. */
  source_ref: string | null
  sprint: string | null
  title: string | null
  /** YYYY-MM-DD: the day it is to be worked. */
  date: string | null
  /** HH:MM, or null when the config's default time applies. */
  time: string | null
  timezone: string | null
  /** date + time in its zone, as ISO UTC. */
  due_at: string | null
  set_piece: string | null
  mode: TicketMode | null
  prompt: string | null
  player: string | null
  status: UpcomingStatus | null
  match_id: string | null
  machine: string | null
  note: string | null
  updated_at: string | null
}

export type RequestKind = 'set_piece' | 'ticket'

export type RequestStatus = 'queued' | 'claimed' | 'running' | 'touchdown' | 'turnover' | 'refused' | 'cancelled'

/** A requests row: "run this now", from the page, the Claude connector or the CLI. */
export interface RequestRow {
  request_id: string
  created_at: string | null
  /** page | connector | cli */
  requested_by: string | null
  kind: RequestKind | null
  set_piece: string | null
  prompt: string | null
  player: string | null
  ticket_id: string | null
  /** The Mac it is for; null = any Mac that accepts it. */
  machine: string | null
  status: RequestStatus | null
  claimed_by: string | null
  match_id: string | null
  note: string | null
  updated_at: string | null
}

/** POST /api/requests */
export interface NewRequest {
  kind: RequestKind
  set_piece?: string
  prompt?: string
  player?: string
  ticket_id?: string
  machine?: string
}

/** One raider_end event: what one player objective spent. */
export interface RaiderEndFact {
  match_id: string
  objective_id: string | null
  player: string | null
  tokens: number | null
  /** RaiderEndPayload as JSON. */
  payload_json: string | null
  started_at: string | null
}

export interface ReviewFact {
  match_id: string
  objective_id: string | null
  review: string | null
  passed: number | null
  attempt: number | null
  created_at: string | null
}

export interface ReportValidityFact {
  match_id: string
  objective_id: string | null
  player: string | null
  report_type: string | null
  valid: number | null
  attempt: number | null
  created_at: string | null
}

/** An `error` event: objective errors, permission_breach, not_accepted. */
export interface ErrorFact {
  match_id: string
  objective_id: string | null
  name: string | null
  payload_json: string | null
  started_at: string | null
}

/** An ability_cast named qa:<check>. */
export interface QaCastFact {
  match_id: string
  objective_id: string | null
  name: string | null
  /** QaCastPayload as JSON. */
  payload_json: string | null
  started_at: string | null
  ended_at: string | null
}

/**
 * GET /api/report-facts?since=&until=: the raw rows every report is computed
 * from, for the matches that started in [since, until). Aggregation lives in
 * shared/report.ts so the page, the downloads and the connector agree.
 */
export interface ReportFacts {
  since: string
  until: string
  matches: MatchRow[]
  objectives: ObjectiveRow[]
  players: PlayerRow[]
  raider_ends: RaiderEndFact[]
  reviews: ReviewFact[]
  reports: ReportValidityFact[]
  errors: ErrorFact[]
  qa_casts: QaCastFact[]
}

// ── connections (cloud only) ─────────────────────────────────────────────────

export interface EnvStatus {
  name: string
  set: boolean
  purpose: string
}

/** Version 2: the Claude connector, as the Connections page shows it. */
export interface ConnectorStatus {
  /** What to paste into Claude as the connector's URL: this deployment's /api/mcp. */
  url: string
  /** True when Claude can connect: https, sign-in set up, database reachable, schema version 2. */
  ready: boolean
  /** Why not, and what to do; null when ready. */
  reason: string | null
  /** Connections live now (each one a client signed in with the password), or null when unknown. */
  connections: number | null
}

/** One live connector connection (GET /api/connections/grants). No token or hash is ever in it. */
export interface ConnectorGrant {
  grant_id: string
  client_id: string
  client_name: string | null
  /** Where the client sends people back to: "claude.ai", or "localhost" for Claude Code. */
  redirect_hosts: string[]
  created_at: string
  last_used_at: string | null
  /** When the connection ends unless the client renews it. */
  expires_at: string
}

export interface ConnectionsStatus {
  env: EnvStatus[]
  database: { reachable: boolean; error: string | null }
  schema: { applied: boolean; version: number | null; latest: number }
  /** Absent from a version 1 server. */
  connector?: ConnectorStatus
}

export interface FleetToken {
  id: string
  label: string
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

export interface MintedToken extends FleetToken {
  /** Shown once. Only its SHA-256 hash is stored. */
  token: string
}
