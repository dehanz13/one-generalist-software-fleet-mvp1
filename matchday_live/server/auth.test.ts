import { describe, expect, it } from 'vitest'
import {
  bearer,
  clearedCookie,
  hashFleetToken,
  mintFleetToken,
  passwordMatches,
  readCookie,
  sessionCookie,
  signSession,
  verifySession,
} from './auth'

const SECRET = 'x'.repeat(40)
const NOW = Date.parse('2026-10-17T12:00:00Z')

describe('session cookie', () => {
  it('verifies a token it signed, until it runs out', () => {
    const token = signSession(SECRET, NOW, 60)
    expect(verifySession(token, SECRET, NOW)).toBe(true)
    expect(verifySession(token, SECRET, NOW + 59_000)).toBe(true)
    expect(verifySession(token, SECRET, NOW + 61_000)).toBe(false)
  })

  it('refuses a token signed with another secret, or changed in any way', () => {
    const token = signSession(SECRET, NOW)
    expect(verifySession(token, 'y'.repeat(40), NOW)).toBe(false)
    const [payload, signature] = token.split('.') as [string, string]
    const longer = Buffer.from(JSON.stringify({ exp: 9_999_999_999 })).toString('base64url')
    expect(verifySession(`${longer}.${signature}`, SECRET, NOW)).toBe(false)
    expect(verifySession(`${payload}.${signature.slice(0, -2)}AA`, SECRET, NOW)).toBe(false)
    expect(verifySession('', SECRET, NOW)).toBe(false)
    expect(verifySession(undefined, SECRET, NOW)).toBe(false)
    expect(verifySession('nodot', SECRET, NOW)).toBe(false)
  })

  it('is HttpOnly, SameSite=Strict, Secure and lasts seven days', () => {
    const cookie = sessionCookie('abc')
    expect(cookie).toContain('md_session=abc')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=604800')
    expect(clearedCookie()).toContain('Max-Age=0')
    expect(readCookie('a=1; md_session=tok.en; b=2', 'md_session')).toBe('tok.en')
    expect(readCookie(null, 'md_session')).toBeUndefined()
  })
})

describe('password and fleet tokens', () => {
  it('compares passwords exactly', () => {
    expect(passwordMatches('correct horse', 'correct horse')).toBe(true)
    expect(passwordMatches('correct hors', 'correct horse')).toBe(false)
    expect(passwordMatches('', '')).toBe(false)
  })

  it('mints a token whose hash is all that is kept', () => {
    const a = mintFleetToken()
    const b = mintFleetToken()
    expect(a.token).toMatch(/^mdl_[A-Za-z0-9_-]{43}$/)
    expect(a.token).not.toBe(b.token)
    expect(a.hash).toBe(hashFleetToken(a.token))
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.id).toMatch(/^tok_[0-9a-f]{12}$/)
  })

  it('reads a bearer token', () => {
    expect(bearer('Bearer mdl_abc')).toBe('mdl_abc')
    expect(bearer('bearer   mdl_abc  ')).toBe('mdl_abc')
    expect(bearer('Basic abc')).toBeUndefined()
    expect(bearer(null)).toBeUndefined()
  })
})
