/**
 * Signing in to the cloud page, and the fleet tokens Macs relay with.
 *
 * The session cookie is `<payload>.<signature>`: the payload is base64url JSON
 * holding its expiry, the signature an HMAC-SHA256 of the payload under
 * MATCHDAY_SESSION_SECRET. Nothing secret is in the cookie; it only proves
 * that this server issued it, and when it runs out.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'md_session'
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

/** A secret shorter than this is refused: it would sign cookies anyone could forge. */
export const MIN_SECRET_LENGTH = 32

function base64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url')
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** A signed session token that runs out `maxAgeSeconds` after `nowMs`. */
export function signSession(secret: string, nowMs: number, maxAgeSeconds = SESSION_MAX_AGE_SECONDS): string {
  const payload = base64url(JSON.stringify({ exp: Math.floor(nowMs / 1000) + maxAgeSeconds }))
  return `${payload}.${sign(payload, secret)}`
}

/** True only for a token this secret signed and that has not run out. */
export function verifySession(token: string | undefined, secret: string, nowMs: number): boolean {
  if (!token || !secret) return false
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return false
  const payload = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(payload, secret))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof exp === 'number' && exp * 1000 > nowMs
  } catch {
    return false
  }
}

/**
 * Compare a password in constant time. Both sides are hashed first, so the
 * comparison takes the same time whatever their lengths.
 */
export function passwordMatches(given: string, expected: string): boolean {
  if (!expected) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** The Set-Cookie value that signs a browser in. */
export function sessionCookie(token: string, secure = true): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join('; ')
}

/** The Set-Cookie value that signs a browser out. */
export function clearedCookie(secure = true): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', ...(secure ? ['Secure'] : []), 'SameSite=Strict', 'Max-Age=0'].join('; ')
}

/** Read one cookie from a Cookie header. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/** A new fleet token: what the Mac keeps, and the hash the database keeps. */
export function mintFleetToken(): { token: string; hash: string; id: string } {
  const token = `mdl_${randomBytes(32).toString('base64url')}`
  return { token, hash: hashFleetToken(token), id: `tok_${randomBytes(6).toString('hex')}` }
}

/** The SHA-256 (hex) a fleet token is stored and looked up by. */
export function hashFleetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** The bearer token of a request, or undefined. */
export function bearer(header: string | null): string | undefined {
  if (!header) return undefined
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1]
}
