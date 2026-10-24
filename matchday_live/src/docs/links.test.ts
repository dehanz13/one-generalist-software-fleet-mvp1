import { describe, expect, it } from 'vitest'
import { joinPath, pageHref, resolveLink } from './links'

describe('resolveLink', () => {
  const fromDocs = { section: 'docs' as const, slug: 'overview' }
  const fromGuide = { section: 'guide' as const, slug: 'install' }

  it('turns a docs page into its hash route, with the heading as ?h=', () => {
    expect(resolveLink('set-pieces.md', fromDocs)).toEqual({ kind: 'page', href: '#/docs/set-pieces' })
    expect(resolveLink('safety.md#the-restricted-area', fromDocs)).toEqual({
      kind: 'page',
      href: '#/docs/safety?h=the-restricted-area',
    })
    expect(resolveLink('guide/install.md', fromDocs)).toEqual({ kind: 'page', href: '#/guide/install' })
  })

  it('resolves guide links against the guide folder', () => {
    expect(resolveLink('first-match.md', fromGuide)).toEqual({ kind: 'page', href: '#/guide/first-match' })
    expect(resolveLink('../safety.md#qa-and-the-progressive-gate', fromGuide)).toEqual({
      kind: 'page',
      href: '#/docs/safety?h=qa-and-the-progressive-gate',
    })
    expect(resolveLink('../README.md', fromGuide)).toEqual({ kind: 'page', href: '#/docs' })
  })

  it('keeps a heading on the same page', () => {
    expect(resolveLink('#exit-codes', fromDocs)).toEqual({ kind: 'page', href: '#/docs/overview?h=exit-codes' })
  })

  it('names a repository file it cannot show, instead of linking nowhere', () => {
    expect(resolveLink('../../wiki/VOCABULARY.md', fromDocs)).toEqual({ kind: 'file', path: 'wiki/VOCABULARY.md' })
  })

  it('opens http(s) elsewhere and never makes an address of anything else', () => {
    expect(resolveLink('https://example.com', fromDocs)).toEqual({ kind: 'external', href: 'https://example.com' })
    expect(resolveLink('javascript:alert(1)', fromDocs)).toEqual({ kind: 'none' })
    expect(resolveLink('data:text/html,x', fromDocs)).toEqual({ kind: 'none' })
    expect(resolveLink('//evil.example', fromDocs)).toEqual({ kind: 'none' })
  })

  it('joins paths and encodes routes', () => {
    expect(joinPath('modernized/docs/guide', '../../x/./y.md')).toBe('modernized/x/y.md')
    expect(pageHref('guide', null)).toBe('#/guide')
    expect(pageHref('docs', 'a b', 'c d')).toBe('#/docs/a%20b?h=c%20d')
  })
})
