/// <reference types="vitest/config" />
import { Readable } from 'node:stream'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'

// Two ways to give `npm run dev` a real API:
//   MATCHDAY_PROXY=http://127.0.0.1:4600 npm run dev
//     sends /api to a Mac's `ogsf var`.
//   MATCHDAY_DEV_API=1 DATABASE_URL=... MATCHDAY_PASSWORD=... MATCHDAY_SESSION_SECRET=... npm run dev
//     runs the Vercel Functions' own code (server/routes.ts) inside Vite, against Supabase,
//     for /api, /oauth and /.well-known alike.
// With neither, the page plays the demo recording.
const proxy = process.env.MATCHDAY_PROXY

function devApi(): Plugin {
  return {
    name: 'matchday-dev-api',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      if (!process.env.MATCHDAY_DEV_API) return
      // The connector's OAuth endpoints live outside /api; the router reads the route from the path.
      const served = ['/api/', '/oauth/', '/.well-known/']
      server.middlewares.use(async (req, res, next) => {
        if (!served.some((prefix) => req.url?.startsWith(prefix))) return next()
        try {
          const { handle } = (await server.ssrLoadModule('/server/routes.ts')) as {
            handle: (request: Request) => Promise<Response>
          }
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const controller = new AbortController()
          req.on('close', () => controller.abort())
          const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
            method: req.method ?? 'GET',
            headers: Object.entries(req.headers).flatMap(([k, v]) =>
              v === undefined ? [] : Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]],
            ),
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
            signal: controller.signal,
          })
          const response = await handle(request)
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          if (response.body) Readable.fromWeb(response.body as never).pipe(res)
          else res.end()
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devApi()],
  base: './',
  server: {
    port: 5173,
    ...(proxy ? { proxy: { '/api': { target: proxy, changeOrigin: true } } } : {}),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
  },
})
