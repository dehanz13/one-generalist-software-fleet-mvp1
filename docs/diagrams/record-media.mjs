// Records the README's screenshots and looping GIFs from Matchday Live's own
// demo, in headless Chromium, so they always show the page as it is built.
//
//   ogsf var --no-open            # or `ogsf demo --serve`, in another terminal
//   npm run media                 # from docs/diagrams/
//   npm run media -- http://127.0.0.1:4600/?demo   # another address
//
// Writes docs/media/*.png and docs/media/*.gif. Nothing here is shipped:
// the page never depends on this folder.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import gifenc from 'gifenc'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

// gifenc ships CommonJS only.
const { GIFEncoder, applyPalette, quantize } = gifenc

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'media')
const base = process.argv[2] ?? 'http://127.0.0.1:4600/?demo'

// 1280×800 laid out, drawn at 0.75: 960×600 frames, about the width GitHub
// shows a README image at, so nothing is scaled twice.
const VIEW = { width: 1280, height: 800 }
const SCALE = 0.75
const FPS = 6

const browser = await chromium.launch()
await mkdir(out, { recursive: true })

/** A fresh page on the demo, light theme, walkthrough not yet seen unless asked. */
async function open(hash = '', { tour = false } = {}) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: 'light', reducedMotion: 'no-preference' })
  await context.addInitScript((tour) => {
    try {
      localStorage.setItem('matchday.theme', 'light')
      if (!tour) localStorage.setItem('matchday.tour-seen', '1')
      else localStorage.removeItem('matchday.tour-seen')
    } catch {}
  }, tour)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base + hash)
  await page.waitForSelector('[data-tour="demo-bar"]')
  return { page, context, errors }
}

const clickSpeed = (page, label) => page.locator('[aria-label="Replay speed"] button', { hasText: label }).click()

/** Records frames while `script` runs, then writes a looping GIF. */
async function gif(name, page, script) {
  const frames = []
  let recording = true
  const loop = (async () => {
    while (recording) {
      const started = Date.now()
      frames.push({ png: await page.screenshot({ type: 'png' }), at: started })
      const wait = 1000 / FPS - (Date.now() - started)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    }
  })()
  await script()
  recording = false
  await loop

  const encoder = GIFEncoder()
  let kept = 0
  let previous = null
  for (let i = 0; i < frames.length; i++) {
    // A frame identical to the one before only lengthens it.
    if (i > 0 && frames[i].png.equals(frames[i - 1].png)) continue
    let j = i + 1
    while (j < frames.length && frames[j].png.equals(frames[i].png)) j++
    const delay = Math.max(20, Math.round((j < frames.length ? frames[j].at : frames[j - 1].at + 1000 / FPS) - frames[i].at))
    const { width, height, data } = PNG.sync.read(frames[i].png)
    // 255 colours and one transparent index: a pixel that did not change
    // since the last frame is left transparent, so the last frame shows
    // through and the long runs of it compress to almost nothing.
    const palette = quantize(data, 255)
    const transparentIndex = palette.length
    palette.push([0, 0, 0])
    const index = applyPalette(data, palette.slice(0, transparentIndex))
    if (previous) {
      for (let p = 0, q = 0; p < index.length; p++, q += 4) {
        if (data[q] === previous[q] && data[q + 1] === previous[q + 1] && data[q + 2] === previous[q + 2]) index[p] = transparentIndex
      }
    }
    encoder.writeFrame(index, width, height, previous
      ? { palette, delay, transparent: true, transparentIndex, dispose: 1 }
      : { palette, delay, repeat: 0, dispose: 1 })
    previous = data
    kept++
  }
  encoder.finish()
  const bytes = encoder.bytes()
  await writeFile(join(out, `${name}.gif`), bytes)
  console.log(`${name}.gif  ${kept} frames  ${(bytes.length / 1e6).toFixed(1)} MB`)
}

/** A PNG of the page or one part of it, without the demo bar floating over it. */
async function still(name, page, locator) {
  const target = locator ? page.locator(locator).first() : page
  const png = await target.screenshot({ type: 'png', animations: 'disabled', style: '.demo-bar { display: none !important; }' })
  await writeFile(join(out, `${name}.png`), png)
  console.log(`${name}.png`)
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// 1 · The guided walkthrough, every step.
{
  const { page, context, errors } = await open('', { tour: true })
  await page.waitForSelector('.tour', { timeout: 10_000 })
  await gif('walkthrough', page, async () => {
    const steps = Number((await page.locator('.tour-step').innerText()).match(/of (\d+)/)[1])
    for (let i = 0; i < steps; i++) {
      await pause(2600)
      if (i < steps - 1) await page.keyboard.press('ArrowRight')
    }
  })
  if (errors.length) throw new Error(`walkthrough: ${errors.join('; ')}`)
  await context.close()
}

// 2 · A run-heroic match playing (the whole team): the scoreboard, the lanes
// and the live feed filling in. Fast-forward to its kick-off, then watch at 10×.
{
  const { page, context, errors } = await open()
  await clickSpeed(page, '300×')
  const heroic = page.locator('[data-tour="matches"] a[href^="#/m/"]', { hasText: 'run-heroic' }).first()
  await heroic.waitFor({ timeout: 60_000 })
  await clickSpeed(page, '10×')
  await heroic.click()
  await page.waitForSelector('[data-tour="scoreboard"]')
  await gif('match-live', page, () => pause(18_000))
  if (errors.length) throw new Error(`match-live: ${errors.join('; ')}`)
  await context.close()
}

// 3 · The week ends; daily reports, then a multi-day report across it.
{
  const { page, context, errors } = await open()
  await page.locator('[aria-label="Replay speed"] button', { hasText: 'End' }).click()
  await page.goto(base + '#/days')
  await page.waitForSelector('.day-card')
  await still('daily-report', page, '.day-card')
  await gif('reports', page, async () => {
    await pause(1500)
    await page.mouse.wheel(0, 500)
    await pause(1500)
    await page.mouse.wheel(0, -500)
    await pause(800)
    const boxes = page.locator('.day-card input[type="checkbox"]')
    const n = await boxes.count()
    for (let i = 0; i < n; i++) {
      await boxes.nth(i).check()
      await pause(450)
    }
    await pause(900)
    await page.locator('.pick-bar button.primary').click()
    await page.waitForSelector('#agents-title')
    await pause(1500)
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 380)
      await pause(900)
    }
    await pause(1200)
  })
  await page.evaluate(() => window.scrollTo(0, 0))
  await still('agent-performance', page, '.report-page section:has(#agents-title)')
  await still('cost-per-day', page, '.report-page section:has(h2:text-is("Cost and matches per day"))')
  if (errors.length) throw new Error(`reports: ${errors.join('; ')}`)
  await context.close()
}

// 4 · Upcoming Matches: tickets fall due, get queued and played, at 300×.
{
  const { page, context, errors } = await open('#/upcoming')
  await clickSpeed(page, '300×')
  await page.waitForSelector('.sprint')
  await gif('upcoming', page, () => pause(14_000))
  await page.locator('[aria-label="Replay speed"] button', { hasText: 'End' }).click()
  await pause(800)
  await still('upcoming-board', page, '.sprint')
  if (errors.length) throw new Error(`upcoming: ${errors.join('; ')}`)
  await context.close()
}

// 5 · A finished run-heroic match (the whole team plays it), for the README's first picture.
{
  const { page, context, errors } = await open()
  await page.locator('[aria-label="Replay speed"] button', { hasText: 'End' }).click()
  await page.locator('[data-tour="matches"] a[href^="#/m/"]', { hasText: 'run-heroic' }).first().click()
  await page.waitForSelector('[data-tour="scoreboard"]')
  await pause(800)
  await still('match', page)
  if (errors.length) throw new Error(`match: ${errors.join('; ')}`)
  await context.close()
}

await browser.close()
