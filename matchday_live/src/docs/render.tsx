/**
 * Docs blocks to React. Inline Markdown (code, bold, italics, links) is
 * tokenised here into elements; text is only ever text, so a page cannot
 * inject markup. Links go where links.ts says; diagrams and charts are the
 * page's own components.
 */
import { Check, Copy, Link2 } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import { Chart } from './charts/Charts'
import { Diagram, diagramName } from './Diagram'
import { resolveLink, pageHref, type Section } from './links'
import type { Block } from './parse'

export interface Where {
  section: Section
  slug: string
}

// ── inline ───────────────────────────────────────────────────────────────────

/** Finds the `]` that closes the `[` at `open`, allowing nested brackets and code. */
function closingBracket(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      i++
    } else if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end === -1) return -1
      i = end
    } else if (ch === '[') {
      depth++
    } else if (ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

export function renderInline(text: string, where: Where, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let buffer = ''
  let key = 0
  const flush = () => {
    if (buffer) out.push(buffer)
    buffer = ''
  }
  const push = (node: ReactNode) => {
    flush()
    out.push(<Fragment key={`${keyPrefix}-${key++}`}>{node}</Fragment>)
  }

  let i = 0
  while (i < text.length) {
    const ch = text[i]!

    if (ch === '\\' && i + 1 < text.length && /[\\`*_[\]()#+\-.!|<>~]/.test(text[i + 1]!)) {
      buffer += text[i + 1]
      i += 2
      continue
    }

    if (ch === '\n') {
      buffer += ' '
      i++
      continue
    }

    if (ch === '`') {
      let run = 1
      while (text[i + run] === '`') run++
      const fence = '`'.repeat(run)
      const end = text.indexOf(fence, i + run)
      if (end !== -1) {
        const code = text.slice(i + run, end)
        push(<code>{code.length > 2 && code.startsWith(' ') && code.endsWith(' ') ? code.slice(1, -1) : code}</code>)
        i = end + run
        continue
      }
    }

    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2)
      if (end > i + 2) {
        push(<strong>{renderInline(text.slice(i + 2, end), where, `${keyPrefix}-${key}`)}</strong>)
        i = end + 2
        continue
      }
    }

    if (ch === '*' && text[i + 1] !== ' ' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1)
      if (end > i + 1 && text[end - 1] !== ' ') {
        push(<em>{renderInline(text.slice(i + 1, end), where, `${keyPrefix}-${key}`)}</em>)
        i = end + 1
        continue
      }
    }

    if (ch === '[' || (ch === '!' && text[i + 1] === '[')) {
      const open = ch === '!' ? i + 1 : i
      const close = closingBracket(text, open)
      if (close !== -1 && text[close + 1] === '(') {
        const end = text.indexOf(')', close + 2)
        if (end !== -1) {
          const label = text.slice(open + 1, close)
          const href = text.slice(close + 2, end).trim().split(/\s+/)[0] ?? ''
          if (ch === '!') {
            push(<span className="doc-inline-image">{label}</span>)
          } else {
            push(<DocLink href={href} where={where}>{renderInline(label, where, `${keyPrefix}-${key}`)}</DocLink>)
          }
          i = end + 1
          continue
        }
      }
    }

    buffer += ch
    i++
  }
  flush()
  return out
}

function DocLink({ href, where, children }: { href: string; where: Where; children: ReactNode }) {
  const target = resolveLink(href, where)
  switch (target.kind) {
    case 'external':
      return (
        <a href={target.href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    case 'page':
      return <a href={target.href}>{children}</a>
    case 'file':
      return (
        <span className="doc-file-ref" title={`${target.path}, in the fleet’s repository`}>
          {children}
        </span>
      )
    case 'none':
      return <>{children}</>
  }
}

// ── blocks ───────────────────────────────────────────────────────────────────

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => undefined,
    )
  }
  return (
    <div className="doc-code">
      <div className="doc-code-head">
        <span className="doc-code-lang">{lang || 'text'}</span>
        <button type="button" className="doc-code-copy" onClick={copy} aria-label={copied ? 'Copied' : 'Copy the code'}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{text}</code>
      </pre>
    </div>
  )
}

function Heading({ level, text, id, where }: { level: number; text: string; id: string; where: Where }) {
  const content = renderInline(text, where)
  if (level === 1) {
    return (
      <h1 className="doc-title" id={id}>
        {content}
      </h1>
    )
  }
  const Tag = `h${Math.min(level, 6)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  return (
    <Tag id={id} className="doc-heading">
      {content}
      <a className="doc-anchor" href={pageHref(where.section, where.slug, id)} aria-label="Link to this section">
        <Link2 size={15} aria-hidden="true" />
      </a>
    </Tag>
  )
}

function renderBlock(block: Block, where: Where, key: number, tight = false): ReactNode {
  switch (block.type) {
    case 'heading':
      return <Heading key={key} level={block.level} text={block.text} id={block.id} where={where} />
    case 'paragraph':
      return tight ? <Fragment key={key}>{renderInline(block.text, where)}</Fragment> : <p key={key}>{renderInline(block.text, where)}</p>
    case 'code':
      return <CodeBlock key={key} lang={block.lang} text={block.text} />
    case 'list': {
      const items = block.items.map((item, i) => {
        const single = item.length === 1 && item[0]!.type === 'paragraph'
        return <li key={i}>{item.map((b, j) => renderBlock(b, where, j, single))}</li>
      })
      return block.ordered ? (
        <ol key={key} start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      )
    }
    case 'quote':
      return <blockquote key={key}>{block.blocks.map((b, j) => renderBlock(b, where, j))}</blockquote>
    case 'table':
      return (
        <div className="doc-table" key={key} tabIndex={0} role="region" aria-label="Table">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, c) => (
                  <th key={c} className={block.align[c] ? `align-${block.align[c]}` : undefined}>
                    {renderInline(cell, where)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className={block.align[c] ? `align-${block.align[c]}` : undefined}>
                      {renderInline(cell, where)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'image': {
      const name = diagramName(block.src)
      return name ? <Diagram key={key} name={name} alt={block.alt} /> : <p key={key}>{block.alt}</p>
    }
    case 'chart':
      return <Chart key={key} name={block.name} />
    case 'rule':
      return <hr key={key} />
  }
}

export function DocBlocks({ blocks, where }: { blocks: Block[]; where: Where }) {
  return <>{blocks.map((block, i) => renderBlock(block, where, i))}</>
}
