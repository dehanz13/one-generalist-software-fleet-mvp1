/**
 * The Claude connector's authorization server: OAuth 2.1, as the MCP
 * authorization spec (revision 2026-07-28) and Claude's connector docs ask.
 *
 *   /.well-known/oauth-protected-resource[/api/mcp]   RFC 9728: where to sign in
 *   /.well-known/oauth-authorization-server           RFC 8414: how
 *   /oauth/register     RFC 7591 dynamic client registration (JSON)
 *   /oauth/authorize    the sign-in and consent page (MATCHDAY_PASSWORD)
 *   /oauth/token        authorization_code with PKCE S256, refresh_token (rotated); form-encoded
 *   /oauth/revoke       RFC 7009
 *
 * Clients come by dynamic registration or by a Client ID Metadata Document
 * URL (server/cimd.ts). Every token is bound to one resource, this
 * deployment's /api/mcp, and checked against it on use. Codes, tokens and
 * client secrets are random 256-bit values kept only as SHA-256 hashes; a
 * code lives two minutes and works once; a reused code or a replayed refresh
 * token revokes the whole connection it belongs to.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { MIN_SECRET_LENGTH, bearer, passwordMatches } from './auth.js'
import type { ConnectorGrant } from '../shared/types.js'
import { REDIRECT_RULE, fetchClientDocument, isClientIdUrl, isLoopbackRedirect, redirectMatches, redirectUriAllowed } from './cimd.js'
import { consentCsp, consentPage, errorPage } from './consent-page.js'
import { nowIso, type Sql } from './db.js'
import { NO_STORE, json } from './http.js'

/** The one scope: read the fleet, queue and cancel run requests. */
export const SCOPE = 'matchday'
export const ACCESS_TOKEN_SECONDS = 60 * 60
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60
export const CODE_SECONDS = 120
const CONSENT_FORM_SECONDS = 15 * 60
const CIMD_CACHE_MS = 24 * 60 * 60 * 1000
/** A rotated refresh token presented again this soon is a client retry, not a theft: refused, but the connection stands. */
const REFRESH_RETRY_GRACE_MS = 30_000
const MAX_REGISTRATIONS_PER_HOUR = 100

/** The fixed callback of claude.ai, Claude Desktop, mobile and Cowork. */
export const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

const OAUTH_HEADERS = { ...NO_STORE, pragma: 'no-cache' }

// ── where things are ─────────────────────────────────────────────────────────

/**
 * This deployment's public origin, which names the issuer and the resource:
 * MATCHDAY_PUBLIC_URL when set (a custom domain, or to pin one of several
 * aliases), else https://<the host asked for> on Vercel, else the request's
 * own origin (dev, tests).
 */
export function publicOrigin(url: URL): string {
  const pinned = process.env.MATCHDAY_PUBLIC_URL
  if (pinned) {
    try {
      const parsed = new URL(pinned)
      if (parsed.protocol === 'https:' || parsed.hostname === 'localhost') return parsed.origin
    } catch {
      // not a URL: fall through to the request's own host
    }
  }
  return process.env.VERCEL ? `https://${url.host}` : url.origin
}

/** The MCP server's URL, what a person pastes into Claude, and the audience of every token. */
export function mcpResource(origin: string): string {
  return `${origin}/api/mcp`
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/api/mcp`
}

/** RFC 9728 protected resource metadata, served at the root and path-suffixed well-known URIs. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Matchday Live',
  }
}

/** False when MATCHDAY_CONNECTOR_CIMD=0: Claude then registers through /oauth/register instead. */
export function cimdEnabled(): boolean {
  return process.env.MATCHDAY_CONNECTOR_CIMD !== '0'
}

/** RFC 8414 authorization server metadata. The issuer is the origin, exactly. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: cimdEnabled(),
  }
}

/** The WWW-Authenticate value of a 401 from /api/mcp. */
export function bearerChallenge(origin: string, error?: { code: string; description: string }): string {
  const parts = [`resource_metadata="${resourceMetadataUrl(origin)}"`, `scope="${SCOPE}"`]
  if (error) parts.unshift(`error="${error.code}"`, `error_description="${error.description}"`)
  return `Bearer ${parts.join(', ')}`
}

// ── small pieces ─────────────────────────────────────────────────────────────

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function randomSecret(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function isoIn(seconds: number, nowMs = Date.now()): string {
  return nowIso(new Date(nowMs + seconds * 1000))
}

function oauthError(status: number, error: string, description: string, headers: Record<string, string> = {}): Response {
  return json({ error, error_description: description }, status, { ...OAUTH_HEADERS, ...headers })
}

/** Read an application/x-www-form-urlencoded body of at most `maxBytes`, or null. */
async function readForm(request: Request, maxBytes: number): Promise<URLSearchParams | null> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!type.startsWith('application/x-www-form-urlencoded')) return null
  if (Number(request.headers.get('content-length') ?? '0') > maxBytes) return null
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return null
  return new URLSearchParams(text)
}

function hasDuplicates(params: URLSearchParams): boolean {
  const keys = [...params.keys()]
  return new Set(keys).size !== keys.length
}

/** PKCE S256: BASE64URL(SHA256(verifier)) equals the challenge sent with the authorization request. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false
  return sameText(createHash('sha256').update(verifier).digest('base64url'), challenge)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── clients ──────────────────────────────────────────────────────────────────

export interface OAuthClient {
  client_id: string
  kind: 'dcr' | 'cimd'
  client_name: string | null
  redirect_uris: string[]
  auth_method: 'none' | 'client_secret_post' | 'client_secret_basic'
  secret_hash: string | null
}

interface ClientRow {
  client_id: string
  kind: 'dcr' | 'cimd'
  client_name: string | null
  redirect_uris: string
  auth_method: OAuthClient['auth_method']
  secret_hash: string | null
  fetched_at: string | null
  revoked_at: string | null
}

const CLIENT_COLUMNS = 'client_id, kind, client_name, redirect_uris, auth_method, secret_hash, fetched_at, revoked_at'

function toClient(row: ClientRow): OAuthClient {
  let uris: unknown
  try {
    uris = JSON.parse(row.redirect_uris)
  } catch {
    uris = []
  }
  return {
    client_id: row.client_id,
    kind: row.kind,
    client_name: row.client_name,
    redirect_uris: Array.isArray(uris) ? uris.filter((u): u is string => typeof u === 'string') : [],
    auth_method: row.auth_method,
    secret_hash: row.secret_hash,
  }
}

type Found<T> = { ok: true; value: T } | { ok: false; error: string }

/** A registered client, or one known by its metadata document URL (fetched, checked, cached for a day). */
export async function resolveClient(sql: Sql, clientId: string): Promise<Found<OAuthClient>> {
  if (!clientId || clientId.length > 2000) return { ok: false, error: 'the request names no client_id' }
  if (isClientIdUrl(clientId)) {
    if (!cimdEnabled()) return { ok: false, error: 'this server does not take client id URLs; the client must register instead' }
    const rows = (await sql.unsafe(`select ${CLIENT_COLUMNS} from oauth_clients where client_id = $1`, [
      clientId,
    ])) as unknown as ClientRow[]
    const cached = rows[0]
    if (cached?.revoked_at) return { ok: false, error: 'this client was blocked on this server' }
    if (cached && cached.kind === 'cimd' && cached.fetched_at && Date.now() - Date.parse(cached.fetched_at) < CIMD_CACHE_MS) {
      return { ok: true, value: toClient(cached) }
    }
    let doc: Awaited<ReturnType<typeof fetchClientDocument>>
    try {
      doc = await fetchClientDocument(clientId)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'could not read the client metadata document' }
    }
    const now = nowIso()
    const saved = (await sql.unsafe(
      `insert into oauth_clients (client_id, kind, client_name, redirect_uris, auth_method, created_at, fetched_at)
       values ($1, 'cimd', $2, $3, 'none', $4, $4)
       on conflict (client_id) do update
         set client_name = excluded.client_name, redirect_uris = excluded.redirect_uris, fetched_at = excluded.fetched_at
         where oauth_clients.kind = 'cimd'
       returning ${CLIENT_COLUMNS}`,
      [clientId, doc.client_name, JSON.stringify(doc.redirect_uris), now],
    )) as unknown as ClientRow[]
    return saved[0] ? { ok: true, value: toClient(saved[0]) } : { ok: false, error: 'unknown client' }
  }
  if (!/^mdcl_[A-Za-z0-9_-]{16,64}$/.test(clientId)) return { ok: false, error: 'unknown client: register it first' }
  const rows = (await sql.unsafe(
    `select ${CLIENT_COLUMNS} from oauth_clients where client_id = $1 and kind = 'dcr' and revoked_at is null`,
    [clientId],
  )) as unknown as ClientRow[]
  return rows[0] ? { ok: true, value: toClient(rows[0]) } : { ok: false, error: 'unknown client: register it again' }
}

/** POST /oauth/register: RFC 7591 dynamic client registration. Public clients by default. */
export async function registerClient(sql: Sql, request: Request): Promise<Response> {
  if (request.method !== 'POST') return oauthError(405, 'invalid_request', 'POST the registration as JSON', { allow: 'POST' })
  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!type.startsWith('application/json')) {
    return oauthError(400, 'invalid_client_metadata', 'send the registration as application/json')
  }
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > 16 * 1024) return oauthError(400, 'invalid_client_metadata', 'the registration is over 16 KB')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return oauthError(400, 'invalid_client_metadata', 'the registration is not valid JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return oauthError(400, 'invalid_client_metadata', 'the registration must be a JSON object')
  }
  const meta = body as Record<string, unknown>
  const uris = meta.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every(redirectUriAllowed)) {
    return oauthError(400, 'invalid_redirect_uri', `redirect_uris must list 1 to 10 URIs, each ${REDIRECT_RULE}`)
  }
  const method = meta.token_endpoint_auth_method ?? 'none'
  if (method !== 'none' && method !== 'client_secret_post' && method !== 'client_secret_basic') {
    return oauthError(400, 'invalid_client_metadata', 'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic')
  }
  const grants = meta.grant_types ?? ['authorization_code', 'refresh_token']
  if (
    !Array.isArray(grants) ||
    !grants.includes('authorization_code') ||
    !grants.every((g) => g === 'authorization_code' || g === 'refresh_token')
  ) {
    return oauthError(400, 'invalid_client_metadata', 'grant_types may be authorization_code and refresh_token only')
  }
  const responses = meta.response_types ?? ['code']
  if (!Array.isArray(responses) || !responses.every((r) => r === 'code')) {
    return oauthError(400, 'invalid_client_metadata', 'response_types may be code only')
  }
  const name =
    typeof meta.client_name === 'string' ? meta.client_name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || null : null

  const now = Date.now()
  const recent = (await sql.unsafe(`select count(*)::int as n from oauth_clients where kind = 'dcr' and created_at > $1`, [
    nowIso(new Date(now - 3_600_000)),
  ])) as unknown as Array<{ n: number }>
  if ((recent[0]?.n ?? 0) >= MAX_REGISTRATIONS_PER_HOUR) {
    return oauthError(429, 'invalid_client_metadata', 'too many registrations in the last hour; try again later', { 'retry-after': '600' })
  }
  await purgeOAuth(sql, now)

  const clientId = `mdcl_${randomBytes(18).toString('base64url')}`
  const secret = method === 'none' ? null : randomSecret('mds_')
  const issued = Math.floor(now / 1000)
  await sql.unsafe(
    `insert into oauth_clients (client_id, kind, client_name, redirect_uris, auth_method, secret_hash, created_at)
     values ($1, 'dcr', $2, $3, $4, $5, $6)`,
    [clientId, name, JSON.stringify(uris), method, secret ? sha256Hex(secret) : null, nowIso(new Date(now))],
  )
  return json(
    {
      client_id: clientId,
      client_id_issued_at: issued,
      ...(name ? { client_name: name } : {}),
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: method,
      scope: SCOPE,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    },
    201,
    OAUTH_HEADERS,
  )
}

// ── /oauth/authorize ─────────────────────────────────────────────────────────

/** The authorization parameters the consent form carries, in a fixed order. */
const CARRIED = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const

interface AuthorizeRequest {
  client: OAuthClient
  redirectUri: string
  state: string | null
  codeChallenge: string
  resource: string
}

type AuthorizeCheck =
  | { kind: 'ok'; value: AuthorizeRequest }
  | { kind: 'page'; status: number; message: string }
  | { kind: 'redirect'; redirectUri: string; state: string | null; error: string; description: string }

/** The resource a client named, if it is this server: its /api/mcp, or its origin. */
function resourceFor(origin: string, given: string | null): string | null {
  if (given === null) return mcpResource(origin)
  const trimmed = given.replace(/\/+$/, '')
  return trimmed === mcpResource(origin) || trimmed === origin ? mcpResource(origin) : null
}

async function checkAuthorize(sql: Sql, params: URLSearchParams, origin: string): Promise<AuthorizeCheck> {
  if (params.getAll('client_id').length !== 1) return { kind: 'page', status: 400, message: 'The request must name exactly one client_id.' }
  if (params.getAll('redirect_uri').length !== 1) {
    return { kind: 'page', status: 400, message: 'The request must name exactly one redirect_uri.' }
  }
  const found = await resolveClient(sql, params.get('client_id') ?? '')
  if (!found.ok) return { kind: 'page', status: 400, message: `This client cannot connect: ${found.error}.` }
  const client = found.value
  const redirectUri = params.get('redirect_uri') ?? ''
  if (!redirectUriAllowed(redirectUri) || !redirectMatches(client.redirect_uris, redirectUri)) {
    return { kind: 'page', status: 400, message: 'The redirect_uri is not one this client registered, so this page will not send you there.' }
  }

  const state = params.get('state')
  const back = (error: string, description: string): AuthorizeCheck => ({
    kind: 'redirect',
    redirectUri,
    state: state !== null && state.length <= 2000 ? state : null,
    error,
    description,
  })
  for (const key of CARRIED) if (params.getAll(key).length > 1) return back('invalid_request', `${key} was sent more than once`)
  if (state !== null && state.length > 2000) return back('invalid_request', 'state is longer than 2000 characters')
  if (params.get('response_type') !== 'code') return back('unsupported_response_type', 'only response_type=code is supported')
  const challenge = params.get('code_challenge') ?? ''
  if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return back('invalid_request', 'PKCE is required: send a code_challenge with code_challenge_method=S256')
  }
  const scopes = (params.get('scope') ?? '').split(/\s+/).filter(Boolean)
  const unknown = scopes.filter((s) => s !== SCOPE && s !== 'offline_access')
  if (unknown.length) return back('invalid_scope', `unknown scope ${unknown.join(' ')}; the scope is ${SCOPE}`)
  const resource = resourceFor(origin, params.get('resource'))
  if (!resource) return back('invalid_target', `this server issues tokens for ${mcpResource(origin)} only`)
  return { kind: 'ok', value: { client, redirectUri, state, codeChallenge: challenge, resource } }
}

function consentKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('matchday oauth consent v1').digest()
}

/** A form token bound to every authorization parameter and an expiry, signed with MATCHDAY_SESSION_SECRET. */
function formToken(params: URLSearchParams, secret: string, expiresAt: number): string {
  const canonical = JSON.stringify([expiresAt, ...CARRIED.map((k) => params.get(k) ?? '')])
  return `${expiresAt}.${createHmac('sha256', consentKey(secret)).update(canonical).digest('base64url')}`
}

function formTokenValid(token: string | null, params: URLSearchParams, secret: string, nowMs: number): boolean {
  if (!token) return false
  const expiresAt = Number(token.slice(0, token.indexOf('.')))
  if (!Number.isInteger(expiresAt) || expiresAt * 1000 < nowMs) return false
  return sameText(token, formToken(params, secret, expiresAt))
}

/**
 * An HTML answer. The referrer policy is same-origin, not no-referrer: under
 * no-referrer a browser sends `Origin: null` with the form's POST, and the
 * origin check below could no longer tell this page from another site.
 */
function html(body: string, status: number, csp: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...OAUTH_HEADERS,
      'content-security-policy': csp,
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      ...headers,
    },
  })
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, ...OAUTH_HEADERS, 'referrer-policy': 'no-referrer' } })
}

/** Back to the client with an error (RFC 6749 4.1.2.1), the state and the issuer (RFC 9207). */
function errorRedirect(check: Extract<AuthorizeCheck, { kind: 'redirect' }>, origin: string): Response {
  const target = new URL(check.redirectUri)
  target.searchParams.set('error', check.error)
  target.searchParams.set('error_description', check.description)
  if (check.state !== null) target.searchParams.set('state', check.state)
  target.searchParams.set('iss', origin)
  return redirect(target.toString())
}

function redirectHost(uri: string): string {
  const url = new URL(uri)
  return isLoopbackRedirect(uri) ? `a program on this computer (${url.host})` : url.host
}

function renderConsent(check: AuthorizeRequest, params: URLSearchParams, secret: string, error: string | null, status: number): Response {
  const hidden: Record<string, string> = {}
  for (const key of CARRIED) {
    const value = params.get(key)
    if (value !== null) hidden[key] = value
  }
  hidden.csrf = formToken(params, secret, Math.floor(Date.now() / 1000) + CONSENT_FORM_SECONDS)
  const body = consentPage({
    clientName: check.client.client_name,
    clientId: check.client.client_id,
    redirectHost: redirectHost(check.redirectUri),
    loopbackOnly: check.client.redirect_uris.every(isLoopbackRedirect),
    hidden,
    error,
  })
  return html(body, status, consentCsp(new URL(check.redirectUri).origin))
}

/** GET shows the consent page; POST (the form) signs in and answers the client. */
export async function authorize(sql: Sql, request: Request, url: URL, origin: string): Promise<Response> {
  const password = process.env.MATCHDAY_PASSWORD ?? ''
  const secret = process.env.MATCHDAY_SESSION_SECRET ?? ''
  if (!password || secret.length < MIN_SECRET_LENGTH) {
    return html(
      errorPage(`The connector is not set up yet: set MATCHDAY_PASSWORD and a MATCHDAY_SESSION_SECRET of ${MIN_SECRET_LENGTH}+ characters in Vercel, then redeploy.`),
      503,
      consentCsp(null),
    )
  }

  if (request.method === 'GET') {
    const check = await checkAuthorize(sql, url.searchParams, origin)
    if (check.kind === 'page') return html(errorPage(check.message), check.status, consentCsp(null))
    if (check.kind === 'redirect') return errorRedirect(check, origin)
    return renderConsent(check.value, url.searchParams, secret, null, 200)
  }
  if (request.method !== 'POST') return html(errorPage('Open this page from the app you are connecting.'), 405, consentCsp(null), { allow: 'GET, POST' })

  // The form posts from this page only: another site's form is refused before anything is read.
  const from = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if ((from && from !== origin) || (site && site !== 'same-origin')) {
    return html(errorPage('This form was sent from another site.'), 403, consentCsp(null))
  }
  const form = await readForm(request, 16 * 1024)
  if (!form) return html(errorPage('The form did not arrive whole. Start the connection again.'), 400, consentCsp(null))
  const check = await checkAuthorize(sql, form, origin)
  if (check.kind === 'page') return html(errorPage(check.message), check.status, consentCsp(null))
  if (check.kind === 'redirect') return errorRedirect(check, origin)
  const asked = check.value

  if (!formTokenValid(form.get('csrf'), form, secret, Date.now())) {
    return renderConsent(asked, form, secret, 'This form ran out or was changed. Check the details and try again.', 400)
  }
  const decision = form.get('decision')
  if (decision === 'deny') {
    return errorRedirect(
      { kind: 'redirect', redirectUri: asked.redirectUri, state: asked.state, error: 'access_denied', description: 'the owner said no' },
      origin,
    )
  }
  if (decision !== 'allow') return renderConsent(asked, form, secret, 'Choose Allow or Deny.', 400)
  if (!passwordMatches(form.get('password') ?? '', password)) {
    // A flat delay makes guessing slow without keeping any state.
    await sleep(600)
    return renderConsent(asked, form, secret, 'That password is not right.', 401)
  }

  const code = randomSecret('mdc_')
  const now = Date.now()
  await sql.unsafe(
    `insert into oauth_codes (code_hash, grant_id, client_id, redirect_uri, code_challenge, resource, scope, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      sha256Hex(code),
      `grt_${randomBytes(9).toString('hex')}`,
      asked.client.client_id,
      asked.redirectUri,
      asked.codeChallenge,
      asked.resource,
      SCOPE,
      nowIso(new Date(now)),
      isoIn(CODE_SECONDS, now),
    ],
  )
  await sql.unsafe(`update oauth_clients set last_used_at = $2 where client_id = $1`, [asked.client.client_id, nowIso(new Date(now))])
  const target = new URL(asked.redirectUri)
  target.searchParams.set('code', code)
  if (asked.state !== null) target.searchParams.set('state', asked.state)
  target.searchParams.set('iss', origin)
  return redirect(target.toString())
}

// ── /oauth/token and /oauth/revoke ───────────────────────────────────────────

type Authenticated = { ok: true; client: OAuthClient } | { ok: false; response: Response }

/** Who is calling the token endpoint: client_id (and its secret, if it has one) from the body or HTTP Basic. */
async function authenticateClient(sql: Sql, request: Request, form: URLSearchParams): Promise<Authenticated> {
  let clientId = form.get('client_id')
  let secret = form.get('client_secret')
  const header = request.headers.get('authorization') ?? ''
  if (/^Basic\s/i.test(header)) {
    if (secret !== null) {
      return { ok: false, response: oauthError(400, 'invalid_request', 'send the client secret one way: Basic or the body, not both') }
    }
    try {
      const decoded = Buffer.from(header.replace(/^Basic\s+/i, ''), 'base64').toString('utf8')
      const colon = decoded.indexOf(':')
      if (colon < 0) throw new Error('no colon')
      const basicId = decodeURIComponent(decoded.slice(0, colon))
      if (clientId !== null && clientId !== basicId) throw new Error('two ids')
      clientId = basicId
      secret = decodeURIComponent(decoded.slice(colon + 1))
    } catch {
      return { ok: false, response: oauthError(401, 'invalid_client', 'the Basic credentials could not be read', { 'www-authenticate': 'Basic' }) }
    }
  }
  if (!clientId) return { ok: false, response: oauthError(401, 'invalid_client', 'send client_id') }
  const found = await resolveClient(sql, clientId)
  if (!found.ok) return { ok: false, response: oauthError(401, 'invalid_client', found.error) }
  const client = found.value
  if (client.secret_hash && (!secret || !sameText(sha256Hex(secret), client.secret_hash))) {
    return { ok: false, response: oauthError(401, 'invalid_client', 'the client secret is missing or wrong', { 'www-authenticate': 'Basic' }) }
  }
  return { ok: true, client }
}

interface GrantRef {
  grant_id: string
  client_id: string
  resource: string
}

/** Revoke a connection: its grant and every token in it. */
export async function revokeGrant(sql: Sql, grantId: string): Promise<boolean> {
  const now = nowIso()
  const rows = await sql.unsafe(
    `update oauth_grants set revoked_at = coalesce(revoked_at, $2) where grant_id = $1 returning grant_id`,
    [grantId, now],
  )
  await sql.unsafe(`update oauth_tokens set revoked_at = coalesce(revoked_at, $2) where grant_id = $1`, [grantId, now])
  return rows.length > 0
}

async function issueTokens(sql: Sql, grant: GrantRef, newGrant: boolean, nowMs: number) {
  const access = randomSecret('mda_')
  const refresh = randomSecret('mdr_')
  const now = nowIso(new Date(nowMs))
  if (newGrant) {
    await sql.unsafe(
      `insert into oauth_grants (grant_id, client_id, resource, scope, created_at, last_used_at) values ($1, $2, $3, $4, $5, $5)`,
      [grant.grant_id, grant.client_id, grant.resource, SCOPE, now],
    )
  } else {
    await sql.unsafe(`update oauth_grants set last_used_at = $2 where grant_id = $1`, [grant.grant_id, now])
  }
  await sql.unsafe(
    `insert into oauth_tokens (token_hash, kind, grant_id, client_id, resource, scope, created_at, expires_at)
     values ($1, 'access', $3, $4, $5, $6, $7, $8), ($2, 'refresh', $3, $4, $5, $6, $7, $9)`,
    [
      sha256Hex(access),
      sha256Hex(refresh),
      grant.grant_id,
      grant.client_id,
      grant.resource,
      SCOPE,
      now,
      isoIn(ACCESS_TOKEN_SECONDS, nowMs),
      isoIn(REFRESH_TOKEN_SECONDS, nowMs),
    ],
  )
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refresh, scope: SCOPE }
}

type TokenOutcome = { ok: true; body: Awaited<ReturnType<typeof issueTokens>> } | { ok: false; status: number; error: string; description: string }

const grantError = (description: string): TokenOutcome => ({ ok: false, status: 400, error: 'invalid_grant', description })

interface CodeRow extends GrantRef {
  redirect_uri: string
  code_challenge: string
  expires_at: string
}

async function exchangeCode(sql: Sql, client: OAuthClient, form: URLSearchParams, origin: string): Promise<TokenOutcome> {
  const code = form.get('code')
  const redirectUri = form.get('redirect_uri')
  const verifier = form.get('code_verifier')
  if (!code || !redirectUri || !verifier) {
    return { ok: false, status: 400, error: 'invalid_request', description: 'send code, redirect_uri and code_verifier' }
  }
  const hash = sha256Hex(code)
  const nowMs = Date.now()
  const now = nowIso(new Date(nowMs))
  // One transaction: the code is spent even when a check below fails, and tokens exist only if every check passed.
  return sql.begin(async (tx) => {
    const spent = (await tx.unsafe(
      `update oauth_codes set used_at = $2 where code_hash = $1 and used_at is null
       returning grant_id, client_id, resource, redirect_uri, code_challenge, expires_at`,
      [hash, now],
    )) as unknown as CodeRow[]
    const row = spent[0]
    if (!row) {
      const seen = (await tx.unsafe(`select grant_id from oauth_codes where code_hash = $1`, [hash])) as unknown as Array<{
        grant_id: string
      }>
      if (!seen[0]) return grantError('unknown authorization code')
      await revokeGrant(tx as unknown as Sql, seen[0].grant_id)
      return grantError('this authorization code was already used; the connection made with it is now revoked')
    }
    if (row.expires_at <= now) return grantError('the authorization code ran out; sign in again')
    if (row.client_id !== client.client_id) return grantError('the authorization code was issued to another client')
    if (row.redirect_uri !== redirectUri) return grantError('redirect_uri differs from the one the code was issued for')
    if (!pkceMatches(verifier, row.code_challenge)) return grantError('code_verifier does not match the code challenge')
    const resource = form.has('resource') ? resourceFor(origin, form.get('resource')) : row.resource
    if (resource !== row.resource) {
      return { ok: false, status: 400, error: 'invalid_target', description: `tokens here are for ${row.resource} only` }
    }
    const body = await issueTokens(tx as unknown as Sql, row, true, nowMs)
    return { ok: true, body } as TokenOutcome
  }) as Promise<TokenOutcome>
}

interface RefreshRow extends GrantRef {
  kind: string
  expires_at: string
  revoked_at: string | null
  grant_revoked: string | null
}

async function refreshTokens(sql: Sql, client: OAuthClient, form: URLSearchParams, origin: string): Promise<TokenOutcome> {
  const token = form.get('refresh_token')
  if (!token) return { ok: false, status: 400, error: 'invalid_request', description: 'send refresh_token' }
  const scopes = (form.get('scope') ?? '').split(/\s+/).filter(Boolean)
  if (scopes.some((s) => s !== SCOPE && s !== 'offline_access')) {
    return { ok: false, status: 400, error: 'invalid_scope', description: `the scope is ${SCOPE}` }
  }
  const nowMs = Date.now()
  const now = nowIso(new Date(nowMs))
  return sql.begin(async (tx) => {
    const rows = (await tx.unsafe(
      `select t.grant_id, t.client_id, t.resource, t.kind, t.expires_at, t.revoked_at, g.revoked_at as grant_revoked
         from oauth_tokens t join oauth_grants g on g.grant_id = t.grant_id
        where t.token_hash = $1
          for update of t`,
      [sha256Hex(token)],
    )) as unknown as RefreshRow[]
    const row = rows[0]
    if (!row || row.kind !== 'refresh') return grantError('unknown refresh token')
    if (row.client_id !== client.client_id) return grantError('the refresh token was issued to another client')
    if (row.grant_revoked) return grantError('this connection was revoked; connect again')
    if (row.revoked_at) {
      if (nowMs - Date.parse(row.revoked_at) > REFRESH_RETRY_GRACE_MS) {
        // A refresh token used twice was copied: end the connection it came from.
        await revokeGrant(tx as unknown as Sql, row.grant_id)
        return grantError('this refresh token was already used; the connection is now revoked, connect again')
      }
      return grantError('this refresh token was just used; use the tokens that answer gave')
    }
    if (row.expires_at <= now) return grantError('the refresh token ran out; connect again')
    if (form.has('resource') && resourceFor(origin, form.get('resource')) !== row.resource) {
      return { ok: false, status: 400, error: 'invalid_target', description: `tokens here are for ${row.resource} only` }
    }
    await tx.unsafe(`update oauth_tokens set revoked_at = $2 where token_hash = $1`, [sha256Hex(token), now])
    const body = await issueTokens(tx as unknown as Sql, row, false, nowMs)
    return { ok: true, body } as TokenOutcome
  }) as Promise<TokenOutcome>
}

/** POST /oauth/token (form-encoded): exchange a code, or rotate a refresh token. */
export async function tokenEndpoint(sql: Sql, request: Request, origin: string): Promise<Response> {
  if (request.method !== 'POST') return oauthError(405, 'invalid_request', 'POST to the token endpoint', { allow: 'POST' })
  const form = await readForm(request, 16 * 1024)
  if (!form) return oauthError(400, 'invalid_request', 'send the request as application/x-www-form-urlencoded, under 16 KB')
  if (hasDuplicates(form)) return oauthError(400, 'invalid_request', 'a parameter was sent more than once')
  const caller = await authenticateClient(sql, request, form)
  if (!caller.ok) return caller.response
  const grantType = form.get('grant_type')
  let outcome: TokenOutcome
  if (grantType === 'authorization_code') {
    outcome = await exchangeCode(sql, caller.client, form, origin)
    if (outcome.ok) await purgeOAuth(sql, Date.now())
  } else if (grantType === 'refresh_token') {
    outcome = await refreshTokens(sql, caller.client, form, origin)
  } else {
    return oauthError(400, 'unsupported_grant_type', 'grant_type is authorization_code or refresh_token')
  }
  if (!outcome.ok) return oauthError(outcome.status, outcome.error, outcome.description)
  await sql.unsafe(`update oauth_clients set last_used_at = $2 where client_id = $1`, [caller.client.client_id, nowIso()])
  return json(outcome.body, 200, OAUTH_HEADERS)
}

/** POST /oauth/revoke (RFC 7009): ends the connection the token belongs to. Always 200 for a known client. */
export async function revokeEndpoint(sql: Sql, request: Request): Promise<Response> {
  if (request.method !== 'POST') return oauthError(405, 'invalid_request', 'POST to the revocation endpoint', { allow: 'POST' })
  const form = await readForm(request, 16 * 1024)
  if (!form) return oauthError(400, 'invalid_request', 'send the request as application/x-www-form-urlencoded')
  const caller = await authenticateClient(sql, request, form)
  if (!caller.ok) return caller.response
  const token = form.get('token')
  if (!token) return oauthError(400, 'invalid_request', 'send token')
  const rows = (await sql.unsafe(`select grant_id, client_id from oauth_tokens where token_hash = $1`, [
    sha256Hex(token),
  ])) as unknown as Array<{ grant_id: string; client_id: string }>
  if (rows[0] && rows[0].client_id === caller.client.client_id) await revokeGrant(sql, rows[0].grant_id)
  return new Response(null, { status: 200, headers: OAUTH_HEADERS })
}

// ── checking a bearer token on /api/mcp ──────────────────────────────────────

export type AccessCheck = { ok: true; grantId: string; clientId: string } | { ok: false; reason: 'missing' | 'invalid' }

/** A live access token for this deployment's /api/mcp, from the Authorization header only. */
export async function verifyAccessToken(sql: Sql, request: Request, origin: string): Promise<AccessCheck> {
  const token = bearer(request.headers.get('authorization'))
  if (!token) return { ok: false, reason: 'missing' }
  if (!token.startsWith('mda_') || token.length > 200) return { ok: false, reason: 'invalid' }
  const rows = (await sql.unsafe(
    `select t.grant_id, t.client_id, t.resource
       from oauth_tokens t join oauth_grants g on g.grant_id = t.grant_id
      where t.token_hash = $1 and t.kind = 'access' and t.revoked_at is null and g.revoked_at is null and t.expires_at > $2`,
    [sha256Hex(token), nowIso()],
  )) as unknown as GrantRef[]
  const row = rows[0]
  // The audience check: a token issued for another deployment's resource is not good here.
  if (!row || row.resource !== mcpResource(origin)) return { ok: false, reason: 'invalid' }
  return { ok: true, grantId: row.grant_id, clientId: row.client_id }
}

// ── housekeeping and the Connections page ────────────────────────────────────

/** Forget what can never be used again: spent codes, dead tokens, unused registrations, old revocations. */
export async function purgeOAuth(sql: Sql, nowMs: number): Promise<void> {
  const now = nowIso(new Date(nowMs))
  const dayAgo = nowIso(new Date(nowMs - 86_400_000))
  const monthAgo = nowIso(new Date(nowMs - 30 * 86_400_000))
  await sql.unsafe(`delete from oauth_codes where expires_at < $1`, [dayAgo])
  await sql.unsafe(`delete from oauth_tokens where expires_at < $1`, [now])
  await sql.unsafe(
    `delete from oauth_grants g
      where (g.revoked_at is not null and g.revoked_at < $1)
         or (g.created_at < $2 and not exists (select 1 from oauth_tokens t where t.grant_id = g.grant_id))`,
    [monthAgo, dayAgo],
  )
  await sql.unsafe(`delete from oauth_clients where kind = 'dcr' and last_used_at is null and created_at < $1`, [dayAgo])
}

export type { ConnectorGrant }

/** The live connections, for the Connections page. No token or hash is ever in them. */
export async function listGrants(sql: Sql): Promise<ConnectorGrant[]> {
  const rows = (await sql.unsafe(
    `select g.grant_id, g.client_id, c.client_name, c.redirect_uris, g.created_at, g.last_used_at, max(t.expires_at) as expires_at
       from oauth_grants g
       join oauth_tokens t on t.grant_id = g.grant_id and t.kind = 'refresh' and t.revoked_at is null and t.expires_at > $1
       left join oauth_clients c on c.client_id = g.client_id
      where g.revoked_at is null
      group by g.grant_id, g.client_id, c.client_name, c.redirect_uris, g.created_at, g.last_used_at
      order by g.created_at desc`,
    [nowIso()],
  )) as unknown as Array<Omit<ConnectorGrant, 'redirect_hosts'> & { redirect_uris: string | null }>
  return rows.map(({ redirect_uris: uris, ...row }) => {
    let hosts: string[] = []
    try {
      hosts = [...new Set((JSON.parse(uris ?? '[]') as string[]).map((u) => new URL(u).hostname))]
    } catch {
      hosts = []
    }
    return { ...row, redirect_hosts: hosts }
  })
}

/** Revoke every connection at once: a lost phone, a shared screen. */
export async function revokeAllGrants(sql: Sql): Promise<number> {
  const now = nowIso()
  const rows = await sql.unsafe(`update oauth_grants set revoked_at = $1 where revoked_at is null returning grant_id`, [now])
  await sql.unsafe(`update oauth_tokens set revoked_at = $1 where revoked_at is null`, [now])
  return rows.length
}
