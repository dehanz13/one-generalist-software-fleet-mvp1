/**
 * POST /api/mcp: the Claude connector, an MCP server over Streamable HTTP.
 *
 * Stateless and dual-era, written to the spec rather than with an SDK (none
 * is installed, and a tools-only server is small):
 *
 * - Modern clients (revision 2026-07-28) carry the protocol version and their
 *   capabilities in every request's `_meta`, mirrored into the
 *   MCP-Protocol-Version, Mcp-Method and Mcp-Name headers, which must match
 *   the body. `server/discover` says what this server speaks.
 * - Legacy clients (2025-11-25 back to 2025-03-26) open with `initialize`;
 *   no session is minted, so every later request stands alone too.
 *
 * Every request needs an OAuth access token issued for this deployment's
 * /api/mcp (server/oauth.ts); without one the answer is a 401 whose
 * WWW-Authenticate header points at the protected resource metadata, which
 * is how Claude learns where to sign in. Answers are single JSON objects;
 * GET and DELETE are 405, as a server without streams or sessions answers.
 */
import { dailyReportMarkdown, rangeReportMarkdown } from '../shared/report-markdown.js'
import { dailyReports, dayStart, longDate, nextDay, rangeBounds, rangeReport } from '../shared/report.js'
import type { MatchRow } from '../shared/types.js'
import { describeDbError } from './connections.js'
import { NotConfigured, nowIso, type Sql } from './db.js'
import { MAX_REPORT_DAYS, isoInstant, reportFacts } from './facts.js'
import { NO_STORE, safeSegment } from './http.js'
import { bearerChallenge, verifyAccessToken } from './oauth.js'
import { matchDetail, matchRow } from './queries.js'
import {
  SET_PIECES,
  cancelRequest,
  checkNewRequest,
  createRequest,
  getRequest,
  listRequests,
  listUpcoming,
} from './requests.js'

export const MODERN_VERSION = '2026-07-28'
/** Initialization-based revisions this server also answers. */
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS]

const SERVER_INFO = { name: 'matchday-live', title: 'Matchday Live', version: '2.0.0' }
const CAPABILITIES = { tools: { listChanged: false } }
const INSTRUCTIONS =
  'Matchday Live is the live view of a One Generalist Software Fleet: AI agent "matches" run on Macs. ' +
  'Read with fleet_status, list_matches, get_match and list_upcoming; report with daily_report and ' +
  'multi_day_report (Markdown, with agent performance); queue work with queue_request or queue_ticket, ' +
  'then follow it with request_status. A request only runs on a Mac whose Scheduler accepts remote requests.'

const MAX_BODY_BYTES = 256 * 1024

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

type Id = string | number | null

interface RpcRequest {
  jsonrpc: '2.0'
  id?: Id
  method: string
  params?: Record<string, unknown>
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
    readonly httpStatus = 200,
  ) {
    super(message)
  }
}

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603
const HEADER_MISMATCH = -32020
const UNSUPPORTED_VERSION = -32022

function rpcBody(id: Id, payload: { result: unknown } | { error: { code: number; message: string; data?: unknown } }) {
  return { jsonrpc: '2.0', id, ...payload }
}

function respond(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...headers },
  })
}

// ── tools ────────────────────────────────────────────────────────────────────

interface ToolContext {
  sql: Sql
  /** MATCHDAY_TIMEZONE, else UTC: where days are cut unless a call names a zone. */
  timeZone: string
}

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** A mistake the model can fix: reported in the tool result, not as a protocol error. */
class ToolInputError extends Error {}

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean | string>
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}

const text = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2))

function str(args: Record<string, unknown>, key: string, required: true): string
function str(args: Record<string, unknown>, key: string, required?: false): string | undefined
function str(args: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolInputError(`${key} is required`)
    return undefined
  }
  if (typeof value !== 'string') throw new ToolInputError(`${key} must be a string`)
  return value
}

function int(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolInputError(`${key} must be a whole number from ${min} to ${max}`)
  }
  return value
}

function zoneOf(args: Record<string, unknown>, ctx: ToolContext): string {
  const zone = str(args, 'timezone') ?? ctx.timeZone
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    throw new ToolInputError(`timezone must be an IANA zone such as America/Chicago or Europe/London; got ${zone}`)
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function dateOf(args: Record<string, unknown>, key: string, zone: string, fallbackToday: boolean): string {
  const value = fallbackToday ? str(args, key) : str(args, key, true)
  if (value === undefined) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  }
  if (!DATE.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new ToolInputError(`${key} must be a date as YYYY-MM-DD; got ${value}`)
  }
  return value
}

function idOf(args: Record<string, unknown>, key: string): string {
  const value = str(args, key, true)
  if (!safeSegment(value)) throw new ToolInputError(`${key} is letters, digits, dot, dash or underscore`)
  return value
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const zoneProperty = { type: 'string', description: 'IANA time zone the days are cut in, e.g. America/Chicago. Defaults to the server zone.' }

const MATCH_LIST_COLUMNS = `match_id, setpiece_name, ask, status, founder, project, machine, started_at, ended_at,
  total_tokens, total_cost, archived, updated_at, ticket_id`

const TOOLS: Tool[] = [
  {
    name: 'fleet_status',
    title: 'Fleet status',
    description:
      'What the fleet is doing now: matches running and in total, the last match, run requests waiting or playing, the next planned tickets, and the Macs that relay to this Matchday Live with when each was last seen.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Fleet status', ...READ },
    run: async (_args, { sql }) => {
      const [counts, last, requests, upcoming, macs] = await Promise.all([
        sql.unsafe(
          `select count(*)::int as total, count(*) filter (where status = 'running')::int as running from matches`,
        ) as unknown as Promise<Array<{ total: number; running: number }>>,
        sql.unsafe(
          `select match_id, setpiece_name, status, machine, started_at, ended_at from matches
            order by started_at desc nulls last limit 1`,
        ),
        sql.unsafe(
          `select status, count(*)::int as n from requests where status in ('queued', 'claimed', 'running') group by status`,
        ) as unknown as Promise<Array<{ status: string; n: number }>>,
        sql.unsafe(
          `select ticket_id, title, due_at, set_piece, mode, status, machine from upcoming_matches
            where status in ('scheduled', 'due', 'queued', 'running') order by due_at nulls last, ticket_id limit 5`,
        ),
        sql.unsafe(`select label, last_seen_at from fleet_tokens where revoked_at is null order by last_seen_at desc nulls last`),
      ])
      return text({
        now: nowIso(),
        matches: { total: counts[0]?.total ?? 0, running: counts[0]?.running ?? 0, last: [...last][0] ?? null },
        requests: Object.fromEntries(requests.map((r) => [r.status, r.n])),
        next_tickets: [...upcoming],
        macs: [...macs],
      })
    },
  },
  {
    name: 'list_matches',
    title: 'List matches',
    description:
      'Matches newest first: id, set piece, the ask, status (running, touchdown, turnover), Mac, start and end, tokens and cost. Filter by status or by a start time.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        status: { type: 'string', enum: ['running', 'touchdown', 'turnover'] },
        since: { type: 'string', description: 'Only matches that started at or after this ISO-8601 time or YYYY-MM-DD date.' },
        include_archived: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
    annotations: { title: 'List matches', ...READ },
    run: async (args, { sql }) => {
      const limit = int(args, 'limit', 20, 1, 100)
      const status = str(args, 'status')
      if (status && !['running', 'touchdown', 'turnover'].includes(status)) {
        throw new ToolInputError('status is running, touchdown or turnover')
      }
      const sinceRaw = str(args, 'since')
      const since = sinceRaw ? isoInstant(sinceRaw) : null
      if (sinceRaw && !since) throw new ToolInputError('since must be an ISO-8601 time or a YYYY-MM-DD date')
      if (args.include_archived !== undefined && typeof args.include_archived !== 'boolean') {
        throw new ToolInputError('include_archived is true or false')
      }
      const archived = args.include_archived === false ? 'and coalesce(archived, 0) = 0' : ''
      const rows = (await sql.unsafe(
        `select ${MATCH_LIST_COLUMNS} from matches
          where ($1::text is null or status = $1) and ($2::text is null or started_at >= $2) ${archived}
          order by started_at desc nulls last, match_id desc limit $3`,
        [status ?? null, since, limit],
      )) as unknown as MatchRow[]
      return text([...rows])
    },
  },
  {
    name: 'get_match',
    title: 'Get a match',
    description:
      'One match in full: the match row, tokens read and written, every objective with its status, attempts and error, the players with their models and context use, and the official reviews and replies checked.',
    inputSchema: {
      type: 'object',
      properties: { match_id: { type: 'string', description: 'The match id, from list_matches.' } },
      required: ['match_id'],
      additionalProperties: false,
    },
    annotations: { title: 'Get a match', ...READ },
    run: async (args, { sql }) => {
      const id = idOf(args, 'match_id')
      const detail = await matchDetail(sql, id)
      if (!detail) throw new ToolInputError(`no match ${id}; list_matches shows the ids`)
      const [reviews, replies] = await Promise.all([
        sql.unsafe(
          `select objective_id, review, passed, attempt from official_reviews where match_id = $1 order by created_at, review_id`,
          [id],
        ),
        sql.unsafe(
          `select objective_id, player, report_type, valid, attempt from match_reports where match_id = $1 order by created_at, report_id`,
          [id],
        ),
      ])
      return text({ ...detail, reviews: [...reviews], replies: [...replies] })
    },
  },
  {
    name: 'daily_report',
    title: 'Daily report',
    description:
      "One day's report in Markdown, the same as the page's download: summary, totals (cost, tokens read and written, cache use, time), every match, agent performance, models, set pieces, and what is worth a look.",
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'The day, YYYY-MM-DD. Defaults to today in the time zone.' },
        timezone: zoneProperty,
      },
      additionalProperties: false,
    },
    annotations: { title: 'Daily report', ...READ },
    run: async (args, ctx) => {
      const zone = zoneOf(args, ctx)
      const date = dateOf(args, 'date', zone, true)
      const facts = await reportFacts(ctx.sql, dayStart(date, zone), dayStart(nextDay(date), zone))
      const day = dailyReports(facts, { timeZone: zone }).find((d) => d.date === date)
      if (!day) return `# ${longDate(date)}\n\nNo match started on this day (${zone}).\n`
      return dailyReportMarkdown(day, zone)
    },
  },
  {
    name: 'multi_day_report',
    title: 'Multi-day report',
    description: `A report over several days in Markdown, to judge every agent: agent performance across the period (touchdowns, first-try rate, extra time, corrected replies, cost per objective, context use), models, set pieces, day by day, and every day in full. At most ${MAX_REPORT_DAYS} days.`,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'First day, YYYY-MM-DD.' },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD, included.' },
        timezone: zoneProperty,
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    annotations: { title: 'Multi-day report', ...READ },
    run: async (args, ctx) => {
      const zone = zoneOf(args, ctx)
      const from = dateOf(args, 'from', zone, false)
      const to = dateOf(args, 'to', zone, false)
      if (from > to) throw new ToolInputError('from must not come after to')
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1
      if (days > MAX_REPORT_DAYS) throw new ToolInputError(`a report covers at most ${MAX_REPORT_DAYS} days; this asks for ${days}`)
      const { since, until } = rangeBounds(from, to, zone)
      const facts = await reportFacts(ctx.sql, since, until)
      return rangeReportMarkdown(rangeReport(facts, { timeZone: zone }))
    },
  },
  {
    name: 'list_upcoming',
    title: 'Upcoming Matches',
    description:
      'The planned tickets, soonest first: ticket id, title, sprint, the date and time it is due, the set piece it runs, auto (the Scheduler starts it) or manual, its status and the match that played it.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['scheduled', 'due', 'queued', 'running', 'touchdown', 'turnover', 'skipped'] },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
    annotations: { title: 'Upcoming Matches', ...READ },
    run: async (args, { sql }) => {
      const status = str(args, 'status')
      const limit = int(args, 'limit', 50, 1, 200)
      const rows = await listUpcoming(sql, 1000)
      return text(rows.filter((r) => !status || r.status === status).slice(0, limit))
    },
  },
  {
    name: 'queue_request',
    title: 'Queue a run request',
    description:
      'Ask the fleet to run a set piece now with a prompt. It is queued until a Mac whose Scheduler accepts remote requests and allows this set piece claims it; follow it with request_status. Ask the person before queueing work for them.',
    inputSchema: {
      type: 'object',
      properties: {
        set_piece: { type: 'string', enum: [...SET_PIECES], description: 'The command to run.' },
        prompt: { type: 'string', description: 'What the fleet should do, at most 20,000 characters.' },
        player: { type: 'string', description: 'For ask only: which player answers.' },
        machine: { type: 'string', description: 'The Mac it is for. Leave out for any Mac that accepts it.' },
      },
      required: ['set_piece', 'prompt'],
      additionalProperties: false,
    },
    annotations: { title: 'Queue a run request', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (args, { sql }) => queue(sql, { kind: 'set_piece', ...args }),
  },
  {
    name: 'queue_ticket',
    title: 'Run a planned ticket now',
    description:
      'Ask the fleet to play an Upcoming Matches ticket now instead of on its date. It runs on the Mac that owns the ticket, or any Mac if none does, once its Scheduler accepts remote requests. Ask the person first.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket_id: { type: 'string', description: 'The ticket id, from list_upcoming.' },
        machine: { type: 'string', description: 'The Mac it is for. Leave out for the ticket’s own Mac.' },
      },
      required: ['ticket_id'],
      additionalProperties: false,
    },
    annotations: { title: 'Run a planned ticket now', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: async (args, { sql }) => queue(sql, { kind: 'ticket', ...args }),
  },
  {
    name: 'request_status',
    title: 'Request status',
    description:
      'Where a run request stands: queued, claimed (a Mac took it), running, touchdown, turnover, refused (with why) or cancelled, the Mac, and the match it started. Without request_id, the latest requests.',
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string', description: 'The id queue_request or queue_ticket gave.' } },
      additionalProperties: false,
    },
    annotations: { title: 'Request status', ...READ },
    run: async (args, { sql }) => {
      if (args.request_id === undefined) return text(await listRequests(sql, 10))
      const id = idOf(args, 'request_id')
      const request = await getRequest(sql, id)
      if (!request) throw new ToolInputError(`no request ${id}`)
      const match = request.match_id ? await matchRow(sql, request.match_id) : null
      return text({ request, match: match ? { match_id: match.match_id, status: match.status, started_at: match.started_at, ended_at: match.ended_at } : null })
    },
  },
  {
    name: 'cancel_request',
    title: 'Cancel a request',
    description: 'Cancel a run request no Mac has taken yet. A request already claimed or running cannot be cancelled from here.',
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string' } },
      required: ['request_id'],
      additionalProperties: false,
    },
    annotations: { title: 'Cancel a request', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: async (args, { sql }) => {
      const outcome = await cancelRequest(sql, idOf(args, 'request_id'))
      if (!outcome.ok) throw new ToolInputError(outcome.error)
      return text(outcome.value)
    },
  },
]

async function queue(sql: Sql, input: Record<string, unknown>): Promise<string> {
  const checked = checkNewRequest(input)
  if (!checked.ok) throw new ToolInputError(checked.error)
  const made = await createRequest(sql, checked.value, 'connector')
  if (!made.ok) throw new ToolInputError(made.error)
  return text({
    request: made.value,
    next: 'Queued. A Mac whose Scheduler accepts remote requests will claim it; ask request_status for progress.',
  })
}

/** The tool list as tools/list returns it, in a fixed order. */
export function toolList() {
  return TOOLS.map(({ run: _run, ...tool }) => tool)
}

async function callTool(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const name = params.name
  const tool = typeof name === 'string' ? TOOLS.find((t) => t.name === name) : undefined
  if (!tool) throw new RpcError(INVALID_PARAMS, `Unknown tool: ${String(name)}`)
  const args = params.arguments ?? {}
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new RpcError(INVALID_PARAMS, 'arguments must be an object')
  const allowed = Object.keys((tool.inputSchema.properties as Record<string, unknown>) ?? {})
  const extra = Object.keys(args).filter((k) => !allowed.includes(k))
  try {
    if (extra.length) throw new ToolInputError(`${tool.name} takes ${allowed.join(', ') || 'no arguments'}; not ${extra.join(', ')}`)
    return { content: [{ type: 'text', text: await tool.run(args as Record<string, unknown>, ctx) }] }
  } catch (error) {
    if (error instanceof ToolInputError) return { content: [{ type: 'text', text: error.message }], isError: true }
    if (error instanceof NotConfigured) return { content: [{ type: 'text', text: error.message }], isError: true }
    console.error(`[matchday] mcp ${tool.name}:`, error)
    return { content: [{ type: 'text', text: `the server could not answer: ${describeDbError(error)}` }], isError: true }
  }
}

// ── the endpoint ─────────────────────────────────────────────────────────────

/**
 * The Origin check the transport requires against DNS rebinding: no Origin
 * (a server-side client such as Claude's), this deployment, Claude's own
 * sites, or a page on this computer (a local inspector). Any other is 403.
 */
function originAllowed(header: string | null, origin: string): boolean {
  if (!header) return true
  if (header === origin) return true
  try {
    const url = new URL(header)
    if (url.protocol === 'https:' && (url.hostname === 'claude.ai' || url.hostname.endsWith('.claude.ai') || url.hostname === 'claude.com')) {
      return true
    }
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

/** Mcp-Name may come as =?base64?…?= (non-ASCII names); compare its decoded value. */
function decodeHeaderValue(value: string | null): string | null {
  if (value === null) return null
  const match = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(value)
  return match ? Buffer.from(match[1]!, 'base64').toString('utf8') : value
}

const META_VERSION = 'io.modelcontextprotocol/protocolVersion'

/** The era of a request, and the protocol version it speaks. Throws an RpcError for a request this server must refuse. */
function eraOf(message: RpcRequest, request: Request): 'modern' | 'legacy' {
  const header = request.headers.get('mcp-protocol-version')
  const meta = (message.params?._meta ?? undefined) as Record<string, unknown> | undefined
  const declared = meta?.[META_VERSION]
  if (message.method === 'initialize') return 'legacy'
  if (typeof declared === 'string') {
    if (declared !== MODERN_VERSION) {
      throw new RpcError(
        UNSUPPORTED_VERSION,
        'Unsupported protocol version',
        { supported: SUPPORTED_VERSIONS, requested: declared },
        400,
      )
    }
    if (header !== declared) {
      throw new RpcError(HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version is ${header ?? 'missing'}, the body says ${declared}`, undefined, 400)
    }
    const method = request.headers.get('mcp-method')
    if (method !== message.method) {
      throw new RpcError(HEADER_MISMATCH, `Header mismatch: Mcp-Method is ${method ?? 'missing'}, the body says ${message.method}`, undefined, 400)
    }
    if (message.method === 'tools/call') {
      const name = decodeHeaderValue(request.headers.get('mcp-name'))
      if (name !== message.params?.name) {
        throw new RpcError(HEADER_MISMATCH, `Header mismatch: Mcp-Name is ${name ?? 'missing'}, the body says ${String(message.params?.name)}`, undefined, 400)
      }
    }
    return 'modern'
  }
  // No _meta version: an initialization-era request. Its header, when sent, must name one of those revisions.
  if (header && !(LEGACY_VERSIONS as readonly string[]).includes(header)) {
    if (header === MODERN_VERSION) {
      throw new RpcError(HEADER_MISMATCH, `Header mismatch: MCP-Protocol-Version is ${header} but the body carries no ${META_VERSION}`, undefined, 400)
    }
    throw new RpcError(UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: header }, 400)
  }
  return 'legacy'
}

async function dispatch(message: RpcRequest, era: 'modern' | 'legacy', ctx: ToolContext): Promise<unknown> {
  const params = message.params ?? {}
  const complete = (result: Record<string, unknown>) => ({ resultType: 'complete', ...result })
  switch (message.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      const version = (LEGACY_VERSIONS as readonly string[]).includes(asked) ? asked : LEGACY_VERSIONS[0]
      return { protocolVersion: version, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }
    }
    case 'server/discover':
      return complete({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: CAPABILITIES,
        _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
        instructions: INSTRUCTIONS,
      })
    case 'ping':
      return complete({})
    case 'tools/list':
      return complete({ tools: toolList() })
    case 'tools/call':
      return complete({ ...(await callTool(params, ctx)) })
    default:
      throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${message.method}`, undefined, era === 'modern' ? 404 : 200)
  }
}

function isRequestShape(value: unknown): value is RpcRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    v.jsonrpc === '2.0' &&
    typeof v.method === 'string' &&
    (v.id === undefined || v.id === null || typeof v.id === 'string' || typeof v.id === 'number') &&
    (v.params === undefined || (typeof v.params === 'object' && v.params !== null && !Array.isArray(v.params)))
  )
}

/** One message: a response object, or null for a notification (202). */
async function handleMessage(value: unknown, request: Request, ctx: ToolContext): Promise<{ status: number; body: unknown } | null> {
  if (!isRequestShape(value)) {
    // A response or an error from a legacy client: nothing to answer.
    if (value && typeof value === 'object' && 'jsonrpc' in value && ('result' in value || 'error' in value)) return null
    return { status: 400, body: rpcBody(null, { error: { code: INVALID_REQUEST, message: 'Invalid Request: expected a JSON-RPC 2.0 request' } }) }
  }
  if (value.id === undefined) return null // a notification: notifications/initialized, notifications/cancelled
  const id = value.id
  try {
    const era = eraOf(value, request)
    return { status: 200, body: rpcBody(id, { result: await dispatch(value, era, ctx) }) }
  } catch (error) {
    const rpc =
      error instanceof RpcError ? error : new RpcError(INTERNAL_ERROR, `Internal error: ${describeDbError(error)}`)
    if (!(error instanceof RpcError)) console.error('[matchday] mcp:', error)
    return {
      status: rpc.httpStatus,
      body: rpcBody(id, { error: { code: rpc.code, message: rpc.message, ...(rpc.data !== undefined ? { data: rpc.data } : {}) } }),
    }
  }
}

export function serverTimeZone(): string {
  const zone = process.env.MATCHDAY_TIMEZONE
  if (!zone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return 'UTC'
  }
}

export async function mcpEndpoint(sql: Sql, request: Request, origin: string): Promise<Response> {
  if (request.method !== 'POST') {
    return respond(rpcBody(null, { error: { code: INVALID_REQUEST, message: 'this MCP endpoint takes POST only: no streams, no sessions' } }), 405, {
      allow: 'POST',
    })
  }
  if (!originAllowed(request.headers.get('origin'), origin)) {
    return respond(rpcBody(null, { error: { code: INVALID_REQUEST, message: 'Forbidden: this Origin may not call the MCP endpoint' } }), 403)
  }
  const access = await verifyAccessToken(sql, request, origin)
  if (!access.ok) {
    const challenge =
      access.reason === 'missing'
        ? bearerChallenge(origin)
        : bearerChallenge(origin, { code: 'invalid_token', description: 'the access token is unknown, expired or revoked' })
    return respond(
      rpcBody(null, { error: { code: INVALID_REQUEST, message: 'Unauthorized: connect this server in Claude to sign in' } }),
      401,
      { 'www-authenticate': challenge },
    )
  }

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    return respond(rpcBody(null, { error: { code: INVALID_REQUEST, message: `the request is over ${MAX_BODY_BYTES} bytes` } }), 413)
  }
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return respond(rpcBody(null, { error: { code: INVALID_REQUEST, message: `the request is over ${MAX_BODY_BYTES} bytes` } }), 413)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return respond(rpcBody(null, { error: { code: PARSE_ERROR, message: 'Parse error: the body is not JSON' } }), 400)
  }

  const ctx: ToolContext = { sql, timeZone: serverTimeZone() }
  // 2025-03-26 allowed a batch; later revisions send one message per POST.
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return respond(rpcBody(null, { error: { code: INVALID_REQUEST, message: 'Invalid Request: an empty batch' } }), 400)
    const answers = (await Promise.all(parsed.map((m) => handleMessage(m, request, ctx)))).filter((a) => a !== null)
    if (!answers.length) return new Response(null, { status: 202, headers: NO_STORE })
    return respond(answers.map((a) => a.body))
  }
  const answer = await handleMessage(parsed, request, ctx)
  if (!answer) return new Response(null, { status: 202, headers: NO_STORE })
  return respond(answer.body, answer.status)
}
