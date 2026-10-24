/** Small response helpers shared by every route. */

export const NO_STORE = { 'cache-control': 'no-store' }

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...headers },
  })
}

/** An error the caller can act on: say what to do next. */
export function fail(status: number, error: string, headers: Record<string, string> = {}): Response {
  return json({ error }, status, headers)
}

/** Read a JSON body of at most `maxBytes`. Returns the value, or a Response to send back. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown | Response> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > maxBytes) return fail(413, `the body is over ${maxBytes} bytes; send fewer rows per request`)
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return fail(413, `the body is over ${maxBytes} bytes; send fewer rows per request`)
  }
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return fail(400, 'the body is not valid JSON')
  }
}

/** Ids and names become path segments and SQL parameters; anything odd is refused. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,200}$/

export function safeSegment(value: string): boolean {
  return SAFE_SEGMENT.test(value) && value !== '.' && value !== '..'
}

export function intParam(url: URL, key: string, fallback: number): number {
  const raw = url.searchParams.get(key)
  if (raw === null || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}
