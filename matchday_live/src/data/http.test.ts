import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpSource } from './http'
import { ApiFailure, isMissingRoute } from './source'

type Call = { url: string; method: string; body: unknown; credentials: RequestCredentials | undefined }

function serve(answer: (call: Call) => Response): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, credentials: init.credentials }
      calls.push(call)
      return answer(call)
    }),
  )
  return calls
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('the version 2 routes over HTTP', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks the contract’s routes', async () => {
    const calls = serve(() => json([]))
    const source = new HttpSource('/api/', 'here', 'Cloud store')
    await source.reportFacts('2026-10-12T05:00:00.000+00:00', '2026-10-17T05:00:00.000+00:00')
    await source.upcoming()
    await source.requests()
    await source.createRequest({ kind: 'ticket', ticket_id: 'KICK-7' })
    await source.cancelRequest('req_abc')
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/report-facts?since=2026-10-12T05%3A00%3A00.000%2B00%3A00&until=2026-10-17T05%3A00%3A00.000%2B00%3A00',
      'GET /api/upcoming',
      'GET /api/requests?limit=50',
      'POST /api/requests',
      'POST /api/requests/req_abc/cancel',
    ])
    expect(calls[3]!.body).toEqual({ kind: 'ticket', ticket_id: 'KICK-7' })
    expect(calls[0]!.credentials).toBe('same-origin')
  })

  it('reads a fleet at another address without cookies', async () => {
    const calls = serve(() => json([]))
    await new HttpSource('http://127.0.0.1:4600/api', 'fleet', 'Fleet').upcoming()
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:4600/api/upcoming', credentials: 'omit' })
  })

  it('tells an older server apart: a 404, or a page where data was expected', async () => {
    serve(() => json({ error: 'not found' }, 404))
    const missing = await new HttpSource('/api', 'here', '').upcoming().catch((e: unknown) => e)
    expect(isMissingRoute(missing)).toBe(true)

    serve(() => new Response('<!doctype html><title>Matchday Live</title>', { status: 200, headers: { 'content-type': 'text/html' } }))
    const page = await new HttpSource('/api', 'here', '').requests().catch((e: unknown) => e)
    expect(isMissingRoute(page)).toBe(true)
  })

  it('passes the server’s own reason on', async () => {
    serve(() => json({ error: 'origin http://x may not read this fleet' }, 403))
    const refused = await new HttpSource('/api', 'here', '').createRequest({ kind: 'set_piece', set_piece: 'ask', prompt: 'hi' }).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(ApiFailure)
    expect(refused).toMatchObject({ status: 403, message: 'origin http://x may not read this fleet' })
    expect(isMissingRoute(refused)).toBe(false)
  })
})
