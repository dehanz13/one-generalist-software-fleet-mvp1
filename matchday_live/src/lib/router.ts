/**
 * Hash routes, so the page works the same on Vercel, inside the Go binary and
 * from a file server, with no server-side fallback needed:
 *   #/                                  matches
 *   #/m/<match_id>                      one match
 *   #/m/<match_id>/<objective>          one match, one objective open
 *   #/days                              daily reports
 *   #/days/<YYYY-MM-DD>                 one day in full
 *   #/report?from=<date>&to=<date>      the multi-day report
 *   #/upcoming                          Upcoming Matches
 *   #/docs, #/docs/<slug>               docs
 *   #/guide, #/guide/<slug>             the guide
 *   #/connections                       connections
 *   #/sign-in                           sign in to the cloud store
 */
import { useEffect, useState } from 'react'

export type Route =
  | { page: 'matches' }
  | { page: 'match'; matchId: string; objectiveId: string | null }
  | { page: 'days'; date: string | null }
  | { page: 'report'; from: string | null; to: string | null }
  | { page: 'upcoming' }
  | { page: 'docs'; slug: string | null }
  | { page: 'guide'; slug: string | null }
  | { page: 'connections' }
  | { page: 'sign-in' }

export type Page = Route['page']

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A YYYY-MM-DD date that names a real day, or null. */
export function validDate(value: string | null | undefined): string | null {
  if (!value || !DATE.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const day = new Date(Date.UTC(y!, m! - 1, d!))
  return day.toISOString().slice(0, 10) === value ? value : null
}

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const queryAt = raw.indexOf('?')
  const path = queryAt === -1 ? raw : raw.slice(0, queryAt)
  const query = new URLSearchParams(queryAt === -1 ? '' : raw.slice(queryAt + 1))
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  switch (parts[0]) {
    case 'm':
      return parts[1] ? { page: 'match', matchId: parts[1], objectiveId: parts[2] ?? null } : { page: 'matches' }
    case 'days':
      return { page: 'days', date: validDate(parts[1]) }
    case 'report': {
      let from = validDate(query.get('from'))
      let to = validDate(query.get('to'))
      if (from && to && from > to) [from, to] = [to, from]
      return { page: 'report', from, to }
    }
    case 'upcoming':
      return { page: 'upcoming' }
    case 'docs':
      return { page: 'docs', slug: parts[1] ?? null }
    case 'guide':
      return { page: 'guide', slug: parts[1] ?? null }
    case 'connections':
      return { page: 'connections' }
    case 'sign-in':
      return { page: 'sign-in' }
    default:
      return { page: 'matches' }
  }
}

export function hrefFor(route: Route): string {
  switch (route.page) {
    case 'matches':
      return '#/'
    case 'match':
      return `#/m/${encodeURIComponent(route.matchId)}${route.objectiveId ? `/${encodeURIComponent(route.objectiveId)}` : ''}`
    case 'days':
      return route.date ? `#/days/${route.date}` : '#/days'
    case 'report': {
      const query = new URLSearchParams()
      if (route.from) query.set('from', route.from)
      if (route.to) query.set('to', route.to)
      const text = query.toString()
      return text ? `#/report?${text}` : '#/report'
    }
    case 'upcoming':
      return '#/upcoming'
    case 'docs':
      return route.slug ? `#/docs/${encodeURIComponent(route.slug)}` : '#/docs'
    case 'guide':
      return route.slug ? `#/guide/${encodeURIComponent(route.slug)}` : '#/guide'
    case 'connections':
      return '#/connections'
    case 'sign-in':
      return '#/sign-in'
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
