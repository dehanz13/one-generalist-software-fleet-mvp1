/**
 * The page's own fonts, fetched from this build's assets for the PDF: no CDN,
 * so a download works offline and inside `ogsf var`. Imported lazily with the
 * PDF builder, so the main bundle carries none of this.
 */
import heading from '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff?url'
import body from '@fontsource/barlow/files/barlow-latin-400-normal.woff?url'
import bold from '@fontsource/barlow/files/barlow-latin-600-normal.woff?url'
import mono from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff?url'
import type { PdfFonts } from './pdf'

async function bytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`A font for the PDF did not load (${response.status}).`)
  return new Uint8Array(await response.arrayBuffer())
}

export async function loadPdfFonts(): Promise<PdfFonts> {
  const [b, s, h, m] = await Promise.all([bytes(body), bytes(bold), bytes(heading), bytes(mono)])
  return { body: b, bold: s, heading: h, mono: m }
}
