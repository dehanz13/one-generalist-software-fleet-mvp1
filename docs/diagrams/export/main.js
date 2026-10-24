// The export page: builds every scene in ../scenes with Excalidraw's own
// convertToExcalidrawElements, serialises it as a .excalidraw file and
// renders it with Excalidraw's own exportToSvg (fonts embedded). export.mjs
// opens this page headless and writes what window.__run returns.
import { convertToExcalidrawElements, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw'

const modules = import.meta.glob('../scenes/*.mjs', { eager: true })
const scenes = Object.values(modules).filter((m) => typeof m.name === 'string' && typeof m.build === 'function')

const LIGHT_BACKGROUND = '#ffffff'

// Labels are measured when the elements are made, so Excalifont must be in
// the document first, or every box is sized for a fallback face. This is the
// Latin face, with the range Excalidraw 0.18.1 itself declares for it.
const EXCALIFONT_LATIN = {
  url: '/node_modules/@excalidraw/excalidraw/dist/prod/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2',
  unicodeRange:
    'U+20-7e,U+a0-a3,U+a5-a6,U+a8-ab,U+ad-b1,U+b4,U+b6-b8,U+ba-ff,U+131,U+152-153,U+2bc,U+2c6,U+2da,U+2dc,U+304,U+308,' +
    'U+2013-2014,U+2018-201a,U+201c-201e,U+2020,U+2022,U+2024-2026,U+2030,U+2039-203a,U+20ac,U+2122,U+2212',
}

async function loadExcalifont() {
  const face = new FontFace('Excalifont', `url(${EXCALIFONT_LATIN.url})`, { unicodeRange: EXCALIFONT_LATIN.unicodeRange })
  await face.load()
  document.fonts.add(face)
  await document.fonts.ready
}

// ── dark ─────────────────────────────────────────────────────────────────────
// Excalidraw's dark export only sets `filter="invert(93%) hue-rotate(180deg)"`
// on the <svg>. That is a CSS filter on an SVG root, which not every viewer
// applies to an <img>. The same filter is applied here to every colour
// instead, so the dark file is dark wherever it is shown.

const HUE_180 = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
]

function clamp(x) {
  return Math.min(1, Math.max(0, x))
}

function parseHex(value) {
  const hex = value.trim().replace('#', '')
  if (hex.length === 3) return [...hex].map((c) => parseInt(c + c, 16) / 255)
  if (hex.length === 6 || hex.length === 8) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return null
}

function toHex(rgb) {
  return `#${rgb.map((c) => Math.round(clamp(c) * 255).toString(16).padStart(2, '0')).join('')}`
}

export function darken(value) {
  if (!value || !value.trim().startsWith('#')) return value
  const rgb = parseHex(value)
  if (!rgb) return value
  const inverted = rgb.map((c) => 0.93 * (1 - c) + 0.07 * c)
  return toHex(HUE_180.map((row) => clamp(row[0] * inverted[0] + row[1] * inverted[1] + row[2] * inverted[2])))
}

function bakeDark(svg) {
  svg.removeAttribute('filter')
  for (const el of svg.querySelectorAll('*')) {
    // A mask's black and white are what hides the line under an arrow's
    // label, not colours anyone sees.
    if (el.closest('mask')) continue
    for (const attr of ['fill', 'stroke', 'stop-color']) {
      const value = el.getAttribute(attr)
      if (value) el.setAttribute(attr, darken(value))
    }
  }
  return svg
}

// ── run ──────────────────────────────────────────────────────────────────────

window.__scenes = scenes.map((s) => s.name)

window.__run = async (name) => {
  const scene = scenes.find((s) => s.name === name)
  if (!scene) throw new Error(`no scene ${name}`)
  const skeleton = scene.build()
  const bad = outsideFont(skeleton)
  if (bad.length) throw new Error(`${name}: characters outside Excalifont's Latin face in ${JSON.stringify(bad)}`)
  const elements = convertToExcalidrawElements(skeleton, { regenerateIds: false })
  const appState = { exportBackground: true, viewBackgroundColor: LIGHT_BACKGROUND, exportEmbedScene: false }
  const light = await exportToSvg({ elements, appState, files: {}, exportPadding: 24 })
  const dark = bakeDark(
    await exportToSvg({ elements, appState: { ...appState, exportWithDarkMode: true }, files: {}, exportPadding: 24 }),
  )
  for (const svg of [light, dark]) {
    svg.setAttribute('role', 'img')
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = scene.title
    svg.prepend(title)
  }
  const json = serializeAsJSON(elements, { viewBackgroundColor: LIGHT_BACKGROUND, gridSize: null }, {}, 'local')
  return { title: scene.title, light: light.outerHTML, dark: dark.outerHTML, json, count: elements.length }
}

// Every character a diagram uses must be in the embedded face: another one
// would be drawn by whatever font the viewer's machine has.
function outsideFont(items) {
  const allowed = /^[\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018-\u201e\u2022\u2026\n]*$/
  const texts = items.flatMap((el) => [el.text, el.label?.text]).filter(Boolean)
  return texts.filter((t) => !allowed.test(t))
}

await loadExcalifont()
window.__ready = true
