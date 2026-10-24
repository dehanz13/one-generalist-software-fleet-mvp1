// Where the connector may send a browser back to. Registration is open, so
// this rule is what keeps a stranger's client from leading the founder's
// sign-in to itself.
import { afterEach, describe, expect, it } from 'vitest'
import { type FetchDeps, fetchClientDocument, redirectHostAllowed, redirectUriAllowed } from './cimd'

describe('redirect hosts', () => {
  afterEach(() => {
    delete process.env.MATCHDAY_CONNECTOR_REDIRECTS
  })

  it("allows Claude's sites and this computer, and nothing else by default", () => {
    for (const ok of ['https://claude.ai/api/mcp/auth_callback', 'https://www.claude.com/cb', 'http://localhost:4040/callback']) {
      expect(redirectUriAllowed(ok), ok).toBe(true)
    }
    for (const bad of ['https://other.example/cb', 'https://claude.ai.evil.example/cb', 'https://notclaude.ai/cb', 'http://claude.ai/cb']) {
      expect(redirectUriAllowed(bad), bad).toBe(false)
    }
  })

  it('opens the hosts MATCHDAY_CONNECTOR_REDIRECTS names, or every https host with *', () => {
    process.env.MATCHDAY_CONNECTOR_REDIRECTS = 'other.example, Cursor.sh'
    expect(redirectUriAllowed('https://other.example/cb')).toBe(true)
    expect(redirectUriAllowed('https://app.cursor.sh/cb')).toBe(true)
    expect(redirectHostAllowed('evil.example')).toBe(false)
    process.env.MATCHDAY_CONNECTOR_REDIRECTS = '*'
    expect(redirectUriAllowed('https://evil.example/cb')).toBe(true)
    expect(redirectUriAllowed('http://evil.example/cb'), 'plain http stays loopback-only').toBe(false)
  })

  it('keeps the allowed entries of a client document and refuses one with none', async () => {
    const url = 'https://client.example/oauth/client.json'
    const deps = (doc: unknown): FetchDeps => ({
      fetch: (async () => new Response(JSON.stringify(doc), { status: 200 })) as typeof fetch,
      lookup: async () => [{ address: '93.184.216.35' }],
    })
    const doc = await fetchClientDocument(url, deps({ client_id: url, redirect_uris: ['https://claude.ai/cb', 'https://other.example/cb'] }))
    expect(doc.redirect_uris).toEqual(['https://claude.ai/cb'])
    await expect(fetchClientDocument(url, deps({ client_id: url, redirect_uris: ['https://other.example/cb'] }))).rejects.toThrow(/claude\.ai/)
  })
})
