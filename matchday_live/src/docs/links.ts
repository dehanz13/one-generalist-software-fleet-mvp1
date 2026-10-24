/**
 * Where a link in the docs goes on this page. The Markdown links are
 * relative file paths, written so they work on GitHub; here a page is a
 * hash route (`#/docs/<slug>`, `#/guide/<slug>`) and a heading is `?h=<id>`
 * on that route, because a bare `#id` would replace the route itself.
 */

export type Section = 'docs' | 'guide'

export type Target =
  /** http(s) or mailto: opens elsewhere. */
  | { kind: 'external'; href: string }
  /** Another docs page, or a heading on one. */
  | { kind: 'page'; href: string }
  /** A file in the repository that is not a docs page: shown, not linked. */
  | { kind: 'file'; path: string }
  /** Anything else (javascript:, data:, …): never an address. */
  | { kind: 'none' }

/** Where each section's Markdown lives in the repository. */
const DIRS: Record<Section, string> = { docs: 'modernized/docs', guide: 'modernized/docs/guide' }

export function pageHref(section: Section, slug: string | null, heading?: string | null): string {
  const base = slug ? `#/${section}/${encodeURIComponent(slug)}` : `#/${section}`
  return heading ? `${base}?h=${encodeURIComponent(heading)}` : base
}

/** Joins a relative path onto a directory, resolving `.` and `..`. */
export function joinPath(dir: string, relative: string): string {
  const parts = dir.split('/').filter(Boolean)
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/** A repository path to a docs page, or null when it is not one. */
export function pageOf(path: string): { section: Section; slug: string | null } | null {
  const guide = /^modernized\/docs\/guide\/([\w-]+)\.md$/.exec(path)
  if (guide) return { section: 'guide', slug: guide[1] === 'README' ? null : guide[1]! }
  const docs = /^modernized\/docs\/([\w-]+)\.md$/.exec(path)
  if (docs) return { section: 'docs', slug: docs[1] === 'README' ? null : docs[1]! }
  return null
}

export function resolveLink(href: string, from: { section: Section; slug: string }): Target {
  const url = href.trim()
  if (/^(https?:|mailto:)/i.test(url)) return { kind: 'external', href: url }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return { kind: 'none' }

  const hashAt = url.indexOf('#')
  const path = hashAt === -1 ? url : url.slice(0, hashAt)
  const heading = hashAt === -1 ? null : decodeURIComponent(url.slice(hashAt + 1)) || null

  if (path === '') return { kind: 'page', href: pageHref(from.section, from.slug, heading) }

  const full = joinPath(DIRS[from.section], path)
  const page = pageOf(full)
  if (page) return { kind: 'page', href: pageHref(page.section, page.slug, heading) }

  // modernized/… is the fleet's own folder; anything above it is the wider
  // repository (the wiki, the legacy factory).
  return { kind: 'file', path: full.replace(/^modernized\//, '') }
}
