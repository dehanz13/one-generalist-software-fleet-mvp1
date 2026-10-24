/**
 * The docs and the guide, as the page shows them. The Markdown in
 * ./content is a copy of modernized/docs, made by `node docs/sync.mjs`:
 * edit the originals, then sync.
 */
import { parseDoc, type Doc } from './parse'
import type { Section } from './links'

const docsSources = import.meta.glob('./content/docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>
const guideSources = import.meta.glob('./content/guide/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

/** The reading order. A synced page missing from here is listed last, so it is never lost. */
export const ORDER: Record<Section, string[]> = {
  docs: [
    'overview',
    'components',
    'set-pieces',
    'players',
    'safety',
    'match-log',
    'matchday-live',
    'measures',
    'upcoming',
    'remote',
  ],
  guide: [
    'install',
    'first-match',
    'your-workflows',
    'plan-a-sprint',
    'matchday-live-cloud',
    'claude-app',
    'linear',
    'troubleshooting',
  ],
}

export const SECTION_TITLE: Record<Section, string> = { docs: 'Docs', guide: 'Guide' }

export interface Page {
  section: Section
  slug: string
  title: string
  doc: Doc
}

function slugOf(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.md$/, '')
}

function build(section: Section, sources: Record<string, string>): Page[] {
  const bySlug = new Map(Object.entries(sources).map(([path, source]) => [slugOf(path), source]))
  const slugs = [...ORDER[section].filter((s) => bySlug.has(s)), ...[...bySlug.keys()].filter((s) => !ORDER[section].includes(s)).sort()]
  return slugs.map((slug) => {
    const doc = parseDoc(bySlug.get(slug)!)
    return { section, slug, title: doc.title || slug, doc }
  })
}

export const PAGES: Record<Section, Page[]> = {
  docs: build('docs', docsSources),
  guide: build('guide', guideSources),
}

/** The page for a route, or the section's first page when the slug is empty. */
export function findPage(section: Section, slug: string | null): Page | null {
  const pages = PAGES[section]
  if (!slug) return pages[0] ?? null
  return pages.find((p) => p.slug === slug) ?? null
}
