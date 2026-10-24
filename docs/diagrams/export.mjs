// Re-exports every diagram: `npm run export` (see README.md).
//
// Serves ./export/index.html with Vite, opens it in headless Chromium and,
// for each scene in ./scenes, writes:
//   <name>.excalidraw   the scene, to open and edit in Excalidraw
//   <name>.svg          Excalidraw's own SVG export, fonts embedded, light
//   <name>.dark.svg     the same, dark
// Nothing leaves this machine: every request that is not to the local Vite
// server is refused, so a missing font fails loudly instead of being fetched.
//
//   node export.mjs                    every scene
//   node export.mjs components         one scene
//   node export.mjs --preview <dir>    also a PNG of each, to look at
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = 5199
const ORIGIN = `http://localhost:${PORT}`

const args = process.argv.slice(2)
const previewAt = args.indexOf('--preview')
const previewDir = previewAt === -1 ? null : args[previewAt + 1]
const only = args.filter((a, i) => !a.startsWith('--') && (previewAt === -1 || i !== previewAt + 1))

const server = await createServer({
  root: here,
  logLevel: 'error',
  server: { port: PORT, strictPort: true, fs: { allow: [here] } },
})
await server.listen()

const browser = await chromium.launch()
let failed = false
try {
  const page = await browser.newPage()
  const outward = []
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith(ORIGIN)) return route.continue()
    outward.push(url)
    return route.abort()
  })
  page.on('pageerror', (err) => {
    failed = true
    console.error('page error:', err.message)
  })
  await page.goto(`${ORIGIN}/export/index.html`)
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 })
  const names = await page.evaluate(() => window.__scenes)
  const wanted = only.length ? names.filter((n) => only.includes(n)) : names
  if (only.length && wanted.length !== only.length) {
    throw new Error(`unknown scene(s): ${only.filter((n) => !names.includes(n)).join(', ')} (have: ${names.join(', ')})`)
  }

  for (const name of wanted) {
    const out = await page.evaluate((n) => window.__run(n), name)
    await writeFile(join(here, `${name}.excalidraw`), out.json + '\n')
    await writeFile(join(here, `${name}.svg`), out.light + '\n')
    await writeFile(join(here, `${name}.dark.svg`), out.dark + '\n')
    console.log(`${name}: ${out.count} elements, ${(out.light.length / 1024).toFixed(0)} KB svg`)
    if (previewDir) {
      for (const [variant, svg] of [
        ['light', out.light],
        ['dark', out.dark],
      ]) {
        const shot = await browser.newPage({ deviceScaleFactor: 1 })
        await shot.route('**/*', (route) => route.abort())
        await shot.setContent(`<body style="margin:0;background:#888">${svg}</body>`)
        await shot.locator('svg').first().screenshot({ path: join(previewDir, `ogsf-diagram-${name}-${variant}.png`) })
        await shot.close()
      }
    }
  }
  if (outward.length) {
    failed = true
    console.error(`refused ${outward.length} request(s) that would have left this machine:\n  ${outward.join('\n  ')}`)
  }
} finally {
  await browser.close()
  await server.close()
}
if (failed) process.exit(1)
