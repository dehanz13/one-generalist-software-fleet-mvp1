/**
 * The Docs and the Guide: a contents list on the left (a menu on a phone),
 * the page in the middle, and the way to the previous and next page under
 * it. A heading is addressed as `?h=<id>` on the page's route, so every
 * section has a link that survives a reload and can be shared.
 */
import { BookOpen, ChevronLeft, ChevronRight, Compass, Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PAGES, SECTION_TITLE, findPage } from './content'
import { pageHref, type Section } from './links'
import { DocBlocks } from './render'
import './docs.css'

/** The `?h=` of the current hash route, kept in step with the address bar. */
function useHeadingParam(): string | null {
  const read = () => {
    if (typeof window === 'undefined') return null
    const hash = window.location.hash
    const at = hash.indexOf('?')
    return at === -1 ? null : new URLSearchParams(hash.slice(at + 1)).get('h')
  }
  const [heading, setHeading] = useState(read)
  useEffect(() => {
    const onChange = () => setHeading(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return heading
}

export function DocsLayout({ section, slug }: { section: Section; slug: string | null }) {
  const page = findPage(section, slug)
  const pages = PAGES[section]
  const heading = useHeadingParam()
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    document.title = page ? `${page.title} · ${SECTION_TITLE[section]} · Matchday Live` : `${SECTION_TITLE[section]} · Matchday Live`
    // The other sections set no title of their own: give it back on the way out.
    return () => {
      document.title = 'Matchday Live'
    }
  }, [page, section])

  // A new page starts at its top, or at the heading the address names.
  useEffect(() => {
    setMenuOpen(false)
    const target = heading ? document.getElementById(heading) : null
    if (target) target.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0 })
  }, [page?.slug, section, heading])

  const index = page ? pages.indexOf(page) : -1
  const previous = index > 0 ? pages[index - 1] : null
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null
  const other: Section = section === 'docs' ? 'guide' : 'docs'

  return (
    <div className={`docs ${menuOpen ? 'menu-open' : ''}`}>
      <aside className="docs-side">
        <button
          type="button"
          className="docs-menu-button"
          aria-expanded={menuOpen}
          aria-controls="docs-contents"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          <span className="docs-menu-label">
            {SECTION_TITLE[section]}
            {page ? <span className="docs-menu-current"> · {page.title}</span> : null}
          </span>
        </button>
        <nav id="docs-contents" className="docs-nav" aria-label={`${SECTION_TITLE[section]} contents`}>
          <div className="docs-tabs">
            <a href={pageHref('docs', null)} aria-current={section === 'docs' ? 'page' : undefined}>
              <BookOpen size={15} aria-hidden="true" /> Docs
            </a>
            <a href={pageHref('guide', null)} aria-current={section === 'guide' ? 'page' : undefined}>
              <Compass size={15} aria-hidden="true" /> Guide
            </a>
          </div>
          <ol className="docs-pages">
            {pages.map((p) => {
              const current = p === page
              return (
                <li key={p.slug}>
                  <a href={pageHref(section, p.slug)} aria-current={current ? 'page' : undefined}>
                    {p.title}
                  </a>
                  {current ? (
                    <ul className="docs-headings">
                      {p.doc.headings
                        .filter((h) => h.level === 2)
                        .map((h) => (
                          <li key={h.id}>
                            <a href={pageHref(section, p.slug, h.id)} aria-current={heading === h.id ? 'location' : undefined}>
                              {h.text.replace(/`/g, '')}
                            </a>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </nav>
      </aside>

      <article className="doc">
        {page ? (
          <DocBlocks blocks={page.doc.blocks} where={{ section, slug: page.slug }} />
        ) : (
          <>
            <h1 className="doc-title">No such page</h1>
            <p>
              There is no {section === 'docs' ? 'docs' : 'guide'} page called “{slug}”.{' '}
              <a href={pageHref(section, null)}>Start at the beginning.</a>
            </p>
          </>
        )}

        <nav className="doc-pager" aria-label="More pages">
          {previous ? (
            <a className="doc-pager-link prev" href={pageHref(section, previous.slug)}>
              <ChevronLeft size={18} aria-hidden="true" />
              <span>
                <span className="doc-pager-hint">Previous</span>
                <span className="doc-pager-title">{previous.title}</span>
              </span>
            </a>
          ) : (
            <span />
          )}
          {next ? (
            <a className="doc-pager-link next" href={pageHref(section, next.slug)}>
              <span>
                <span className="doc-pager-hint">Next</span>
                <span className="doc-pager-title">{next.title}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
          ) : (
            <a className="doc-pager-link next" href={pageHref(other, null)}>
              <span>
                <span className="doc-pager-hint">{other === 'guide' ? 'Now try it' : 'How it works'}</span>
                <span className="doc-pager-title">The {SECTION_TITLE[other]}</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
          )}
        </nav>
      </article>
    </div>
  )
}
