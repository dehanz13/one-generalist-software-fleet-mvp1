/**
 * Every /api route but /api/live, as one Vercel Function (Node.js runtime,
 * Web-standard fetch handler). vercel.json rewrites /api/:path* here with the
 * path in `?route=`. See server/routes.ts.
 */
import { handle } from '../server/routes.js'

export default { fetch: handle }
