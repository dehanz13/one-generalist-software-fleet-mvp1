/**
 * The docs' Markdown, parsed into blocks. The pages are written for GitHub
 * (modernized/docs/), so this reads the GitHub subset they use: headings,
 * paragraphs, fenced code (any fence length), lists with nested blocks,
 * block quotes, tables, rules, a diagram on a line of its own, and
 * `<!-- chart: <name> -->` markers, which GitHub hides and the page draws.
 *
 * Nothing here produces HTML. Inline text stays a string; render.tsx turns
 * it into React elements, so no page text can ever become markup.
 */

export type Align = 'left' | 'center' | 'right' | null

export type Block =
  | { type: 'heading'; level: number; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'table'; head: string[]; align: Align[]; rows: string[][] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'chart'; name: string }
  | { type: 'rule' }

export interface Doc {
  /** The first level-1 heading, or '' */
  title: string
  blocks: Block[]
  /** Every heading, in order, for the contents list. */
  headings: Array<{ level: number; text: string; id: string }>
}

// ── slugs ─────────────────────────────────────────────────────────────────────

/** A heading's text as plain words: code ticks, emphasis and link targets removed. */
export function plainText(inline: string): string {
  return inline
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/\*([^*\s][^*]*)\*/g, '$1')
    .replace(/\\(.)/g, '$1')
}

/** GitHub's heading anchor: lower case, punctuation dropped, each space a hyphen. */
export function slugify(text: string): string {
  return plainText(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

class Slugger {
  private seen = new Map<string, number>()
  next(text: string): string {
    const base = slugify(text) || 'section'
    const count = this.seen.get(base) ?? 0
    this.seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }
}

// ── line tests ────────────────────────────────────────────────────────────────

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^ {0,3}>\s?/
const LIST_ITEM = /^( {0,3})([-*+]|(\d{1,9})[.)])(\s+|$)(.*)$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/
const COMMENT_START = /^\s*<!--/
const CHART = /^chart:\s*([\w-]+)$/

const isBlank = (line: string) => line.trim() === ''

function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    COMMENT_START.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_DIVIDER.test(next))
  )
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/** Removes up to `n` leading spaces. */
function dedent(line: string, n: number): string {
  let i = 0
  while (i < n && line[i] === ' ') i++
  return line.slice(i)
}

// ── tables ────────────────────────────────────────────────────────────────────

/** Splits a table row on its unescaped pipes, without the outer ones. */
export function splitRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\\' && text[i + 1] === '|') {
      cell += '|'
      i++
    } else if (ch === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell.trim())
  return cells
}

function alignOf(cell: string): Align {
  const c = cell.trim()
  const left = c.startsWith(':')
  const right = c.endsWith(':')
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null
}

// ── blocks ────────────────────────────────────────────────────────────────────

function parseBlocks(lines: string[], slugger: Slugger): Block[] {
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (isBlank(line)) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]!
      const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
      const indent = indentOf(line)
      const body: string[] = []
      i++
      while (i < lines.length && !close.test(lines[i]!)) {
        body.push(dedent(lines[i]!, indent))
        i++
      }
      i++ // the closing fence, or the end of the page
      blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n') })
      continue
    }

    if (COMMENT_START.test(line)) {
      const parts: string[] = []
      while (i < lines.length) {
        const current = lines[i]!
        parts.push(current)
        i++
        if (current.includes('-->')) break
      }
      const inner = parts
        .join('\n')
        .replace(/^\s*<!--/, '')
        .replace(/-->\s*$/, '')
        .trim()
      const chart = CHART.exec(inner)
      if (chart) blocks.push({ type: 'chart', name: chart[1]! })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      const text = heading[2]!
      blocks.push({ type: 'heading', level: heading[1]!.length, text, id: slugger.next(text) })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]!)) {
      const head = splitRow(line)
      const align = splitRow(lines[i + 1]!).map(alignOf)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes('|')) {
        const cells = splitRow(lines[i]!)
        rows.push(head.map((_, c) => cells[c] ?? ''))
        i++
      }
      blocks.push({ type: 'table', head, align: head.map((_, c) => align[c] ?? null), rows })
      continue
    }

    if (QUOTE.test(line)) {
      const inner: string[] = []
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        inner.push(lines[i]!.replace(QUOTE, ''))
        i++
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(inner, slugger) })
      continue
    }

    if (LIST_ITEM.test(line)) {
      const [list, next] = parseList(lines, i, slugger)
      blocks.push(list)
      i = next
      continue
    }

    const image = IMAGE_LINE.exec(line)
    if (image) {
      blocks.push({ type: 'image', alt: image[1]!, src: image[2]! })
      i++
      continue
    }

    const text: string[] = [line.trim()]
    i++
    while (i < lines.length && !isBlank(lines[i]!) && !startsBlock(lines[i]!, lines[i + 1])) {
      text.push(lines[i]!.trim())
      i++
    }
    blocks.push({ type: 'paragraph', text: text.join('\n') })
  }
  return blocks
}

function parseList(lines: string[], from: number, slugger: Slugger): [Block, number] {
  const first = LIST_ITEM.exec(lines[from]!)!
  const ordered = first[3] !== undefined
  const start = ordered ? Number(first[3]) : 1
  const items: string[][] = []
  let contentIndent = 0
  let i = from

  // A new item of this list: a marker of the same kind, left of the content.
  const newItem = (line: string) => {
    const m = LIST_ITEM.exec(line)
    if (!m || (m[3] !== undefined) !== ordered) return null
    return items.length === 0 || indentOf(line) < contentIndent ? m : null
  }

  while (i < lines.length) {
    const line = lines[i]!
    const marker = newItem(line)
    if (marker) {
      const spaces = marker[4]!.length
      contentIndent = marker[1]!.length + marker[2]!.length + (spaces === 0 || spaces > 4 ? 1 : spaces)
      items.push([marker[5] ?? ''])
      i++
      continue
    }
    const item = items[items.length - 1]!
    if (isBlank(line)) {
      // A blank line belongs to the list only if the list goes on after it.
      let j = i
      while (j < lines.length && isBlank(lines[j]!)) j++
      const after = lines[j]
      if (after !== undefined && (indentOf(after) >= contentIndent || newItem(after))) {
        for (let k = i; k < j; k++) item.push('')
        i = j
        continue
      }
      break
    }
    if (indentOf(line) >= contentIndent) {
      item.push(dedent(line, contentIndent))
      i++
      continue
    }
    // A lazy continuation of the item's last paragraph.
    if (!isBlank(item[item.length - 1] ?? '') && !startsBlock(line, lines[i + 1])) {
      item.push(line.trim())
      i++
      continue
    }
    break
  }

  return [{ type: 'list', ordered, start, items: items.map((lines) => parseBlocks(lines, slugger)) }, i]
}

/** Parses one page. */
export function parseDoc(source: string): Doc {
  const slugger = new Slugger()
  const blocks = parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'), slugger)
  const headings: Doc['headings'] = []
  const visit = (list: Block[]) => {
    for (const b of list) {
      if (b.type === 'heading') headings.push({ level: b.level, text: b.text, id: b.id })
      else if (b.type === 'list') b.items.forEach(visit)
      else if (b.type === 'quote') visit(b.blocks)
    }
  }
  visit(blocks)
  const h1 = headings.find((h) => h.level === 1)
  return { title: h1 ? plainText(h1.text) : '', blocks, headings }
}
