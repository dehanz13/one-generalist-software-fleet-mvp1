import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CHART_NAMES } from './charts/Charts'
import { PAGES, findPage, ORDER } from './content'
import { diagramFiles, diagramName } from './Diagram'
import { resolveLink, type Section } from './links'
import type { Block } from './parse'
import { DocBlocks } from './render'

// The originals, to prove the copy in ./content is current.
const originals = {
  docs: import.meta.glob('../../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  guide: import.meta.glob('../../../docs/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
}
const copies = {
  docs: import.meta.glob('./content/docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  guide: import.meta.glob('./content/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
}

const sections: Section[] = ['docs', 'guide']

function walk(blocks: Block[], visit: (b: Block) => void) {
  for (const b of blocks) {
    visit(b)
    if (b.type === 'list') b.items.forEach((item) => walk(item, visit))
    if (b.type === 'quote') walk(b.blocks, visit)
  }
}

/** Every inline link target in a block's text. */
function linksIn(b: Block): string[] {
  const texts =
    b.type === 'paragraph' || b.type === 'heading'
      ? [b.text]
      : b.type === 'table'
        ? [...b.head, ...b.rows.flat()]
        : []
  return texts.flatMap((t) => [...t.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!))
}

describe('the docs content', () => {
  it('is the same as modernized/docs (run `node docs/sync.mjs` after editing)', () => {
    for (const section of sections) {
      const name = (p: string) => p.replace(/^.*\//, '')
      const original = Object.fromEntries(
        Object.entries(originals[section])
          .filter(([p]) => name(p) !== 'README.md')
          .map(([p, s]) => [name(p), s]),
      )
      const copy = Object.fromEntries(Object.entries(copies[section]).map(([p, s]) => [name(p), s]))
      expect(Object.keys(copy).sort()).toEqual(Object.keys(original).sort())
      for (const file of Object.keys(original)) expect(copy[file], `${section}/${file}`).toBe(original[file])
    }
  })

  it('lists every page in reading order, each with a title', () => {
    for (const section of sections) {
      expect(PAGES[section].map((p) => p.slug)).toEqual(ORDER[section])
      for (const page of PAGES[section]) expect(page.title, page.slug).not.toBe(page.slug)
    }
    expect(findPage('docs', null)?.slug).toBe('overview')
    expect(findPage('guide', 'nope')).toBeNull()
  })

  it('points only at diagrams that exist, in light, dark and as a scene', () => {
    let seen = 0
    for (const section of sections) {
      for (const page of PAGES[section]) {
        walk(page.doc.blocks, (b) => {
          if (b.type !== 'image') return
          const name = diagramName(b.src)
          expect(name, `${page.slug}: ${b.src}`).not.toBeNull()
          const files = diagramFiles(name!)
          expect(files, `${page.slug}: ${b.src}`).not.toBeNull()
          expect(files!.dark).not.toBe(files!.light)
          expect(files!.scene).not.toBeNull()
          seen++
        })
      }
    }
    expect(seen).toBeGreaterThanOrEqual(7)
  })

  it('names only charts the page can draw', () => {
    for (const section of sections) {
      for (const page of PAGES[section]) {
        walk(page.doc.blocks, (b) => {
          if (b.type === 'chart') expect(CHART_NAMES, `${page.slug}: ${b.name}`).toContain(b.name)
        })
      }
    }
  })

  it('links only to pages and headings that exist', () => {
    for (const section of sections) {
      for (const page of PAGES[section]) {
        walk(page.doc.blocks, (b) => {
          for (const href of linksIn(b)) {
            const target = resolveLink(href, { section, slug: page.slug })
            if (target.kind !== 'page') continue
            const match = /^#\/(docs|guide)(?:\/([^?]+))?(?:\?h=(.+))?$/.exec(target.href)
            expect(match, `${page.slug}: ${href}`).not.toBeNull()
            const linked = findPage(match![1] as Section, match![2] ? decodeURIComponent(match![2]) : null)
            expect(linked, `${section}/${page.slug} links to a missing page: ${href}`).not.toBeNull()
            if (match![3]) {
              const id = decodeURIComponent(match![3])
              expect(
                linked!.doc.headings.map((h) => h.id),
                `${section}/${page.slug} links to a missing heading: ${href}`,
              ).toContain(id)
            }
          }
        })
      }
    }
  })

  it('renders every page without markup from the text', () => {
    for (const section of sections) {
      for (const page of PAGES[section]) {
        const html = renderToStaticMarkup(<DocBlocks blocks={page.doc.blocks} where={{ section, slug: page.slug }} />)
        expect(html).toContain('<h1')
        expect(html).not.toContain('<script')
        expect(html).not.toMatch(/href="(?!https?:|#\/|\/)/)
      }
    }
  })
})
