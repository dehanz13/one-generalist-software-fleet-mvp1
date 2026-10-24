/**
 * Report downloads. Markdown is the text shared/report-markdown.ts writes,
 * byte for byte what the Claude connector answers with. The PDF builder and
 * its fonts load only when a PDF is asked for.
 */
import type { PdfReport } from './pdf'

/** Hand the browser a file to save. */
export function saveFile(name: string, data: string | Uint8Array, type: string): void {
  const part: BlobPart = typeof data === 'string' ? data : (data.slice().buffer as ArrayBuffer)
  const url = URL.createObjectURL(new Blob([part], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadMarkdown(name: string, markdown: string): void {
  saveFile(name, markdown, 'text/markdown;charset=utf-8')
}

export async function downloadPdf(name: string, input: PdfReport): Promise<void> {
  const [{ buildReportPdf }, { loadPdfFonts }] = await Promise.all([import('./pdf'), import('./pdf-fonts')])
  const bytes = await buildReportPdf(input, await loadPdfFonts())
  saveFile(name, bytes, 'application/pdf')
}
