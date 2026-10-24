/**
 * The Connections page's server side: what is set up, applying the schema,
 * and the fleet tokens Macs relay with. Secrets never leave the server: the
 * page sees the NAMES of environment variables and whether each is set.
 */
import type { ConnectionsStatus, ConnectorStatus, EnvStatus, FleetToken, MintedToken } from '../shared/types.js'
import { MIN_SECRET_LENGTH, mintFleetToken } from './auth.js'
import { databaseConfigured, db, nowIso, type Sql } from './db.js'
import { mcpResource } from './oauth.js'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './schema.js'

export type { ConnectorStatus }

export function envStatus(): EnvStatus[] {
  const secret = process.env.MATCHDAY_SESSION_SECRET ?? ''
  return [
    {
      name: 'DATABASE_URL',
      set: databaseConfigured(),
      purpose: "Supabase's transaction pooler connection string (port 6543)",
    },
    {
      name: 'MATCHDAY_PASSWORD',
      set: Boolean(process.env.MATCHDAY_PASSWORD),
      purpose: 'the password for this page',
    },
    {
      name: 'MATCHDAY_SESSION_SECRET',
      set: secret.length >= MIN_SECRET_LENGTH,
      purpose: `${MIN_SECRET_LENGTH}+ random characters that sign the sign-in cookie`,
    },
  ]
}

async function schemaVersion(sql: Sql): Promise<number | null> {
  try {
    const rows = (await sql.unsafe(`select max(version)::int as v from schema_version`)) as unknown as Array<{
      v: number | null
    }>
    return rows[0]?.v ?? null
  } catch {
    return null // the table does not exist yet
  }
}

function connectorStatus(origin: string, reachable: boolean, version: number | null, connections: number | null): ConnectorStatus {
  const url = mcpResource(origin)
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  const reason = !origin.startsWith('https://') && !local
    ? 'the connector needs HTTPS: open this page on its https:// address'
    : !process.env.MATCHDAY_PASSWORD
      ? "set MATCHDAY_PASSWORD: the connector's sign-in page asks for it"
      : (process.env.MATCHDAY_SESSION_SECRET ?? '').length < MIN_SECRET_LENGTH
        ? `set a MATCHDAY_SESSION_SECRET of ${MIN_SECRET_LENGTH}+ characters: it signs the consent form`
        : !reachable
          ? 'the database is not reachable'
          : version === null || version < 2
            ? 'apply the schema (version 2) on this page: the connector keeps its sign-ins there'
            : null
  return { url, ready: reason === null, reason, connections }
}

async function liveConnections(sql: Sql): Promise<number | null> {
  try {
    const rows = (await sql.unsafe(
      `select count(distinct g.grant_id)::int as n
         from oauth_grants g join oauth_tokens t on t.grant_id = g.grant_id
        where g.revoked_at is null and t.kind = 'refresh' and t.revoked_at is null and t.expires_at > $1`,
      [nowIso()],
    )) as unknown as Array<{ n: number }>
    return rows[0]?.n ?? 0
  } catch {
    return null // the version 2 tables do not exist yet
  }
}

/** `origin` is this deployment's public origin: the connector's URL is made from it. */
export async function connectionsStatus(origin: string): Promise<ConnectionsStatus> {
  const env = envStatus()
  if (!databaseConfigured()) {
    return {
      env,
      database: { reachable: false, error: 'DATABASE_URL is not set' },
      schema: { applied: false, version: null, latest: LATEST_SCHEMA_VERSION },
      connector: connectorStatus(origin, false, null, null),
    }
  }
  try {
    const sql = db()
    await sql.unsafe('select 1')
    const version = await schemaVersion(sql)
    return {
      env,
      database: { reachable: true, error: null },
      schema: { applied: version !== null && version >= LATEST_SCHEMA_VERSION, version, latest: LATEST_SCHEMA_VERSION },
      connector: connectorStatus(origin, true, version, version !== null && version >= 2 ? await liveConnections(sql) : null),
    }
  } catch (error) {
    return {
      env,
      database: { reachable: false, error: describeDbError(error) },
      schema: { applied: false, version: null, latest: LATEST_SCHEMA_VERSION },
      connector: connectorStatus(origin, false, null, null),
    }
  }
}

/** A database error, without anything from the connection string. */
export function describeDbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/postgres(ql)?:\/\/\S+/gi, '<connection string>').slice(0, 300)
}

/** Run every migration as it is, in order. Each is written to be safe to run again. */
export async function applySchema(sql: Sql): Promise<number | null> {
  for (const migration of MIGRATIONS) await sql.unsafe(migration.sql)
  return schemaVersion(sql)
}

const TOKEN_COLUMNS = 'id, label, created_at, last_seen_at, revoked_at'

export async function listTokens(sql: Sql): Promise<FleetToken[]> {
  return [
    ...((await sql.unsafe(
      `select ${TOKEN_COLUMNS} from fleet_tokens order by revoked_at nulls first, created_at desc`,
    )) as unknown as FleetToken[]),
  ]
}

export function cleanLabel(label: unknown): string | null {
  if (typeof label !== 'string') return null
  const trimmed = label.trim().replace(/\s+/g, ' ')
  return trimmed && trimmed.length <= 80 ? trimmed : null
}

export async function mintToken(sql: Sql, label: string): Promise<MintedToken> {
  const minted = mintFleetToken()
  const created = nowIso()
  await sql.unsafe(`insert into fleet_tokens (id, label, token_hash, created_at) values ($1, $2, $3, $4)`, [
    minted.id,
    label,
    minted.hash,
    created,
  ])
  return { id: minted.id, label, created_at: created, last_seen_at: null, revoked_at: null, token: minted.token }
}

export async function renameToken(sql: Sql, id: string, label: string): Promise<boolean> {
  const rows = await sql.unsafe(`update fleet_tokens set label = $1 where id = $2 returning id`, [label, id])
  return rows.length > 0
}

export async function revokeToken(sql: Sql, id: string): Promise<boolean> {
  const rows = await sql.unsafe(
    `update fleet_tokens set revoked_at = coalesce(revoked_at, $1) where id = $2 returning id`,
    [nowIso(), id],
  )
  return rows.length > 0
}
