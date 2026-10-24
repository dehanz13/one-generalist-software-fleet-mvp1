import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { dailyReports, rangeBounds, rangeReport } from '../../shared/report'
import type { DemoDataset } from '../../shared/types'
import { tinyDatasetV2 } from '../data/__fixtures__/tiny'
import { DemoSource } from '../data/demo'
import { type PdfFonts, buildReportPdf, pdfSafe } from './pdf'

const root = join(import.meta.dirname, '../..')
const font = (path: string) => new Uint8Array(readFileSync(join(root, 'node_modules/@fontsource', path)))
const fonts: PdfFonts = {
  body: font('barlow/files/barlow-latin-400-normal.woff'),
  bold: font('barlow/files/barlow-latin-600-normal.woff'),
  heading: font('barlow-condensed/files/barlow-condensed-latin-700-normal.woff'),
  mono: font('ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff'),
}

async function factsOf(dataset: DemoDataset, from: string, to: string, timeZone: string) {
  const demo = new DemoSource(dataset, { speed: 1, realNow: () => 0 })
  demo.clock.seek(Number.MAX_SAFE_INTEGER)
  const { since, until } = rangeBounds(from, to, timeZone)
  return demo.reportFacts(since, until)
}

const header = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5))

describe('the PDF', () => {
  it('writes a daily report as a PDF', async () => {
    const facts = await factsOf(tinyDatasetV2(), '2026-10-17', '2026-10-17', 'UTC')
    const [day] = dailyReports(facts, { timeZone: 'UTC' })
    const bytes = await buildReportPdf({ kind: 'day', day: day!, timeZone: 'UTC', generatedAt: new Date('2026-10-17T12:00:00Z') }, fonts)
    expect(header(bytes)).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    expect(doc.getTitle()).toBe('Matchday Live daily report: Sat 17 Oct 2026')
  })

  it('writes a multi-day report with every day after the summary', async () => {
    const facts = await factsOf(tinyDatasetV2(), '2026-10-12', '2026-10-17', 'America/Chicago')
    const report = rangeReport(facts, { timeZone: 'America/Chicago', now: new Date('2026-10-17T12:00:00Z') })
    const bytes = await buildReportPdf({ kind: 'range', report, from: '2026-10-12', to: '2026-10-17' }, fonts)
    expect(header(bytes)).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2)
    expect(doc.getPage(0).getSize()).toEqual({ width: 842, height: 595 })
  })

  it('writes an empty period without failing', async () => {
    const facts = await factsOf(tinyDatasetV2(), '2026-09-01', '2026-09-07', 'UTC')
    const report = rangeReport(facts, { timeZone: 'UTC', now: new Date('2026-10-17T12:00:00Z') })
    expect(header(await buildReportPdf({ kind: 'range', report, from: '2026-09-01', to: '2026-09-07' }, fonts))).toBe('%PDF-')
  })

  it('swaps characters the bundled fonts cannot draw', () => {
    expect(pdfSafe('a → b ✓ 日本 “ok” – fine')).toBe('a -> b ok ?? “ok” – fine')
  })

  // MATCHDAY_PDF_OUT=/some/dir npx vitest run src/lib/pdf.test.ts writes the demo's reports there to look at.
  it.runIf(Boolean(process.env.MATCHDAY_PDF_OUT))('writes the demo recording’s reports for a look', async () => {
    const dataset = JSON.parse(readFileSync(join(root, 'public/demo/matchday-demo.json'), 'utf8')) as DemoDataset
    const facts = await factsOf(dataset, '2026-10-10', '2026-10-17', 'America/Chicago')
    const report = rangeReport(facts, { timeZone: 'America/Chicago' })
    const out = process.env.MATCHDAY_PDF_OUT!
    writeFileSync(join(out, 'range.pdf'), await buildReportPdf({ kind: 'range', report, from: '2026-10-10', to: '2026-10-17' }, fonts))
    const day = report.days.at(-1)!
    writeFileSync(join(out, 'day.pdf'), await buildReportPdf({ kind: 'day', day, timeZone: 'America/Chicago', generatedAt: new Date() }, fonts))
  })
})
