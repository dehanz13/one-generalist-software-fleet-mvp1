/**
 * GET /api/live: the server-sent event stream, as its own Vercel Function so
 * it can run for up to five minutes (vercel.json `functions`). See server/live.ts.
 */
import { handle } from '../server/routes.js'

export default { fetch: handle }
