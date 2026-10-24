/**
 * OAuth clients known by URL: Client ID Metadata Documents.
 *
 * A client such as Claude can name itself with an https URL instead of
 * registering. The authorization server fetches that URL, checks the JSON it
 * finds names itself (`client_id` equals the URL), and takes the redirect
 * URIs from it. Fetching a URL a stranger chose is a server-side request
 * forgery risk, so the fetch is fenced: https on port 443 only, no address in
 * a private, loopback, link-local or otherwise special range, no redirects, a
 * timeout and a size limit, and nothing from the document but its name and
 * redirect URIs is ever used.
 *
 * What remains: the address is checked when it is resolved, and `fetch`
 * resolves it again (DNS rebinding could slip between the two). On Vercel a
 * function has no private network to reach, and a document that does not
 * name itself is thrown away unread.
 */
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const MAX_DOCUMENT_BYTES = 64 * 1024
const FETCH_TIMEOUT_MS = 5_000

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1'])

/** Claude's own sites: where the Claude app, Desktop, mobile and Cowork send a browser back to. */
const CLAUDE_HOSTS = ['claude.ai', 'claude.com']

/** The rule, as an error message states it. */
export const REDIRECT_RULE =
  'https on claude.ai or claude.com (or a host named in MATCHDAY_CONNECTOR_REDIRECTS), or http on localhost or 127.0.0.1, with no fragment'

/** Extra hosts from MATCHDAY_CONNECTOR_REDIRECTS, comma-separated; "*" opens every https host. Read on each call, so a test can set it. */
function extraRedirectHosts(): string[] {
  return (process.env.MATCHDAY_CONNECTOR_REDIRECTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * An https host this server may send a browser back to. Registration is open
 * to anyone, so without this rule a stranger's client could lead the founder's
 * sign-in to itself; Claude's hosts and the ones the founder lists are enough.
 */
export function redirectHostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase()
  const extra = extraRedirectHosts()
  if (extra.includes('*')) return true
  const under = (base: string) => host === base || host.endsWith(`.${base}`)
  return CLAUDE_HOSTS.some(under) || extra.some(under)
}

/** A redirect URI a client may register: https on an allowed host, or http on this computer. No fragment, no user info. */
export function redirectUriAllowed(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 2000) return false
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return false
  }
  if (parsed.hash || uri.includes('#') || parsed.username || parsed.password) return false
  if (parsed.protocol === 'https:') return redirectHostAllowed(parsed.hostname)
  return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)
}

/** True for http://localhost and http://127.0.0.1, whatever the port. */
export function isLoopbackRedirect(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

/**
 * Does `given` match one of the registered redirect URIs? Exactly, except
 * that a loopback redirect matches whatever its port (RFC 8252 section 7.3:
 * a native app such as Claude Code listens on a port it picks each time).
 */
export function redirectMatches(registered: readonly string[], given: string): boolean {
  if (registered.includes(given)) return true
  if (!isLoopbackRedirect(given)) return false
  const want = new URL(given)
  return registered.some((uri) => {
    if (!isLoopbackRedirect(uri)) return false
    const have = new URL(uri)
    return have.hostname === want.hostname && have.pathname === want.pathname && have.search === want.search
  })
}

/** A client id that is a Client ID Metadata Document URL: https, with a path. */
export function isClientIdUrl(clientId: string): boolean {
  if (clientId.length > 2000 || !clientId.startsWith('https://')) return false
  try {
    const url = new URL(clientId)
    return url.protocol === 'https:' && url.pathname.length > 1 && !url.hash && !url.username && !url.password
  } catch {
    return false
  }
}

function ipv4Private(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number) as [number, number, number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 || // multicast, reserved, broadcast
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

/** True for any address a fetch from the server must never reach. */
export function privateAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return ipv4Private(ip)
  if (kind !== 6) return true
  const lower = ip.toLowerCase()
  const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return ipv4Private(mapped[1]!)
  if (lower === '::' || lower === '::1') return true
  const first = Number.parseInt(lower.split(':')[0] || '0', 16)
  return (
    (first & 0xfe00) === 0xfc00 || // unique local
    (first & 0xffc0) === 0xfe80 || // link-local
    (first & 0xff00) === 0xff00 || // multicast
    lower.startsWith('2001:db8:') ||
    lower.startsWith('::ffff:') ||
    first === 0 // the rest of ::/8: IPv4-compatible and reserved
  )
}

export interface ClientDocument {
  client_id: string
  client_name: string | null
  redirect_uris: string[]
}

export interface FetchDeps {
  fetch: typeof fetch
  lookup: (host: string) => Promise<Array<{ address: string }>>
}

const defaultDeps = (): FetchDeps => ({
  fetch: globalThis.fetch,
  lookup: (host) => dnsLookup(host, { all: true, verbatim: true }),
})

async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_DOCUMENT_BYTES) throw new Error('the client metadata document is too large')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error('the client metadata document is too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Fetch and check a Client ID Metadata Document. Throws an Error whose
 * message can be shown on the consent page.
 */
export async function fetchClientDocument(clientId: string, deps: FetchDeps = defaultDeps()): Promise<ClientDocument> {
  if (!isClientIdUrl(clientId)) throw new Error('a client id URL must be https with a path')
  const url = new URL(clientId)
  if (url.port && url.port !== '443') throw new Error('a client id URL must use the standard https port')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host }] : await deps.lookup(host).catch(() => [])
  if (addresses.length === 0) throw new Error(`could not resolve ${url.hostname}`)
  if (addresses.some((a) => privateAddress(a.address))) {
    throw new Error(`${url.hostname} resolves to a private address; a client must publish its document on the public internet`)
  }
  let response: Response
  try {
    response = await deps.fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
  } catch {
    throw new Error(`could not fetch the client metadata document at ${url.origin}`)
  }
  if (response.status !== 200) throw new Error(`the client metadata document answered ${response.status}`)
  let doc: unknown
  try {
    doc = JSON.parse(await readCapped(response))
  } catch (error) {
    throw error instanceof Error && error.message.includes('too large') ? error : new Error('the client metadata document is not JSON')
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('the client metadata document is not a JSON object')
  const { client_id: named, client_name: name, redirect_uris: uris, token_endpoint_auth_method: method } = doc as Record<string, unknown>
  if (named !== clientId) throw new Error('the client metadata document does not name itself: its client_id differs from its URL')
  // The document is the client's whole list; this server keeps the entries it would send a browser to.
  const allowed = Array.isArray(uris) ? uris.filter(redirectUriAllowed) : []
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20 || allowed.length === 0) {
    throw new Error(`the client metadata document must list 1 to 20 redirect URIs, at least one ${REDIRECT_RULE}`)
  }
  if (method !== undefined && method !== 'none') {
    throw new Error('this server takes Client ID Metadata Documents for public clients only (token_endpoint_auth_method "none")')
  }
  return {
    client_id: clientId,
    client_name: typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) || null : null,
    redirect_uris: allowed,
  }
}
