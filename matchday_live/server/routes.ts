/**
 * Every /api route of the cloud deployment, behind one Vercel Function.
 *
 * vercel.json rewrites `/api/:path*` to `/api/router?route=:path*` (path
 * parameters travel as query parameters through a rewrite), and
 * `/api/live` to its own function, which has a longer time limit. The
 * connector's OAuth endpoints, `/oauth/*` and `/.well-known/*`, are rewritten
 * here too, as `route=oauth/...` and `route=.well-known/...`. The route is
 * read from `route`, else from the path, so the same handler also serves the
 * Vite dev middleware and the tests.
 *
 * Who may call what:
 *   no credential        health, session, /.well-known/*, /oauth/* (the OAuth flow itself)
 *   fleet token (Bearer) ingest, fleet/claim, fleet/requests/:id
 *   OAuth access token   mcp (the Claude connector)
 *   sign-in cookie       everything else, and a state change only from this site
 */
import { MAX_INGEST_BYTES } from '../shared/ingest.js'
import type { HealthResponse } from '../shared/types.js'
import {
  MIN_SECRET_LENGTH,
  SESSION_COOKIE,
  clearedCookie,
  passwordMatches,
  readCookie,
  sessionCookie,
  signSession,
  verifySession,
} from './auth.js'
import {
  applySchema,
  cleanLabel,
  connectionsStatus,
  describeDbError,
  listTokens,
  mintToken,
  renameToken,
  revokeToken,
} from './connections.js'
import { NotConfigured, databaseConfigured, db, nowIso } from './db.js'
import { factsRange, reportFacts } from './facts.js'
import { fail, intParam, json, readJson, safeSegment } from './http.js'
import { fleetTokenId, ingest } from './ingest.js'
import { liveResponse } from './live.js'
import { mcpEndpoint } from './mcp.js'
import {
  authorizationServerMetadata,
  authorize,
  listGrants,
  protectedResourceMetadata,
  publicOrigin,
  registerClient,
  revokeAllGrants,
  revokeEndpoint,
  revokeGrant,
  tokenEndpoint,
} from './oauth.js'
import {
  type ArchivedFilter,
  eventsPage,
  listMatches,
  matchCount,
  matchDetail,
  processes,
  reports,
  reviews,
  setArchived,
  teamTalks,
} from './queries.js'
import {
  cancelRequest,
  checkClaim,
  checkNewRequest,
  checkProgress,
  claimRequest,
  createRequest,
  listRequests,
  listUpcoming,
  reportProgress,
} from './requests.js'

/** A request body: a prompt of 20,000 characters can take four bytes each, or six escaped. */
const REQUEST_BODY_BYTES = 256 * 1024

/** The route's segments, from `?route=` when rewritten, else from the path after /api/. */
export function routeSegments(url: URL): string[] {
  const rewritten = url.searchParams.get('route')
  const raw = rewritten ?? url.pathname.replace(/^\/api\/?/, '')
  return raw
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s))
}

function secureCookies(url: URL): boolean {
  return url.protocol === 'https:' || process.env.NODE_ENV === 'production'
}

/** Signed in: a valid cookie under a usable secret. */
export function signedIn(request: Request, nowMs = Date.now()): boolean {
  const secret = process.env.MATCHDAY_SESSION_SECRET ?? ''
  if (secret.length < MIN_SECRET_LENGTH) return false
  return verifySession(readCookie(request.headers.get('cookie'), SESSION_COOKIE), secret, nowMs)
}

/**
 * A state-changing request from another site is refused even with a cookie
 * (the cookie is SameSite=Strict already; this is the second lock).
 */
function crossSite(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin')
  if (!origin || request.method === 'GET' || request.method === 'HEAD') return false
  try {
    return new URL(origin).host !== url.host
  } catch {
    return true
  }
}

async function health(): Promise<Response> {
  const base: HealthResponse = {
    ok: false,
    source: 'cloud',
    matches: 0,
    store: 'supabase',
    configured: databaseConfigured(),
    auth: 'required',
  }
  if (!base.configured) return json({ ...base, store: 'not configured' })
  try {
    return json({ ...base, ok: true, matches: await matchCount(db()) })
  } catch (error) {
    const message = describeDbError(error)
    // Reachable but empty: the tables are made from the Connections page.
    if (/relation .* does not exist/i.test(message)) {
      return json({ ...base, store: 'supabase (schema not applied: open Connections and apply it)' })
    }
    return json({ ...base, store: `supabase (unreachable: ${message})` })
  }
}

async function session(request: Request, url: URL): Promise<Response> {
  const secure = secureCookies(url)
  if (request.method === 'GET') return json({ signed_in: signedIn(request) })
  if (request.method === 'DELETE') return json({ signed_in: false }, 200, { 'set-cookie': clearedCookie(secure) })
  if (request.method !== 'POST') return fail(405, 'use POST to sign in, DELETE to sign out')
  const password = process.env.MATCHDAY_PASSWORD ?? ''
  const secret = process.env.MATCHDAY_SESSION_SECRET ?? ''
  if (!password || secret.length < MIN_SECRET_LENGTH) {
    return fail(
      503,
      `sign-in is not set up: set MATCHDAY_PASSWORD and a MATCHDAY_SESSION_SECRET of ${MIN_SECRET_LENGTH}+ characters in Vercel, then redeploy`,
    )
  }
  const body = await readJson(request, 4096)
  if (body instanceof Response) return body
  const given = typeof (body as { password?: unknown }).password === 'string' ? (body as { password: string }).password : ''
  if (!passwordMatches(given, password)) {
    // A flat delay makes guessing slow without keeping any state.
    await new Promise((resolve) => setTimeout(resolve, 600))
    return fail(401, 'that password is not right')
  }
  return json({ signed_in: true }, 200, { 'set-cookie': sessionCookie(signSession(secret, Date.now()), secure) })
}

/** OAuth discovery: public, no database, readable from any origin. */
function discovery(segments: string[], method: string, origin: string): Response {
  const cors = { 'access-control-allow-origin': '*' }
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': '*', 'access-control-max-age': '86400' },
    })
  }
  if (method !== 'GET' && method !== 'HEAD') return fail(405, 'discovery documents are read with GET', { allow: 'GET' })
  const path = segments.slice(1).join('/')
  // RFC 9728: the path-suffixed URI first (what MCP clients try first), the root as the fallback.
  if (path === 'oauth-protected-resource/api/mcp' || path === 'oauth-protected-resource') {
    return json(protectedResourceMetadata(origin), 200, cors)
  }
  if (path === 'oauth-authorization-server') return json(authorizationServerMetadata(origin), 200, cors)
  return fail(404, `no discovery document /.well-known/${path}`)
}

/** A Mac's Scheduler, with its fleet token: claim a request, report how it goes. */
async function fleet(request: Request, segments: string[]): Promise<Response> {
  const [, action, requestId] = segments
  if (request.method !== 'POST') return fail(405, 'the fleet API takes POST', { allow: 'POST' })
  const known = (action === 'claim' && segments.length === 2) || (action === 'requests' && segments.length === 3)
  if (!known) return fail(404, `no route /api/${segments.join('/')}`)
  const sql = db()
  const tokenId = await fleetTokenId(sql, request)
  if (tokenId instanceof Response) return tokenId
  const body = await readJson(request, 8 * 1024)
  if (body instanceof Response) return body

  if (action === 'claim') {
    const checked = checkClaim(body)
    if (!checked.ok) return fail(checked.status, checked.error)
    const claimed = await claimRequest(sql, tokenId, checked.value)
    await sql.unsafe(`update fleet_tokens set last_seen_at = $1 where id = $2`, [nowIso(), tokenId])
    return json({ request: claimed })
  }
  if (!requestId || !safeSegment(requestId)) return fail(400, 'a request id is letters, digits, dot, dash or underscore')
  const checked = checkProgress(body)
  if (!checked.ok) return fail(checked.status, checked.error)
  const outcome = await reportProgress(sql, tokenId, requestId, checked.value)
  return outcome.ok ? json({ ok: true }) : fail(outcome.status, outcome.error)
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const segments = routeSegments(url)
  const [head, id, sub, player, leaf] = segments
  const method = request.method
  const origin = publicOrigin(url)

  try {
    if (head === 'health' && segments.length === 1) return await health()
    if (head === 'session' && segments.length === 1) return await session(request, url)
    if (head === 'ingest' && segments.length === 1) {
      if (method !== 'POST') return fail(405, 'POST rows to /api/ingest')
      if (Number(request.headers.get('content-length') ?? '0') > MAX_INGEST_BYTES) {
        return fail(413, `the body is over ${MAX_INGEST_BYTES} bytes; send fewer rows per request`)
      }
      return await ingest(db(), request)
    }
    if (head === '.well-known') return discovery(segments, method, origin)
    if (head === 'oauth' && segments.length === 2) {
      if (id === 'register') return await registerClient(db(), request)
      if (id === 'authorize') return await authorize(db(), request, url, origin)
      if (id === 'token') return await tokenEndpoint(db(), request, origin)
      if (id === 'revoke') return await revokeEndpoint(db(), request)
    }
    if (head === 'oauth') return fail(404, `no OAuth endpoint /oauth/${segments.slice(1).join('/')}`)
    if (head === 'mcp' && segments.length === 1) return await mcpEndpoint(db(), request, origin)
    if (head === 'fleet') return await fleet(request, segments)

    if (!signedIn(request)) return fail(401, 'sign in on this page to read the cloud store')
    if (crossSite(request, url)) return fail(403, 'refused: this request came from another site')

    if (head === 'live' && segments.length === 1) return await liveResponse(db(), request)

    if (head === 'report-facts' && segments.length === 1) {
      if (method !== 'GET') return fail(405, 'GET /api/report-facts?since=<iso>&until=<iso>')
      const range = factsRange(url.searchParams.get('since'), url.searchParams.get('until'))
      if (!range.ok) return fail(400, range.error)
      return json(await reportFacts(db(), range.since, range.until))
    }

    if (head === 'upcoming' && segments.length === 1) {
      if (method !== 'GET') return fail(405, 'Upcoming Matches come from a Mac; this route is read-only')
      return json(await listUpcoming(db()))
    }

    if (head === 'requests') {
      if (segments.length === 1) {
        if (method === 'GET') return json(await listRequests(db(), intParam(url, 'limit', 50)))
        if (method !== 'POST') return fail(405, 'GET the requests, or POST a new one')
        const body = await readJson(request, REQUEST_BODY_BYTES)
        if (body instanceof Response) return body
        const checked = checkNewRequest(body)
        if (!checked.ok) return fail(checked.status, checked.error)
        const made = await createRequest(db(), checked.value, 'page')
        return made.ok ? json(made.value, 201) : fail(made.status, made.error)
      }
      if (segments.length === 3 && sub === 'cancel') {
        if (!id || !safeSegment(id)) return fail(400, 'a request id is letters, digits, dot, dash or underscore')
        if (method !== 'POST') return fail(405, 'POST to cancel')
        const outcome = await cancelRequest(db(), id)
        return outcome.ok ? json(outcome.value) : fail(outcome.status, outcome.error)
      }
    }

    if (head === 'matches') {
      if (segments.length === 1 && method === 'GET') {
        const archivedRaw = url.searchParams.get('archived') ?? '0'
        const archived: ArchivedFilter = archivedRaw === '1' || archivedRaw === 'all' ? archivedRaw : '0'
        return json(await listMatches(db(), intParam(url, 'limit', 200), archived))
      }
      if (!id || !safeSegment(id)) return fail(400, 'a match id is letters, digits, dot, dash or underscore')
      if (segments.length === 2 && method === 'GET') {
        const detail = await matchDetail(db(), id)
        return detail ? json(detail) : fail(404, `no match ${id}`)
      }
      if (segments.length === 3) {
        if (sub === 'archive') {
          if (method !== 'POST') return fail(405, 'POST {"archived": true|false}')
          const body = await readJson(request, 1024)
          if (body instanceof Response) return body
          const value = (body as { archived?: unknown }).archived
          const archived = value === undefined ? true : Boolean(value)
          return (await setArchived(db(), id, archived)) ? json({ match_id: id, archived }) : fail(404, `no match ${id}`)
        }
        if (method !== 'GET') return fail(405, 'this route is read-only')
        if (sub === 'events') {
          return json(await eventsPage(db(), id, intParam(url, 'after', 0), intParam(url, 'limit', 500)))
        }
        if (sub === 'reports') return json(await reports(db(), id))
        if (sub === 'reviews') return json(await reviews(db(), id))
        if (sub === 'processes') return json(await processes(db(), id))
      }
      if (segments.length === 5 && sub === 'players' && leaf === 'team-talks' && method === 'GET') {
        if (!player || !safeSegment(player)) return fail(400, 'a player name is letters, digits, dot, dash or underscore')
        return json(await teamTalks(db(), id, player))
      }
    }

    if (head === 'connections') {
      if (id === 'status' && segments.length === 2 && method === 'GET') return json(await connectionsStatus(origin))
      if (id === 'grants') {
        // The Claude connector's live connections: list them, revoke one, or revoke all.
        if (segments.length === 2 && method === 'GET') return json(await listGrants(db()))
        if (segments.length === 2 && method === 'DELETE') return json({ revoked: await revokeAllGrants(db()) })
        if (segments.length === 3 && sub && safeSegment(sub) && method === 'DELETE') {
          return (await revokeGrant(db(), sub)) ? json({ grant_id: sub, revoked: true }) : fail(404, `no connection ${sub}`)
        }
      }
      if (id === 'schema' && segments.length === 2) {
        if (method !== 'POST') return fail(405, 'POST to apply the schema')
        return json({ applied: true, version: await applySchema(db()) })
      }
      if (id === 'tokens') {
        if (segments.length === 2 && method === 'GET') return json(await listTokens(db()))
        if (segments.length === 2 && method === 'POST') {
          const body = await readJson(request, 2048)
          if (body instanceof Response) return body
          const label = cleanLabel((body as { label?: unknown }).label)
          if (!label) return fail(400, 'name the Mac this token is for, 1 to 80 characters')
          return json(await mintToken(db(), label), 201)
        }
        if (segments.length === 3 && sub && safeSegment(sub)) {
          if (method === 'DELETE') {
            return (await revokeToken(db(), sub)) ? json({ id: sub, revoked: true }) : fail(404, `no token ${sub}`)
          }
          if (method === 'PATCH') {
            const body = await readJson(request, 2048)
            if (body instanceof Response) return body
            const label = cleanLabel((body as { label?: unknown }).label)
            if (!label) return fail(400, 'a label is 1 to 80 characters')
            return (await renameToken(db(), sub, label)) ? json({ id: sub, label }) : fail(404, `no token ${sub}`)
          }
        }
      }
    }

    return fail(404, `no route /api/${segments.join('/')}`)
  } catch (error) {
    if (error instanceof NotConfigured) return fail(503, error.message)
    const message = describeDbError(error)
    if (/(relation|column) .* does not exist/i.test(message)) {
      return fail(503, `the database schema is behind this build (${message}): open Connections and apply the schema`)
    }
    console.error(`[matchday] ${method} /api/${segments.join('/')}:`, error)
    return fail(500, `the server could not answer: ${message}`)
  }
}
