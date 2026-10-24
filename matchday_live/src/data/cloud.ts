/** The cloud deployment's own endpoints: sign-in and the Connections page. */
import type { ConnectionsStatus, ConnectorGrant, FleetToken, MintedToken } from '../../shared/types'
import { ApiFailure } from './source'

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    })
  } catch {
    throw new ApiFailure(0, 'This deployment did not answer. Check your connection and try again.')
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `The server answered ${response.status}.`
    throw new ApiFailure(response.status, message)
  }
  return body as T
}

export const cloud = {
  signedIn: () => call<{ signed_in: boolean }>('/session'),
  signIn: (password: string) => call<{ signed_in: boolean }>('/session', { method: 'POST', body: JSON.stringify({ password }) }),
  signOut: () => call<{ signed_in: boolean }>('/session', { method: 'DELETE' }),
  status: () => call<ConnectionsStatus>('/connections/status'),
  applySchema: () => call<{ applied: boolean; version: number | null }>('/connections/schema', { method: 'POST' }),
  tokens: () => call<FleetToken[]>('/connections/tokens'),
  mint: (label: string) => call<MintedToken>('/connections/tokens', { method: 'POST', body: JSON.stringify({ label }) }),
  rename: (id: string, label: string) =>
    call<{ id: string; label: string }>(`/connections/tokens/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    }),
  revoke: (id: string) =>
    call<{ id: string; revoked: boolean }>(`/connections/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** The Claude connector's live connections. */
  grants: () => call<ConnectorGrant[]>('/connections/grants'),
  revokeGrant: (id: string) =>
    call<{ grant_id: string; revoked: true }>(`/connections/grants/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revokeAllGrants: () => call<{ revoked: number }>('/connections/grants', { method: 'DELETE' }),
}
