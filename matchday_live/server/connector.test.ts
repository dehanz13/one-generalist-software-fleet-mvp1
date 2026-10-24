/**
 * The connector's pieces that need no database: redirect rules, the SSRF
 * fence around client metadata documents, PKCE, the consent page's CSP, and
 * vercel.json agreeing with all of it.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fetchClientDocument, privateAddress, redirectMatches, redirectUriAllowed, type FetchDeps } from './cimd'
import { STYLE_HASH, consentCsp, consentPage, escapeHtml } from './consent-page'
import { authorizationServerMetadata, bearerChallenge, pkceMatches, protectedResourceMetadata, publicOrigin } from './oauth'

describe('redirect URIs', () => {
  it('registers https anywhere and http only on this computer', () => {
    expect(redirectUriAllowed('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(redirectUriAllowed('http://localhost/callback')).toBe(true)
    expect(redirectUriAllowed('http://127.0.0.1:8080/cb')).toBe(true)
    for (const bad of [
      'http://example.com/cb',
      'http://localhost.evil.example/cb',
      'https://claude.ai/cb#x',
      'https://user:pass@claude.ai/cb',
      'javascript:alert(1)',
      'myapp://callback',
      'not a url',
    ]) {
      expect(redirectUriAllowed(bad), bad).toBe(false)
    }
  })

  it('matches exactly, except a loopback port', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback', 'http://127.0.0.1/callback']
    expect(redirectMatches(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(redirectMatches(registered, 'http://localhost:3118/callback')).toBe(true)
    expect(redirectMatches(registered, 'http://127.0.0.1:50000/callback')).toBe(true)
    expect(redirectMatches(registered, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false)
    expect(redirectMatches(registered, 'https://claude.ai:8443/api/mcp/auth_callback')).toBe(false)
    expect(redirectMatches(registered, 'http://localhost:3118/other')).toBe(false)
    expect(redirectMatches(['https://claude.ai/cb'], 'http://localhost/cb')).toBe(false)
  })
})

describe('client metadata documents', () => {
  const url = 'https://client.example/oauth/metadata.json'
  const deps = (doc: unknown, address = '93.184.216.34', init: ResponseInit = {}): FetchDeps => ({
    lookup: async () => [{ address }],
    fetch: (async () => new Response(typeof doc === 'string' ? doc : JSON.stringify(doc), init)) as typeof fetch,
  })

  it('takes a document that names itself, keeping only its name and redirects', async () => {
    const doc = { client_id: url, client_name: 'Claude\u0007', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], logo_uri: 'x' }
    expect(await fetchClientDocument(url, deps(doc))).toEqual({
      client_id: url,
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    })
  })

  it('never fetches from a private address', async () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '172.20.0.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) {
      await expect(fetchClientDocument(url, deps({}, address)), address).rejects.toThrow(/private address/)
    }
    await expect(fetchClientDocument('https://10.0.0.1/doc.json', deps({}))).rejects.toThrow(/private address/)
    expect(privateAddress('93.184.216.34')).toBe(false)
    expect(privateAddress('2606:4700::1111')).toBe(false)
  })

  it('refuses a document that is not what it says', async () => {
    const ok = ['https://claude.ai/api/mcp/auth_callback']
    await expect(fetchClientDocument(url, deps({ client_id: 'https://other.example/x', redirect_uris: ok }))).rejects.toThrow(/name itself/)
    await expect(fetchClientDocument(url, deps({ client_id: url, redirect_uris: ['http://evil.example/cb'] }))).rejects.toThrow(/redirect/)
    await expect(fetchClientDocument(url, deps({ client_id: url, redirect_uris: ok, token_endpoint_auth_method: 'private_key_jwt' }))).rejects.toThrow(
      /public clients/,
    )
    await expect(fetchClientDocument(url, deps('x'.repeat(70 * 1024)))).rejects.toThrow(/too large/)
    await expect(fetchClientDocument(url, deps('not json'))).rejects.toThrow(/not JSON/)
    await expect(fetchClientDocument(url, deps({}, undefined, { status: 302 }))).rejects.toThrow(/302/)
    await expect(fetchClientDocument('http://client.example/doc.json', deps({}))).rejects.toThrow(/https/)
    await expect(fetchClientDocument('https://client.example:8443/doc.json', deps({}))).rejects.toThrow(/port/)
  })
})

describe('PKCE', () => {
  it('takes only the S256 transform of the verifier', () => {
    const verifier = 'a'.repeat(43)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(pkceMatches(verifier, challenge)).toBe(true)
    expect(pkceMatches('b'.repeat(43), challenge)).toBe(false)
    expect(pkceMatches(verifier, verifier)).toBe(false) // "plain"
    expect(pkceMatches('short', createHash('sha256').update('short').digest('base64url'))).toBe(false)
  })
})

describe('the consent page', () => {
  it('escapes everything a client chose, and runs no script', () => {
    const html = consentPage({
      clientName: '<img src=x onerror=alert(1)>',
      clientId: 'mdcl_x"><script>',
      redirectHost: 'claude.ai',
      loopbackOnly: false,
      hidden: { state: '"><script>alert(1)</script>' },
      error: null,
    })
    expect(html).not.toContain('<img')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('lets the form lead only here and to a plain redirect origin', () => {
    expect(consentCsp('https://claude.ai')).toContain("form-action 'self' https://claude.ai;")
    expect(consentCsp('http://localhost:3118')).toContain("form-action 'self' http://localhost:3118;")
    expect(consentCsp('https://a;script-src')).toContain("form-action 'self';")
    expect(consentCsp(null)).toContain(`style-src ${STYLE_HASH}`)
  })
})

describe('discovery', () => {
  it('takes its origin from MATCHDAY_PUBLIC_URL, else the request', () => {
    const url = new URL('http://localhost/api/router?route=oauth/token')
    expect(publicOrigin(url)).toBe('http://localhost')
    process.env.MATCHDAY_PUBLIC_URL = 'https://matchday.example.com/'
    expect(publicOrigin(url)).toBe('https://matchday.example.com')
    process.env.MATCHDAY_PUBLIC_URL = 'http://matchday.example.com'
    expect(publicOrigin(url)).toBe('http://localhost') // plain http elsewhere is ignored
    delete process.env.MATCHDAY_PUBLIC_URL
  })

  it('names one resource and one issuer, the same origin', () => {
    const origin = 'https://matchday.example'
    expect(protectedResourceMetadata(origin)).toMatchObject({ resource: `${origin}/api/mcp`, authorization_servers: [origin] })
    const as = authorizationServerMetadata(origin)
    expect(as.issuer).toBe(origin)
    expect(as.grant_types_supported).not.toContain('implicit')
    expect(as.scopes_supported).not.toContain('offline_access')
    expect(bearerChallenge(origin)).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="matchday"`,
    )
  })
})

describe('vercel.json', () => {
  const config = JSON.parse(readFileSync(join(__dirname, '..', 'vercel.json'), 'utf8')) as {
    rewrites: Array<{ source: string; destination: string }>
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  }
  const headersFor = (source: string) => config.headers.find((h) => h.source === source)?.headers ?? []

  it('sends the connector’s paths to the router before the page takes the rest', () => {
    const order = config.rewrites.map((r) => r.source)
    const spa = order.indexOf('/((?!api/|assets/|demo/|fonts/|oauth/|\\.well-known/).*)')
    expect(spa).toBe(order.length - 1)
    const catchAll = order.indexOf('/api/:path*')
    for (const source of ['/.well-known/:path*', '/oauth/:path*', '/api/mcp', '/api/fleet/:path*']) {
      expect(order.indexOf(source), source).toBeGreaterThan(-1)
      expect(order.indexOf(source), source).toBeLessThan(catchAll)
    }
    expect(config.rewrites.find((r) => r.source === '/oauth/:path*')!.destination).toBe('/api/router?route=oauth/:path*')
  })

  it('gives the consent page its own CSP, with the style hash the page uses', () => {
    const page = headersFor('/(.*)')
    expect(page.map((h) => h.key)).not.toContain('Content-Security-Policy')
    const site = headersFor('/((?!oauth/).*)').find((h) => h.key === 'Content-Security-Policy')!.value
    expect(site).toContain("form-action 'self'")
    const oauth = headersFor('/oauth/(.*)')
    const csp = oauth.find((h) => h.key === 'Content-Security-Policy')!.value
    expect(csp).toContain(`style-src ${STYLE_HASH}`)
    expect(csp).toContain("default-src 'none'")
    expect(oauth.find((h) => h.key === 'Cache-Control')!.value).toBe('no-store')
  })
})
