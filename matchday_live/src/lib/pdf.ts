/**
 * Reports as PDF: real vector pages (text stays text, charts are paths) with
 * the page's own fonts embedded and subset, so the file looks the same
 * offline and on any machine. Built with pdf-lib, loaded only when someone
 * downloads one (see download.ts).
 *
 * A4 landscape, so the agent performance table fits its fourteen columns.
 */
import fontkit from '@pdf-lib/fontkit'
import { type Color, PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import {
  type AgentPerformance,
  type DayReport,
  type MatchLine,
  type ModelUse,
  type Notable,
  type RangeReport,
  type SetPieceUse,
  type Totals,
  compact,
  duration,
  longDate,
  money,
  percent,
} from '../../shared/report'
import { PLAYER_PALETTE } from './events'
import { clockIn, countMax, dailySeries, dayClockIn, dayTimeline, niceMax, playerTint, zoneLabel } from './report-view'

export interface PdfFonts {
  body: Uint8Array
  bold: Uint8Array
  heading: Uint8Array
  mono: Uint8Array
}

export type PdfReport = (
  | { kind: 'day'; day: DayReport; timeZone: string; generatedAt: Date }
  | { kind: 'range'; report: RangeReport; from: string; to: string }
) & {
  /** Each player's colour (see playerColors), so the PDF matches the page. */
  colors?: Record<string, string>
}

type Colors = Record<string, string> | undefined

function colorOf(player: string, colors: Colors): Color {
  return hex(colors?.[player] ?? playerTint(player, PLAYER_PALETTE))
}

// ── page and colours ─────────────────────────────────────────────────────────

const PAGE_W = 842
const PAGE_H = 595
const MARGIN = 40
const TOP = 62
const BOTTOM = 46
const CONTENT_W = PAGE_W - MARGIN * 2

function hex(value: string): Color {
  const n = Number.parseInt(value.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const C = {
  ink: hex('#0f2236'),
  ink2: hex('#435568'),
  ink3: hex('#6b7d90'),
  line: hex('#d6dee7'),
  zebra: hex('#f2f5f9'),
  head: hex('#e3ebfb'),
  accent: hex('#2156d1'),
  good: hex('#16794c'),
  goodSoft: hex('#e1f2e8'),
  bad: hex('#c42a3e'),
  badSoft: hex('#fbe6e9'),
  warn: hex('#a96a0d'),
  warnSoft: hex('#fbf0d8'),
  live: hex('#1f63e0'),
  liveSoft: hex('#e2ecfd'),
  board: hex('#0e1f33'),
  boardDim: hex('#9fb1c5'),
  amber: hex('#ffb12a'),
  amberInk: hex('#b4690e'),
  white: rgb(1, 1, 1),
}

const OUTCOME: Record<string, { ink: Color; soft: Color }> = {
  touchdown: { ink: C.good, soft: C.goodSoft },
  turnover: { ink: C.bad, soft: C.badSoft },
  abandoned: { ink: C.warn, soft: C.warnSoft },
  running: { ink: C.live, soft: C.liveSoft },
}

function outcomeColor(outcome: string): { ink: Color; soft: Color } {
  return OUTCOME[outcome] ?? { ink: C.ink3, soft: C.zebra }
}

/**
 * The bundled fonts carry the Latin set. Anything else (an arrow, an emoji, a
 * CJK character in an ask) is swapped for something they can draw.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/[✓✔]/g, 'ok')
    .replace(/[✗✘]/g, 'x')
    .replace(/\t/g, '  ')
    .replace(/[^ -ÿıŒœˆ˚˜ -⁯€™−]/gu, '?')
}

// ── the writer ───────────────────────────────────────────────────────────────

interface Fonts {
  body: PDFFont
  bold: PDFFont
  heading: PDFFont
  mono: PDFFont
}

type FontName = keyof Fonts

export interface Cell {
  text: string
  font?: FontName
  color?: Color
  /** A pill behind the text, like the page's status chips. */
  chip?: { ink: Color; soft: Color }
}

interface Column {
  label: string
  weight: number
  align?: 'l' | 'r'
}

class Writer {
  readonly pages: PDFPage[] = []
  page!: PDFPage
  y = 0

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.newPage()
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.pages.push(this.page)
    this.y = PAGE_H - TOP
  }

  /** Start a new page unless `height` still fits on this one. */
  ensure(height: number): void {
    if (this.y - height < BOTTOM) this.newPage()
  }

  gap(height: number): void {
    this.y -= height
  }

  width(text: string, font: FontName, size: number): number {
    return this.fonts[font].widthOfTextAtSize(text, size)
  }

  /** Greedy word wrap; a word longer than the line is cut. */
  wrap(raw: string, font: FontName, size: number, maxWidth: number): string[] {
    const text = pdfSafe(raw)
    const lines: string[] = []
    for (const para of text.split(/\n/)) {
      let line = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word
        if (this.width(next, font, size) <= maxWidth) {
          line = next
          continue
        }
        if (line) lines.push(line)
        let rest = word
        while (this.width(rest, font, size) > maxWidth && rest.length > 1) {
          // Break after a hyphen, slash or underscore when one fits; else cut the word.
          let cut = rest.length - 1
          while (cut > 1 && this.width(rest.slice(0, cut), font, size) > maxWidth) cut--
          const soft = Math.max(rest.lastIndexOf('-', cut - 1), rest.lastIndexOf('/', cut - 1), rest.lastIndexOf('_', cut - 1))
          if (soft > 0) cut = soft + 1
          lines.push(rest.slice(0, cut))
          rest = rest.slice(cut)
        }
        line = rest
      }
      lines.push(line)
    }
    return lines
  }

  /** At most `max` lines, the last one ending in an ellipsis if cut. */
  clamp(lines: string[], max: number, font: FontName, size: number, maxWidth: number): string[] {
    if (lines.length <= max) return lines
    const kept = lines.slice(0, max)
    let last = `${kept[max - 1] ?? ''}…`
    while (last.length > 1 && this.width(last, font, size) > maxWidth) last = `${last.slice(0, -2)}…`
    kept[max - 1] = last
    return kept
  }

  draw(text: string, x: number, baseline: number, font: FontName, size: number, color: Color = C.ink): void {
    this.page.drawText(pdfSafe(text), { x, y: baseline, size, font: this.fonts[font], color })
  }

  roundRect(x: number, top: number, w: number, h: number, r: number, color: Color): void {
    const rr = Math.min(r, h / 2, w / 2)
    const path = `M ${rr} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} V ${h - rr} A ${rr} ${rr} 0 0 1 ${w - rr} ${h} H ${rr} A ${rr} ${rr} 0 0 1 0 ${h - rr} V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`
    this.page.drawSvgPath(path, { x, y: top, color, borderWidth: 0 })
  }

  paragraph(text: string, options: { size?: number; font?: FontName; color?: Color; width?: number; x?: number } = {}): void {
    const size = options.size ?? 10
    const font = options.font ?? 'body'
    const lineHeight = size * 1.38
    const lines = this.wrap(text, font, size, options.width ?? CONTENT_W)
    for (const line of lines) {
      this.ensure(lineHeight)
      this.draw(line, options.x ?? MARGIN, this.y - size, font, size, options.color ?? C.ink)
      this.y -= lineHeight
    }
  }

  heading(text: string, level: 1 | 2 | 3): void {
    const size = level === 1 ? 24 : level === 2 ? 16 : 12.5
    const before = level === 1 ? 0 : level === 2 ? 14 : 10
    // Keep a heading with at least a few lines of what follows it.
    this.ensure(before + size + 60)
    this.y -= before
    this.draw(level === 3 ? text : text.toUpperCase(), MARGIN, this.y - size * 0.82, 'heading', size, level === 3 ? C.ink2 : C.ink)
    this.y -= size + (level === 1 ? 8 : 6)
    if (level === 2) {
      this.page.drawLine({ start: { x: MARGIN, y: this.y + 2 }, end: { x: MARGIN + CONTENT_W, y: this.y + 2 }, thickness: 0.6, color: C.line })
      this.y -= 6
    }
  }

  /** Key figures in a grid of tiles. */
  figures(items: Array<{ label: string; value: string; note?: string; tone?: Color }>): void {
    const perRow = 6
    const gap = 8
    const w = (CONTENT_W - gap * (perRow - 1)) / perRow
    const h = 48
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(h + gap)
      items.slice(i, i + perRow).forEach((item, j) => {
        const x = MARGIN + j * (w + gap)
        this.roundRect(x, this.y, w, h, 5, C.zebra)
        this.page.drawRectangle({ x, y: this.y - h, width: 3, height: h, color: item.tone ?? C.accent })
        this.draw(item.label.toUpperCase(), x + 10, this.y - 13, 'bold', 6.8, C.ink3)
        const value = this.clamp([pdfSafe(item.value)], 1, 'heading', 17, w - 16)[0] ?? ''
        this.draw(value, x + 10, this.y - 31, 'heading', 17, item.tone ?? C.ink)
        if (item.note) {
          const note = this.clamp([pdfSafe(item.note)], 1, 'body', 7, w - 16)[0] ?? ''
          this.draw(note, x + 10, this.y - 42, 'body', 7, C.ink2)
        }
      })
      this.y -= h + gap
    }
  }

  /** A table with a tinted head row, zebra stripes and the head repeated on each new page. */
  table(columns: Column[], rows: Array<Array<string | Cell>>, options: { size?: number; maxLines?: number; empty?: string } = {}): void {
    const size = options.size ?? 8.4
    const maxLines = options.maxLines ?? 2
    const lineHeight = size * 1.3
    const padX = 5
    const padY = 4
    const total = columns.reduce((sum, c) => sum + c.weight, 0)
    const widths = columns.map((c) => (c.weight / total) * CONTENT_W)
    const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0))

    const headLines = columns.map((c, i) => this.clamp(this.wrap(c.label, 'bold', size - 0.6, (widths[i] ?? 0) - padX * 2), 2, 'bold', size - 0.6, (widths[i] ?? 0) - padX * 2))
    const headHeight = Math.max(...headLines.map((l) => l.length)) * lineHeight + padY * 2

    const drawHead = () => {
      this.page.drawRectangle({ x: MARGIN, y: this.y - headHeight, width: CONTENT_W, height: headHeight, color: C.head })
      columns.forEach((c, i) => {
        const lines = headLines[i] ?? []
        lines.forEach((line, k) => {
          const w = this.width(line, 'bold', size - 0.6)
          const x = c.align === 'r' ? (xs[i] ?? 0) + (widths[i] ?? 0) - padX - w : (xs[i] ?? 0) + padX
          this.draw(line, x, this.y - padY - (k + 1) * lineHeight + 3, 'bold', size - 0.6, C.ink2)
        })
      })
      this.y -= headHeight
    }

    if (!rows.length) {
      this.paragraph(options.empty ?? 'None.', { size: 9.5, color: C.ink3 })
      return
    }
    this.ensure(headHeight + lineHeight + padY * 2)
    drawHead()
    rows.forEach((row, r) => {
      const cells = row.map((cell) => (typeof cell === 'string' ? { text: cell } : cell))
      const laid = cells.map((cell, i) => {
        const font = cell.font ?? 'body'
        const inner = (widths[i] ?? 0) - padX * 2 - (cell.chip ? 8 : 0)
        return this.clamp(this.wrap(cell.text, font, size, inner), maxLines, font, size, inner)
      })
      const height = Math.max(1, ...laid.map((l) => l.length)) * lineHeight + padY * 2
      if (this.y - height < BOTTOM) {
        this.newPage()
        drawHead()
      }
      if (r % 2 === 1) this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT_W, height, color: C.zebra })
      cells.forEach((cell, i) => {
        const font = cell.font ?? 'body'
        const lines = laid[i] ?? []
        if (cell.chip && lines.length) {
          // One pill behind the whole text, as wide as its longest line.
          const widest = Math.max(...lines.map((line) => this.width(line, font, size)))
          const top = this.y - padY - lineHeight + 3 + size * 0.92
          this.roundRect((xs[i] ?? 0) + padX, top, widest + 8, (lines.length - 1) * lineHeight + size + 3.6, 4, cell.chip.soft)
        }
        lines.forEach((line, k) => {
          const w = this.width(line, font, size)
          const x = columns[i]?.align === 'r' ? (xs[i] ?? 0) + (widths[i] ?? 0) - padX - w : (xs[i] ?? 0) + padX + (cell.chip ? 4 : 0)
          const baseline = this.y - padY - (k + 1) * lineHeight + 3
          this.draw(line, x, baseline, font, size, cell.chip?.ink ?? cell.color ?? C.ink)
        })
      })
      this.y -= height
    })
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + CONTENT_W, y: this.y }, thickness: 0.6, color: C.line })
    this.y -= 4
  }

  /** Header band and footer on every page, once the page count is known. */
  finish(title: string, period: string, generated: string): void {
    const total = this.pages.length
    this.pages.forEach((page, i) => {
      this.page = page
      page.drawRectangle({ x: 0, y: PAGE_H - 30, width: PAGE_W, height: 30, color: C.board })
      page.drawRectangle({ x: 0, y: PAGE_H - 32, width: PAGE_W, height: 2, color: C.amber })
      this.draw('MATCHDAY LIVE', MARGIN, PAGE_H - 20, 'heading', 12, C.amber)
      const right = `${title}  ·  ${period}`
      this.draw(right, PAGE_W - MARGIN - this.width(pdfSafe(right), 'body', 9), PAGE_H - 19.5, 'body', 9, C.white)
      page.drawLine({ start: { x: MARGIN, y: 30 }, end: { x: PAGE_W - MARGIN, y: 30 }, thickness: 0.6, color: C.line })
      this.draw(`Generated ${generated}`, MARGIN, 18, 'body', 8, C.ink3)
      const label = `Page ${i + 1} of ${total}`
      this.draw(label, PAGE_W - MARGIN - this.width(label, 'bold', 8), 18, 'bold', 8, C.ink2)
    })
  }
}

// ── charts ───────────────────────────────────────────────────────────────────

/** The day's matches on a time axis, one bar each, coloured by outcome. */
function timelineChart(w: Writer, lines: MatchLine[], timeZone: string, now: number): void {
  const t = dayTimeline(lines, now)
  if (!t.bars.length) return
  const laneH = 14
  const axisH = 16
  const height = t.lanes * (laneH + 4) + axisH + 26
  w.ensure(height)
  const top = w.y
  const left = MARGIN + 4
  const width = CONTENT_W - 8
  const plotTop = top - 4
  const plotBottom = plotTop - t.lanes * (laneH + 4)
  w.roundRect(MARGIN, top + 2, CONTENT_W, height - 2, 5, C.zebra)
  for (const tick of t.ticks) {
    const x = left + (tick.pct / 100) * width
    w.page.drawLine({ start: { x, y: plotTop }, end: { x, y: plotBottom - 3 }, thickness: 0.4, color: C.line })
    const label = clockIn(tick.at, timeZone)
    const lw = w.width(label, 'mono', 7)
    w.draw(label, Math.min(Math.max(x - lw / 2, left), left + width - lw), plotBottom - 12, 'mono', 7, C.ink3)
  }
  for (const bar of t.bars) {
    const x = left + (bar.left / 100) * width
    const bw = Math.max((bar.width / 100) * width, 2)
    const y = plotTop - bar.lane * (laneH + 4)
    const color = outcomeColor(bar.match.outcome)
    w.roundRect(x, y, bw, laneH, 3, color.ink)
    const label = pdfSafe(bar.match.setPiece)
    if (w.width(label, 'bold', 7) + 8 < bw) w.draw(label, x + 4, y - laneH + 4.4, 'bold', 7, C.white)
  }
  // The key.
  let kx = MARGIN + 8
  const ky = top - height + 10
  for (const [name, color] of [
    ['touchdown', C.good],
    ['turnover', C.bad],
    ['stopped by the provider', C.warn],
    ['running', C.live],
  ] as const) {
    w.page.drawRectangle({ x: kx, y: ky - 1, width: 8, height: 6, color })
    w.draw(name, kx + 11, ky, 'body', 7, C.ink2)
    kx += w.width(name, 'body', 7) + 26
  }
  w.y -= height + 6
}

/** Matches per day (stacked by outcome) with the day's cost as a line. */
function dailyChart(w: Writer, report: RangeReport, from: string, to: string): void {
  const series = dailySeries(report, from, to)
  if (!series.length) return
  const height = 190
  w.ensure(height + 10)
  const top = w.y
  const plotLeft = MARGIN + 30
  const plotRight = MARGIN + CONTENT_W - 46
  const plotTop = top - 22
  const plotBottom = top - height + 30
  const plotH = plotTop - plotBottom
  const maxMatches = countMax(Math.max(...series.map((s) => s.matches)))
  const maxCost = niceMax(Math.max(...series.map((s) => s.cost)))
  const slot = (plotRight - plotLeft) / series.length
  const barW = Math.min(28, slot * 0.62)

  const costInk = C.amberInk
  w.draw('Matches', MARGIN, top - 10, 'bold', 7.5, C.ink2)
  const costLabel = 'Cost'
  w.draw(costLabel, MARGIN + CONTENT_W - w.width(costLabel, 'bold', 7.5), top - 10, 'bold', 7.5, costInk)
  for (let i = 0; i <= 4; i++) {
    const y = plotBottom + (plotH * i) / 4
    w.page.drawLine({ start: { x: plotLeft, y }, end: { x: plotRight, y }, thickness: 0.4, color: C.line })
    // Matches are whole: a gridline between two whole numbers gets no label.
    const count = (maxMatches * i) / 4
    if (Number.isInteger(count)) w.draw(String(count), plotLeft - 6 - w.width(String(count), 'mono', 7), y - 2.5, 'mono', 7, C.ink3)
    // Cost is labelled at the bottom, the middle and the top only, where the numbers stay round.
    if (i % 2 === 0) w.draw(`$${((maxCost * i) / 4).toFixed(2)}`, plotRight + 6, y - 2.5, 'mono', 7, costInk)
  }
  const every = Math.ceil(series.length / 16)
  const points: Array<{ x: number; y: number }> = []
  series.forEach((s, i) => {
    const cx = plotLeft + slot * (i + 0.5)
    let y = plotBottom
    for (const [count, color] of [
      [s.touchdowns, C.good],
      [s.turnovers, C.bad],
      [s.running, C.live],
    ] as const) {
      if (!count) continue
      const h = (count / maxMatches) * plotH
      w.page.drawRectangle({ x: cx - barW / 2, y, width: barW, height: h, color })
      y += h
    }
    points.push({ x: cx, y: plotBottom + (s.cost / maxCost) * plotH })
    if (i % every === 0) {
      const label = `${s.date.slice(8, 10)}/${s.date.slice(5, 7)}`
      w.draw(label, cx - w.width(label, 'mono', 6.8) / 2, plotBottom - 11, 'mono', 6.8, C.ink3)
    }
  })
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    w.page.drawLine({ start: a, end: b, thickness: 1.6, color: costInk })
  }
  for (const p of points) {
    w.page.drawCircle({ x: p.x, y: p.y, size: 2.6, color: C.white, borderColor: costInk, borderWidth: 1.4 })
  }
  // The key.
  let kx = plotLeft
  const ky = top - height + 8
  for (const [name, color] of [
    ['touchdowns', C.good],
    ['turnovers', C.bad],
    ['running', C.live],
  ] as const) {
    w.page.drawRectangle({ x: kx, y: ky - 1, width: 8, height: 6, color })
    w.draw(name, kx + 11, ky, 'body', 7, C.ink2)
    kx += w.width(name, 'body', 7) + 24
  }
  w.page.drawLine({ start: { x: kx - 2, y: ky + 2 }, end: { x: kx + 12, y: ky + 2 }, thickness: 1.6, color: costInk })
  w.page.drawCircle({ x: kx + 5, y: ky + 2, size: 2.2, color: C.white, borderColor: costInk, borderWidth: 1.2 })
  w.draw('cost per day', kx + 16, ky, 'body', 7, C.ink2)
  w.y -= height + 8
}

interface BarChart {
  title: string
  /** What each colour of a stacked bar means. */
  key?: Array<{ label: string; color: Color }>
  rows: Array<{ label: string; parts: Array<{ value: number; color: Color }>; display: string }>
  max: number
}

/** Small horizontal bar charts, three to a row. */
function barCharts(w: Writer, charts: BarChart[]): void {
  const perRow = 3
  const gap = 14
  const cw = (CONTENT_W - gap * (perRow - 1)) / perRow
  for (let i = 0; i < charts.length; i += perRow) {
    const row = charts.slice(i, i + perRow)
    const height = 24 + Math.max(...row.map((c) => c.rows.length)) * 15 + 6
    w.ensure(height + 8)
    row.forEach((chart, j) => {
      const x = MARGIN + j * (cw + gap)
      const top = w.y
      w.roundRect(x, top, cw, height, 5, C.zebra)
      w.draw(chart.title, x + 8, top - 14, 'bold', 8.4, C.ink)
      let kx = x + cw - 8
      for (const item of [...(chart.key ?? [])].reverse()) {
        kx -= w.width(item.label, 'body', 7)
        w.draw(item.label, kx, top - 14, 'body', 7, C.ink2)
        kx -= 10
        w.page.drawRectangle({ x: kx, y: top - 15, width: 7, height: 6, color: item.color })
        kx -= 8
      }
      const labelW = 74
      const valueW = 54
      const barX = x + 8 + labelW
      const barMax = cw - 16 - labelW - valueW
      chart.rows.forEach((r, k) => {
        const y = top - 26 - k * 15
        const label = w.clamp([pdfSafe(r.label)], 1, 'body', 7.6, labelW - 4)[0] ?? ''
        w.draw(label, x + 8, y - 7, 'body', 7.6, C.ink2)
        w.page.drawRectangle({ x: barX, y: y - 9, width: barMax, height: 8, color: C.white })
        let bx = barX
        for (const part of r.parts) {
          // A value past the axis (a context reported fuller than its window) stops at the end.
          const bw = chart.max > 0 ? Math.min((Math.max(part.value, 0) / chart.max) * barMax, barX + barMax - bx) : 0
          if (bw > 0) w.page.drawRectangle({ x: bx, y: y - 9, width: bw, height: 8, color: part.color })
          bx += bw
        }
        w.draw(r.display, x + cw - 8 - w.width(pdfSafe(r.display), 'mono', 7.4), y - 7.5, 'mono', 7.4, C.ink)
      })
    })
    w.y -= height + 8
  }
}

/** The agent performance charts, the same six the page draws. */
export function agentCharts(agents: AgentPerformance[], colors?: Record<string, string>): BarChart[] {
  const tint = (player: string) => colorOf(player, colors)
  const rows = (value: (a: AgentPerformance) => number, display: (a: AgentPerformance) => string) =>
    agents.map((a) => ({ label: a.player.replace(/_/g, ' '), parts: [{ value: value(a), color: tint(a.player) }], display: display(a) }))
  return [
    { title: 'Touchdown rate', rows: rows((a) => a.successRate, (a) => percent(a.successRate)), max: 1 },
    { title: 'First-try rate', rows: rows((a) => a.firstTryRate, (a) => percent(a.firstTryRate)), max: 1 },
    {
      title: 'Cost per objective',
      rows: rows((a) => a.costPerObjective, (a) => money(a.costPerObjective)),
      max: niceMax(Math.max(0, ...agents.map((a) => a.costPerObjective))),
    },
    {
      title: 'Extra time and corrections',
      key: [
        { label: 'extra time', color: C.warn },
        { label: 'corrections', color: C.bad },
      ],
      rows: agents.map((a) => ({
        label: a.player.replace(/_/g, ' '),
        parts: [
          { value: a.extraTime, color: C.warn },
          { value: a.invalidReplies + a.reviewFailures, color: C.bad },
        ],
        display: `${a.extraTime} + ${a.invalidReplies + a.reviewFailures}`,
      })),
      max: niceMax(Math.max(1, ...agents.map((a) => a.extraTime + a.invalidReplies + a.reviewFailures))),
    },
    { title: 'Cache share', rows: rows((a) => a.cacheShare, (a) => percent(a.cacheShare)), max: 1 },
    {
      title: 'Peak context',
      rows: rows((a) => a.peakContext ?? 0, (a) => (a.peakContext === null ? 'n/a' : percent(a.peakContext))),
      max: 1,
    },
  ]
}

// ── sections ─────────────────────────────────────────────────────────────────

function totalsFigures(w: Writer, t: Totals, first: string | null, last: string | null, timeZone: string, withDays = false): void {
  const at = (iso: string) => (withDays ? dayClockIn(iso, timeZone) : clockIn(iso, timeZone))
  w.figures([
    { label: 'Matches', value: String(t.matches), note: `${t.touchdowns} touchdowns · ${t.turnovers} turnovers${t.running ? ` · ${t.running} running` : ''}` },
    { label: 'Touchdowns', value: String(t.touchdowns), tone: C.good, note: t.matches ? `${percent(t.touchdowns / t.matches)} of matches` : '' },
    { label: 'Turnovers', value: String(t.turnovers), tone: C.bad, note: t.abandoned ? `${t.abandoned} stopped by the provider` : 'none stopped by the provider' },
    { label: 'Cost', value: money(t.cost), tone: C.accent },
    { label: 'Billed tokens', value: compact(t.tokens.billed), note: `${compact(t.tokens.read)} read · ${compact(t.tokens.written)} written` },
    {
      label: 'Time in matches',
      value: duration(t.matchSeconds),
      note: first && last ? `${at(first)} to ${at(last)}` : '',
    },
  ])
}

function col(label: string, weight: number, align: 'l' | 'r' = 'l'): Column {
  return { label, weight, align }
}

const shortModel = (m: string) => m.replace(/^[a-z]+\//, '')

function agentsTable(w: Writer, agents: AgentPerformance[], colors: Colors): void {
  w.table(
    [
      col('Player', 1.2),
      col('Models', 1.7),
      col('Objectives', 0.75, 'r'),
      col('Touchdowns', 0.95, 'r'),
      col('First try', 0.72, 'r'),
      col('Extra time', 0.72, 'r'),
      col('Review fails', 0.75, 'r'),
      col('Corrected replies', 0.8, 'r'),
      col('Breaches', 0.7, 'r'),
      col('Cost', 0.8, 'r'),
      col('Cost / objective', 0.85, 'r'),
      col('Avg time', 0.75, 'r'),
      col('Cache share', 0.72, 'r'),
      col('Peak context', 0.72, 'r'),
    ],
    agents.map((a) => [
      { text: a.player.replace(/_/g, ' '), font: 'bold', color: colorOf(a.player, colors) },
      a.models.map(shortModel).join(', '),
      String(a.objectives),
      `${a.touchdowns} (${percent(a.successRate)})`,
      percent(a.firstTryRate),
      String(a.extraTime),
      { text: String(a.reviewFailures), color: a.reviewFailures ? C.bad : C.ink },
      { text: String(a.invalidReplies), color: a.invalidReplies ? C.warn : C.ink },
      { text: String(a.breaches), color: a.breaches ? C.bad : C.ink },
      money(a.cost),
      money(a.costPerObjective),
      duration(a.avgSeconds),
      percent(a.cacheShare),
      a.peakContext === null ? '' : percent(a.peakContext),
    ]),
    { empty: 'No player objectives in this period.' },
  )
}

function modelsTable(w: Writer, models: ModelUse[]): void {
  w.table(
    [col('Model', 2), col('Club', 0.8), col('Players', 2), col('Objectives', 0.8, 'r'), col('Cost', 0.8, 'r'), col('Billed tokens', 0.9, 'r')],
    models.map((m) => [{ text: m.model, font: 'mono' }, m.club ?? '', m.players.join(', '), String(m.objectives), money(m.cost), compact(m.billedTokens)]),
    { empty: 'No models used.' },
  )
}

function piecesTable(w: Writer, pieces: SetPieceUse[]): void {
  w.table(
    [col('Set piece', 1.6), col('Matches', 0.8, 'r'), col('Touchdowns', 0.8, 'r'), col('Turnovers', 0.8, 'r'), col('Cost', 0.8, 'r'), col('Avg cost', 0.8, 'r'), col('Avg time', 0.8, 'r')],
    pieces.map((p) => [
      { text: p.setPiece, font: 'bold' },
      String(p.matches),
      { text: String(p.touchdowns), color: C.good },
      { text: String(p.turnovers), color: p.turnovers ? C.bad : C.ink },
      money(p.cost),
      money(p.avgCost),
      duration(p.avgSeconds),
    ]),
    { empty: 'No set pieces played.' },
  )
}

function matchesTable(w: Writer, lines: MatchLine[], timeZone: string): void {
  w.table(
    [col('Start', 0.55), col('Match', 0.75), col('Set piece', 1.25), col('Result', 2.1), col('Time', 0.65, 'r'), col('Cost', 0.7, 'r'), col('Tokens', 0.65, 'r'), col('Models', 1.4), col('Ask', 2.5)],
    lines.map((m) => [
      { text: clockIn(m.started_at, timeZone), font: 'mono' },
      { text: m.match_id, font: 'mono' },
      m.setPiece,
      { text: m.outcome + (m.reason ? `: ${m.reason}` : ''), chip: outcomeColor(m.outcome) },
      duration(m.seconds),
      money(m.cost),
      compact(m.billedTokens),
      m.models.map(shortModel).join(', '),
      m.ask,
    ]),
    { maxLines: 3, empty: 'No matches.' },
  )
}

function notableList(w: Writer, notable: Notable[]): void {
  if (!notable.length) {
    w.paragraph('Nothing to look at.', { size: 9.5, color: C.ink3 })
    return
  }
  for (const n of notable) {
    const tone = n.kind === 'turnover' || n.kind === 'breach' ? C.bad : n.kind === 'extra_time' ? C.live : C.warn
    const tag = n.kind.replace('_', ' ')
    w.ensure(16)
    const tagW = w.width(tag, 'bold', 7.6) + 10
    w.roundRect(MARGIN, w.y, tagW, 12, 4, tone)
    w.draw(tag, MARGIN + 5, w.y - 9, 'bold', 7.6, C.white)
    w.draw(n.match_id, MARGIN + tagW + 6, w.y - 9, 'mono', 7.8, C.ink2)
    const textX = MARGIN + tagW + 6 + w.width(n.match_id, 'mono', 7.8) + 8
    const lines = w.clamp(w.wrap(n.text, 'body', 9, MARGIN + CONTENT_W - textX), 3, 'body', 9, MARGIN + CONTENT_W - textX)
    lines.forEach((line, i) => w.draw(line, textX, w.y - 9 - i * 12, 'body', 9, C.ink))
    w.y -= Math.max(16, lines.length * 12 + 4)
  }
}

function daySection(w: Writer, day: DayReport, timeZone: string, now: number, level: 1 | 2, colors: Colors): void {
  if (level === 2) {
    // Each day of a range starts on a fresh page unless this one is still mostly empty.
    if (w.y < PAGE_H * 0.62) w.newPage()
    w.heading(longDate(day.date), 2)
  }
  w.paragraph(day.summary, { size: 10.5 })
  w.gap(8)
  totalsFigures(w, day.totals, day.first, day.last, timeZone)
  w.heading('Timeline', 3)
  timelineChart(w, day.matches, timeZone, now)
  w.heading('Matches', 3)
  matchesTable(w, day.matches, timeZone)
  w.heading('Agent performance', 3)
  agentsTable(w, day.agents, colors)
  if (level === 1) {
    barCharts(w, agentCharts(day.agents, colors))
    w.heading('Models used', 3)
    modelsTable(w, day.models)
    w.heading('Set pieces', 3)
    piecesTable(w, day.setPieces)
  }
  w.heading('Worth a look', 3)
  notableList(w, day.notable)
}

function stamp(date: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  return `${day} ${clockIn(date.getTime(), timeZone)} ${zoneLabel(timeZone, date.getTime())}`
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * A WOFF file (what the page itself loads) unpacked to the TrueType font it
 * wraps: each table inflated and laid out again behind an sfnt directory.
 * fontkit reads TrueType more reliably than WOFF, and only TrueType can go
 * into a PDF.
 */
export async function woffToSfnt(woff: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength)
  if (view.getUint32(0) !== 0x774f4646) return woff // not 'wOFF': already TrueType or OpenType
  const flavor = view.getUint32(4)
  const count = view.getUint16(12)
  const tables = Array.from({ length: count }, (_, i) => {
    const at = 44 + i * 20
    return {
      tag: view.getUint32(at),
      offset: view.getUint32(at + 4),
      packed: view.getUint32(at + 8),
      length: view.getUint32(at + 12),
      checksum: view.getUint32(at + 16),
    }
  })
  const padded = (n: number) => (n + 3) & ~3
  const out = new Uint8Array(12 + 16 * count + tables.reduce((sum, t) => sum + padded(t.length), 0))
  const write = new DataView(out.buffer)
  let power = 1
  let log = 0
  while (power * 2 <= count) {
    power *= 2
    log++
  }
  write.setUint32(0, flavor)
  write.setUint16(4, count)
  write.setUint16(6, power * 16)
  write.setUint16(8, log)
  write.setUint16(10, count * 16 - power * 16)
  let at = 12 + 16 * count
  for (const [i, t] of tables.entries()) {
    const raw = woff.subarray(t.offset, t.offset + t.packed)
    const data = t.packed < t.length ? await inflate(raw) : raw
    const entry = 12 + i * 16
    write.setUint32(entry, t.tag)
    write.setUint32(entry + 4, t.checksum)
    write.setUint32(entry + 8, at)
    write.setUint32(entry + 12, t.length)
    out.set(data.subarray(0, t.length), at)
    at += padded(t.length)
  }
  return out
}

/** The whole report as PDF bytes. */
export async function buildReportPdf(input: PdfReport, fontBytes: PdfFonts): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const embed = async (bytes: Uint8Array) => doc.embedFont(await woffToSfnt(bytes), { subset: true })
  const fonts: Fonts = {
    body: await embed(fontBytes.body),
    bold: await embed(fontBytes.bold),
    heading: await embed(fontBytes.heading),
    mono: await embed(fontBytes.mono),
  }
  const w = new Writer(doc, fonts)
  let title: string
  let period: string
  let generated: Date
  let timeZone: string

  if (input.kind === 'day') {
    const { day } = input
    timeZone = input.timeZone
    generated = input.generatedAt
    title = 'Daily report'
    period = longDate(day.date)
    w.heading(`Daily report: ${longDate(day.date)}`, 1)
    w.paragraph(`Days are cut in ${zoneLabel(timeZone, generated.getTime())}.`, { size: 8.6, color: C.ink3 })
    w.gap(6)
    daySection(w, day, timeZone, generated.getTime(), 1, input.colors)
  } else {
    const { report, from, to } = input
    timeZone = report.timeZone
    generated = new Date(report.generatedAt)
    title = 'Multi-day report'
    period = from === to ? longDate(from) : `${longDate(from)} to ${longDate(to)}`
    w.heading(`Multi-day report: ${period}`, 1)
    w.paragraph(`Days are cut in ${zoneLabel(timeZone, generated.getTime())}.`, { size: 8.6, color: C.ink3 })
    w.gap(6)
    w.paragraph(report.summary, { size: 10.5 })
    w.gap(8)
    totalsFigures(w, report.totals, report.days[0]?.first ?? null, report.days.at(-1)?.last ?? null, timeZone, true)
    w.heading('Agent performance', 2)
    w.paragraph(
      'Every player across the period: how often it scored, how often on the first try (no corrected reply, every official review green at once), how much extra time and correction it needed, and what it cost.',
      { size: 9, color: C.ink2 },
    )
    w.gap(4)
    agentsTable(w, report.agents, input.colors)
    barCharts(w, agentCharts(report.agents, input.colors))
    w.heading('Models used', 2)
    modelsTable(w, report.models)
    w.heading('Set pieces', 2)
    piecesTable(w, report.setPieces)
    w.heading('Cost and matches per day', 2)
    dailyChart(w, report, from, to)
    w.heading('Day by day', 3)
    w.table(
      [col('Day', 1.6), col('Matches', 0.8, 'r'), col('Touchdowns', 0.8, 'r'), col('Turnovers', 0.8, 'r'), col('Cost', 0.8, 'r'), col('Billed tokens', 0.9, 'r'), col('Time', 0.8, 'r')],
      report.days.map((d) => [
        { text: longDate(d.date), font: 'bold' },
        String(d.totals.matches),
        { text: String(d.totals.touchdowns), color: C.good },
        { text: String(d.totals.turnovers), color: d.totals.turnovers ? C.bad : C.ink },
        money(d.totals.cost),
        compact(d.totals.tokens.billed),
        duration(d.totals.matchSeconds),
      ]),
      { empty: 'No matches in this period.' },
    )
    w.heading('Worth a look', 2)
    notableList(w, report.notable)
    for (const day of report.days) daySection(w, day, timeZone, generated.getTime(), 2, input.colors)
  }

  w.finish(title, period, stamp(generated, timeZone))
  doc.setTitle(`Matchday Live ${title.toLowerCase()}: ${period}`)
  doc.setAuthor('Matchday Live')
  doc.setCreator('Matchday Live')
  doc.setProducer('Matchday Live (pdf-lib)')
  doc.setCreationDate(generated)
  return doc.save()
}
