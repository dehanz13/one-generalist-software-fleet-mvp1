/**
 * JSON syntax colouring as React elements. No HTML strings are ever built,
 * so nothing in a payload can become markup: React escapes every character.
 */
import type { ReactNode } from 'react'

// Strings first, so digits and keywords inside them stay part of the string.
// A string followed by a colon is an object key.
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g

export function highlightJsonText(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(TOKEN)) {
    const index = m.index ?? 0
    if (index > last) out.push(text.slice(last, index))
    const [full, str, colon, bool, nil, num] = m
    if (str !== undefined) {
      out.push(
        <span key={key++} className={colon !== undefined ? 'j-key' : 'j-str'}>
          {str}
        </span>,
      )
      if (colon) out.push(colon)
    } else if (bool !== undefined) {
      out.push(<span key={key++} className="j-bool">{bool}</span>)
    } else if (nil !== undefined) {
      out.push(<span key={key++} className="j-null">null</span>)
    } else {
      out.push(<span key={key++} className="j-num">{num ?? full}</span>)
    }
    last = index + full.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Pretty-print raw JSON when it parses; otherwise show it as it came. */
export function prettyJson(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function JsonBlock({ raw, value }: { raw?: string | null; value?: unknown }) {
  const text = value !== undefined ? JSON.stringify(value, null, 2) : prettyJson(raw)
  let parses = value !== undefined
  if (!parses && raw) {
    try {
      JSON.parse(raw)
      parses = true
    } catch {
      parses = false
    }
  }
  return <pre className="code json">{parses ? highlightJsonText(text) : text}</pre>
}
