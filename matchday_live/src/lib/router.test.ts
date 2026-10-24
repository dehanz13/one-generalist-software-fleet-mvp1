import { describe, expect, it } from 'vitest'
import { type Route, hrefFor, parseRoute, validDate } from './router'

describe('routes', () => {
  const cases: Array<[string, Route]> = [
    ['#/', { page: 'matches' }],
    ['#/m/abc123', { page: 'match', matchId: 'abc123', objectiveId: null }],
    ['#/m/abc123/abc123_02_build', { page: 'match', matchId: 'abc123', objectiveId: 'abc123_02_build' }],
    ['#/days', { page: 'days', date: null }],
    ['#/days/2026-10-12', { page: 'days', date: '2026-10-12' }],
    ['#/report?from=2026-10-12&to=2026-10-16', { page: 'report', from: '2026-10-12', to: '2026-10-16' }],
    ['#/upcoming', { page: 'upcoming' }],
    ['#/docs', { page: 'docs', slug: null }],
    ['#/docs/scheduler', { page: 'docs', slug: 'scheduler' }],
    ['#/guide', { page: 'guide', slug: null }],
    ['#/guide/first-match', { page: 'guide', slug: 'first-match' }],
    ['#/connections', { page: 'connections' }],
    ['#/sign-in', { page: 'sign-in' }],
  ]

  it.each(cases)('reads %s and writes it back', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route)
    expect(parseRoute(hrefFor(route))).toEqual(route)
  })

  it('writes the report period as a query', () => {
    expect(hrefFor({ page: 'report', from: '2026-10-12', to: '2026-10-16' })).toBe('#/report?from=2026-10-12&to=2026-10-16')
    expect(hrefFor({ page: 'report', from: null, to: null })).toBe('#/report')
  })

  it('puts a period given backwards the right way round', () => {
    expect(parseRoute('#/report?to=2026-10-12&from=2026-10-16')).toEqual({ page: 'report', from: '2026-10-12', to: '2026-10-16' })
  })

  it('ignores dates that are not days', () => {
    expect(parseRoute('#/days/2026-02-30')).toEqual({ page: 'days', date: null })
    expect(parseRoute('#/days/yesterday')).toEqual({ page: 'days', date: null })
    expect(parseRoute('#/report?from=soon&to=2026-10-16')).toEqual({ page: 'report', from: null, to: '2026-10-16' })
    expect(validDate('2026-10-17')).toBe('2026-10-17')
  })

  it('falls back to the matches for anything else', () => {
    expect(parseRoute('#/nowhere')).toEqual({ page: 'matches' })
    expect(parseRoute('')).toEqual({ page: 'matches' })
    expect(parseRoute('#/m')).toEqual({ page: 'matches' })
  })

  it('keeps a slug with odd characters intact', () => {
    const route: Route = { page: 'docs', slug: 'set pieces/attack' }
    expect(parseRoute(hrefFor(route))).toEqual({ page: 'docs', slug: 'set pieces/attack' })
  })
})
