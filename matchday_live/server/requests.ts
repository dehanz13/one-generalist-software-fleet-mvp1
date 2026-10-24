/**
 * Upcoming Matches and run requests in the cloud store.
 *
 * A request is "run this now", made on the page (cookie) or through the
 * Claude connector (OAuth). It waits here, queued, until a Mac's Scheduler
 * claims it over the fleet API (fleet token) and reports how it went. Nothing
 * here starts work by itself: a Mac decides whether it accepts a request
 * (scheduler.accept_remote, scheduler.allowed_set_pieces), and every match it
 * starts still passes the kickoff checklist.
 */
import { randomBytes } from 'node:crypto'
import type { NewRequest, RequestRow, RequestStatus, UpcomingMatchRow } from '../shared/types.js'
import { nowIso, type Sql } from './db.js'
import { safeSegment } from './http.js'
import { clamp } from './queries.js'

/** The set pieces a request may name: the engine's commands. */
export const SET_PIECES = [
  'ask',
  'scout-opposition',
  'team-talk',
  'attack',
  'talk-attack',
  'attack-var',
  'attack-review',
  'run-normal',
  'run-heroic',
  'run-mythic',
  'bard',
  'qa',
  'play',
] as const

export const MAX_PROMPT_CHARS = 20_000
const MAX_NOTE_CHARS = 2_000

/** Who asked. Stored as text; the page never sets it itself. */
export type RequestedBy = 'page' | 'connector'

export const REQUEST_COLUMNS = `request_id, created_at, requested_by, kind, set_piece, prompt, player, ticket_id,
  machine, status, claimed_by, match_id, note, updated_at`
const UPCOMING_COLUMNS = `ticket_id, source, source_ref, sprint, title, date, time, timezone, due_at,
  set_piece, mode, prompt, player, status, match_id, machine, note, updated_at`

/** An answer the caller can act on, or the HTTP status and message to send instead. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

const refuse = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error })

function optionalName(value: unknown, field: string): Outcome<string | undefined> {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined }
  if (typeof value !== 'string' || !safeSegment(value) || value.length > 120) {
    return refuse(400, `${field} is 1 to 120 letters, digits, dot, dash or underscore`)
  }
  return { ok: true, value }
}

/**
 * Check a new request, from the page or the connector, before it reaches the
 * database. Every error says what to send instead.
 */
export function checkNewRequest(body: unknown): Outcome<NewRequest> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refuse(400, 'send a JSON object: {"kind": "set_piece" | "ticket", ...}')
  }
  const input = body as Record<string, unknown>
  const machine = optionalName(input.machine, 'machine')
  if (!machine.ok) return machine

  if (input.kind === 'set_piece') {
    const setPiece = input.set_piece
    if (typeof setPiece !== 'string' || !(SET_PIECES as readonly string[]).includes(setPiece)) {
      return refuse(400, `set_piece must be one of ${SET_PIECES.join(', ')}`)
    }
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    if (!prompt) return refuse(400, 'a set piece request needs a prompt: what the fleet should do')
    if (prompt.length > MAX_PROMPT_CHARS) {
      return refuse(400, `the prompt is ${prompt.length} characters; the limit is ${MAX_PROMPT_CHARS}`)
    }
    const player = optionalName(input.player, 'player')
    if (!player.ok) return player
    if (player.value && setPiece !== 'ask') return refuse(400, 'player is for the ask set piece only')
    if (input.ticket_id !== undefined && input.ticket_id !== null) {
      return refuse(400, 'a set piece request names no ticket; send kind "ticket" to run one')
    }
    return {
      ok: true,
      value: {
        kind: 'set_piece',
        set_piece: setPiece,
        prompt,
        ...(player.value ? { player: player.value } : {}),
        ...(machine.value ? { machine: machine.value } : {}),
      },
    }
  }

  if (input.kind === 'ticket') {
    const ticket = optionalName(input.ticket_id, 'ticket_id')
    if (!ticket.ok) return ticket
    if (!ticket.value) return refuse(400, 'a ticket request needs the ticket_id from Upcoming Matches')
    for (const field of ['set_piece', 'prompt', 'player'] as const) {
      if (input[field] !== undefined && input[field] !== null) {
        return refuse(400, `a ticket request carries no ${field}: the ticket already says what to run`)
      }
    }
    return { ok: true, value: { kind: 'ticket', ticket_id: ticket.value, ...(machine.value ? { machine: machine.value } : {}) } }
  }

  return refuse(400, 'kind must be "set_piece" (run a set piece with a prompt) or "ticket" (run a planned ticket now)')
}

function newRequestId(): string {
  return `req_${randomBytes(6).toString('hex')}`
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
}

/** Ticket statuses that refuse a new request: it is already on its way, or done. */
const TICKET_TAKEN = ['queued', 'running', 'touchdown', 'turnover']

/**
 * Queue a checked request. A ticket request needs a ticket on the board that
 * is not already queued, running or played; in the same transaction it marks
 * the ticket `queued` (from scheduled, due or skipped), so its Mac's
 * Scheduler leaves it for the request. The same rules as `ogsf var`.
 */
export async function createRequest(sql: Sql, input: NewRequest, requestedBy: RequestedBy): Promise<Outcome<RequestRow>> {
  const now = nowIso()
  try {
    return (await sql.begin(async (tx) => {
      if (input.kind === 'ticket') {
        const found = (await tx.unsafe(`select status from upcoming_matches where ticket_id = $1 for update`, [
          input.ticket_id ?? '',
        ])) as unknown as Array<{ status: string | null }>
        const ticket = found[0]
        if (!ticket) {
          return refuse(404, `no ticket ${input.ticket_id} on the Upcoming Matches board; a Mac relays its tickets before they can be requested`)
        }
        if (ticket.status && TICKET_TAKEN.includes(ticket.status)) {
          return refuse(409, `ticket ${input.ticket_id} is already ${ticket.status}`)
        }
      }
      const rows = (await tx.unsafe(
        `insert into requests (request_id, created_at, requested_by, kind, set_piece, prompt, player, ticket_id, machine,
                               status, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $2)
         returning ${REQUEST_COLUMNS}`,
        [
          newRequestId(),
          now,
          requestedBy,
          input.kind,
          input.set_piece ?? null,
          input.prompt ?? null,
          input.player ?? null,
          input.ticket_id ?? null,
          input.machine ?? null,
        ],
      )) as unknown as RequestRow[]
      if (input.kind === 'ticket') {
        await tx.unsafe(
          `update upcoming_matches set status = 'queued', note = null, updated_at = $2
            where ticket_id = $1 and status in ('scheduled', 'due', 'skipped')`,
          [input.ticket_id ?? null, now],
        )
      }
      return { ok: true, value: rows[0]! }
    })) as Outcome<RequestRow>
  } catch (error) {
    if (isUniqueViolation(error)) {
      return refuse(409, `ticket ${input.ticket_id} already has a request waiting or playing; cancel it or wait for it`)
    }
    throw error
  }
}

export async function listRequests(sql: Sql, limit: number): Promise<RequestRow[]> {
  return [
    ...((await sql.unsafe(`select ${REQUEST_COLUMNS} from requests order by created_at desc, request_id limit $1`, [
      clamp(limit, 1, 500),
    ])) as unknown as RequestRow[]),
  ]
}

export async function getRequest(sql: Sql, requestId: string): Promise<RequestRow | null> {
  const rows = (await sql.unsafe(`select ${REQUEST_COLUMNS} from requests where request_id = $1`, [
    requestId,
  ])) as unknown as RequestRow[]
  return rows[0] ?? null
}

/** Cancel a request nobody has taken yet. A ticket it queued goes back on the board as scheduled. */
export async function cancelRequest(sql: Sql, requestId: string): Promise<Outcome<RequestRow>> {
  const now = nowIso()
  const cancelled = (await sql.begin(async (tx) => {
    const rows = (await tx.unsafe(
      `update requests set status = 'cancelled', note = 'cancelled before a Mac took it', updated_at = $2
        where request_id = $1 and status = 'queued'
        returning ${REQUEST_COLUMNS}`,
      [requestId, now],
    )) as unknown as RequestRow[]
    const row = rows[0]
    if (row?.kind === 'ticket' && row.ticket_id) {
      await tx.unsafe(
        `update upcoming_matches set status = 'scheduled', note = null, updated_at = $2 where ticket_id = $1 and status = 'queued'`,
        [row.ticket_id, now],
      )
    }
    return row ?? null
  })) as RequestRow | null
  if (cancelled) return { ok: true, value: cancelled }
  const current = await getRequest(sql, requestId)
  if (!current) return refuse(404, `no request ${requestId}`)
  return refuse(409, `request ${requestId} is ${current.status}; only a queued request can be cancelled`)
}

/** Planned tickets, soonest first. */
export async function listUpcoming(sql: Sql, limit = 500): Promise<UpcomingMatchRow[]> {
  return [
    ...((await sql.unsafe(
      `select ${UPCOMING_COLUMNS} from upcoming_matches order by due_at nulls last, ticket_id limit $1`,
      [clamp(limit, 1, 1000)],
    )) as unknown as UpcomingMatchRow[]),
  ]
}

// ── the fleet side: a Mac's Scheduler, with its fleet token ─────────────────

export interface ClaimInput {
  machine: string
  accepts: string[]
}

/** Check a claim body: {"machine": "<this Mac>", "accepts": ["ask", ...]}. */
export function checkClaim(body: unknown): Outcome<ClaimInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refuse(400, 'send {"machine": "<this Mac>", "accepts": ["<set piece>", ...]}')
  }
  const { machine, accepts } = body as { machine?: unknown; accepts?: unknown }
  if (typeof machine !== 'string' || !safeSegment(machine)) {
    return refuse(400, 'machine is the name of this Mac: letters, digits, dot, dash or underscore')
  }
  if (!Array.isArray(accepts) || accepts.length > 50 || accepts.some((a) => typeof a !== 'string' || !safeSegment(a))) {
    return refuse(400, 'accepts is the list of set pieces this Mac runs for remote requests (scheduler.allowed_set_pieces)')
  }
  return { ok: true, value: { machine, accepts: accepts as string[] } }
}

/**
 * Claim the oldest queued request this Mac may run, atomically: one
 * statement, and `for update skip locked` so two Macs asking at the same
 * moment never take the same request. A set piece request needs the set piece
 * in `accepts`; a ticket request needs a ticket owned by this Mac or by no
 * Mac. Either needs the request addressed to this Mac or to any.
 */
export async function claimRequest(sql: Sql, tokenId: string, input: ClaimInput): Promise<RequestRow | null> {
  const rows = (await sql.unsafe(
    `update requests r
        set status = 'claimed', claimed_by = $1, claimed_token = $2, updated_at = $3
      where r.request_id = (
              select q.request_id
                from requests q
                left join upcoming_matches u on q.kind = 'ticket' and u.ticket_id = q.ticket_id
               where q.status = 'queued'
                 and (q.machine is null or q.machine = $1)
                 and ((q.kind = 'set_piece' and q.set_piece = any($4::text[]))
                   or (q.kind = 'ticket' and u.ticket_id is not null and (u.machine is null or u.machine = $1)))
               order by q.created_at, q.request_id
               limit 1
                 for update of q skip locked)
        and r.status = 'queued'
      returning ${REQUEST_COLUMNS.split(',').map((c) => `r.${c.trim()}`).join(', ')}`,
    [input.machine, tokenId, nowIso(), input.accepts],
  )) as unknown as RequestRow[]
  return rows[0] ?? null
}

/** The order a request's status moves in. A final state (3) never changes. */
const STATUS_RANK: Record<RequestStatus, number> = {
  queued: 0,
  claimed: 1,
  running: 2,
  touchdown: 3,
  turnover: 3,
  refused: 3,
  cancelled: 3,
}

/** What a Mac may report about a request it claimed. */
const FLEET_STATUSES: readonly RequestStatus[] = ['claimed', 'running', 'touchdown', 'turnover', 'refused']

export interface ProgressInput {
  status: RequestStatus
  match_id: string | null
  note: string | null
}

export function checkProgress(body: unknown): Outcome<ProgressInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refuse(400, 'send {"status": "running" | "touchdown" | "turnover" | "refused", "match_id"?, "note"?}')
  }
  const { status, match_id: matchId, note } = body as { status?: unknown; match_id?: unknown; note?: unknown }
  if (typeof status !== 'string' || !(FLEET_STATUSES as readonly string[]).includes(status)) {
    return refuse(400, `status must be one of ${FLEET_STATUSES.join(', ')}`)
  }
  const match = optionalName(matchId, 'match_id')
  if (!match.ok) return match
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > MAX_NOTE_CHARS)) {
    return refuse(400, `note is text of at most ${MAX_NOTE_CHARS} characters`)
  }
  return {
    ok: true,
    value: { status: status as RequestStatus, match_id: match.value ?? null, note: typeof note === 'string' && note ? note : null },
  }
}

/**
 * Move a claimed request forward: only the Mac (fleet token) that claimed it,
 * never backwards, never out of a final state. The update is a compare and
 * set on the status read, so two reports racing cannot both land.
 */
export async function reportProgress(sql: Sql, tokenId: string, requestId: string, input: ProgressInput): Promise<Outcome<null>> {
  const rows = (await sql.unsafe(`select status, claimed_token from requests where request_id = $1`, [
    requestId,
  ])) as unknown as Array<{ status: RequestStatus; claimed_token: string | null }>
  const current = rows[0]
  if (!current) return refuse(404, `no request ${requestId}`)
  if (current.claimed_token !== tokenId) return refuse(403, `request ${requestId} was not claimed by this Mac's token`)
  const from = STATUS_RANK[current.status] ?? 3
  const to = STATUS_RANK[input.status]
  if (from >= 3 || to < from) {
    return refuse(409, `request ${requestId} is ${current.status}; it cannot become ${input.status}`)
  }
  const updated = await sql.unsafe(
    `update requests
        set status = $1, match_id = coalesce($2, match_id), note = coalesce($3, note), updated_at = $4
      where request_id = $5 and status = $6 and claimed_token = $7
      returning request_id`,
    [input.status, input.match_id, input.note, nowIso(), requestId, current.status, tokenId],
  )
  if (!updated.length) return refuse(409, `request ${requestId} changed while this report was on its way; read it and try again`)
  return { ok: true, value: null }
}
