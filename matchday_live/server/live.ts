/**
 * GET /api/live: server-sent events, so the browser never polls.
 *
 * Postgres cannot push to a function, so the function follows the event
 * table by cursor once a second and writes a line to the browser whenever
 * something landed. Each message's `id:` is the cursor: a reconnecting
 * EventSource sends it back as Last-Event-ID and resumes without a gap. The
 * stream closes itself after about four minutes, inside the function's time
 * limit, and the browser reconnects on its own.
 */
import type { Sql } from './db.js'
import { eventsPage, latestUpdate, matchDetail, matchRow } from './queries.js'

export interface LiveOptions {
  pollMs: number
  maxMs: number
  pingMs: number
}

export const LIVE_DEFAULTS: LiveOptions = { pollMs: 1000, maxMs: 240_000, pingMs: 15_000 }

/** One SSE message. `data` is JSON on a single line. */
export function sseMessage(event: string, data: unknown, id?: number): string {
  return `${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-store, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
}

export async function liveResponse(sql: Sql, request: Request, options: LiveOptions = LIVE_DEFAULTS): Promise<Response> {
  const url = new URL(request.url)
  const matchId = url.searchParams.get('match')
  const lastEventId = Number.parseInt(request.headers.get('last-event-id') ?? '', 10)
  const afterParam = Number.parseInt(url.searchParams.get('after') ?? '', 10)
  let cursor = Number.isFinite(lastEventId) ? lastEventId : Number.isFinite(afterParam) ? afterParam : 0

  if (matchId && !(await matchRow(sql, matchId))) {
    return new Response(JSON.stringify({ error: `no match ${matchId}` }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  const encoder = new TextEncoder()
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text))
      }
      const close = () => {
        if (closed) return
        closed = true
        if (timer) clearTimeout(timer)
        try {
          controller.close()
        } catch {
          // already closed by the client
        }
      }
      request.signal.addEventListener('abort', close)
      const started = Date.now()
      let lastPing = started
      let lastUpdated: string | null = null

      send('retry: 2000\n\n')
      if (matchId) {
        const detail = await matchDetail(sql, matchId)
        lastUpdated = detail?.match.updated_at ?? null
        if (detail) send(sseMessage('match', detail, cursor))
      } else {
        lastUpdated = await latestUpdate(sql)
      }

      const tick = async () => {
        if (closed) return
        try {
          if (matchId) {
            let page = await eventsPage(sql, matchId, cursor, 500)
            while (page.events.length) {
              cursor = page.cursor
              send(sseMessage('events', { events: page.events, cursor }, cursor))
              if (!page.has_more || closed) break
              page = await eventsPage(sql, matchId, cursor, 500)
            }
            const row = await matchRow(sql, matchId)
            if (row && row.updated_at !== lastUpdated) {
              lastUpdated = row.updated_at
              const detail = await matchDetail(sql, matchId)
              if (detail) send(sseMessage('match', detail, cursor))
            }
          } else {
            const updated = await latestUpdate(sql)
            if (updated !== lastUpdated) {
              lastUpdated = updated
              send(sseMessage('matches', { updated_at: updated }))
            }
          }
          if (Date.now() - lastPing >= options.pingMs) {
            lastPing = Date.now()
            send(sseMessage('ping', {}))
          }
        } catch (error) {
          send(sseMessage('problem', { error: error instanceof Error ? error.message.slice(0, 200) : 'read failed' }))
        }
        if (Date.now() - started >= options.maxMs) {
          close()
          return
        }
        timer = setTimeout(() => void tick(), options.pollMs)
      }
      timer = setTimeout(() => void tick(), options.pollMs)
    },
    cancel() {
      closed = true
      if (timer) clearTimeout(timer)
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}
