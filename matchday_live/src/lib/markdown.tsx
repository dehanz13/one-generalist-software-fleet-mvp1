/**
 * A small Markdown renderer for team talks (the prompts a player was sent),
 * producing React elements. There is no raw-HTML pass-through and no HTML
 * string anywhere: text is always a React text node, so a prompt cannot
 * inject markup. Links are kept only for http(s) addresses.
 *
 * Covers what prompts use: #–#### headings, fenced code (JSON coloured),
 * inline code, bold, links, lists, block quotes, rules and paragraphs.
 */
import type { ReactNode } from 'react'
import { highlightJsonText } from './json'

const INLINE = /(`[^`\n]+`)|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0
    if (index > last) out.push(text.slice(last, index))
    const [full, code, bold, linkText, href] = m
    const key = `${keyPrefix}-${n++}`
    if (code !== undefined) out.push(<code key={key}>{code.slice(1, -1)}</code>)
    else if (bold !== undefined) out.push(<strong key={key}>{bold}</strong>)
    else if (linkText !== undefined && href !== undefined) {
      out.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {linkText}
        </a>,
      )
    }
    last = index + full.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const out: ReactNode[] = []
  const paragraph: string[] = []
  let key = 0
  let i = 0

  const flush = () => {
    if (!paragraph.length) return
    const k = key++
    out.push(<p key={k}>{renderInline(paragraph.join('\n'), `p${k}`)}</p>)
    paragraph.length = 0
  }

  while (i < lines.length) {
    const raw = lines[i] ?? ''

    const fence = /^\s*```(\w*)/.exec(raw)
    if (fence) {
      flush()
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? '')) {
        code.push(lines[i] ?? '')
        i += 1
      }
      i += 1
      const text = code.join('\n')
      out.push(
        <pre key={key++} className="code">
          {(fence[1] ?? '').toLowerCase() === 'json' ? highlightJsonText(text) : text}
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(raw)
    if (heading?.[1] && heading[2] !== undefined) {
      flush()
      const level = heading[1].length
      const k = key++
      const children = renderInline(heading[2], `h${k}`)
      out.push(
        level === 1 ? <h3 key={k}>{children}</h3> : level === 2 ? <h4 key={k}>{children}</h4> : <h5 key={k}>{children}</h5>,
      )
      i += 1
      continue
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(raw)) {
      flush()
      out.push(<hr key={key++} />)
      i += 1
      continue
    }

    if (/^\s*>\s?/.test(raw)) {
      flush()
      const quote: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        quote.push((lines[i] ?? '').replace(/^\s*>\s?/, ''))
        i += 1
      }
      const k = key++
      out.push(<blockquote key={k}>{renderInline(quote.join('\n'), `q${k}`)}</blockquote>)
      continue
    }

    const bullet = /^\s*[-*]\s+/
    const numbered = /^\s*\d+\.\s+/
    if (bullet.test(raw) || numbered.test(raw)) {
      flush()
      const marker = bullet.test(raw) ? bullet : numbered
      const items: ReactNode[] = []
      const k = key++
      while (i < lines.length && marker.test(lines[i] ?? '')) {
        let item = (lines[i] ?? '').replace(marker, '')
        i += 1
        // An indented line below an item continues it.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i] ?? '') && !marker.test(lines[i] ?? '')) {
          item += `\n${(lines[i] ?? '').trim()}`
          i += 1
        }
        items.push(<li key={items.length}>{renderInline(item, `l${k}-${items.length}`)}</li>)
      }
      out.push(marker === bullet ? <ul key={k}>{items}</ul> : <ol key={k}>{items}</ol>)
      continue
    }

    if (raw.trim() === '') {
      flush()
      i += 1
      continue
    }

    paragraph.push(raw)
    i += 1
  }
  flush()
  return out
}

export function Markdown({ source }: { source: string }) {
  return <div className="md">{renderMarkdown(source)}</div>
}
