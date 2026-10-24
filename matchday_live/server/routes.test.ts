import { describe, expect, it } from 'vitest'
import { sseMessage } from './live'
import { routeSegments } from './routes'

describe('routeSegments', () => {
  it('reads the route a rewrite passed in the query', () => {
    expect(routeSegments(new URL('https://x.app/api/router?route=matches/abc/events&after=3'))).toEqual(['matches', 'abc', 'events'])
  })

  it('falls back to the path', () => {
    expect(routeSegments(new URL('http://localhost/api/matches/abc'))).toEqual(['matches', 'abc'])
    expect(routeSegments(new URL('http://localhost/api/health'))).toEqual(['health'])
  })
})

describe('sseMessage', () => {
  it('writes one event with its id, on one data line', () => {
    expect(sseMessage('events', { a: 'x\ny' }, 7)).toBe('id: 7\nevent: events\ndata: {"a":"x\\ny"}\n\n')
    expect(sseMessage('ping', {})).toBe('event: ping\ndata: {}\n\n')
  })
})
