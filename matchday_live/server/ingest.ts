/**
 * POST /api/ingest: a Mac relays the rows its match feed wrote.
 *
 * Authorised by a fleet token (Bearer), looked up by its SHA-256. The rows are
 * upserted by primary key, in the order sent, in one transaction: a relay
 * either lands a batch whole or not at all, and retries it.
 */
import { MAX_INGEST_BYTES, upsertStatement, validateIngest } from '../shared/ingest.js'
import { bearer, hashFleetToken } from './auth.js'
import { nowIso, type Sql } from './db.js'
import { fail, json, readJson } from './http.js'

/**
 * The fleet token of a request (Bearer), looked up by its SHA-256: its id,
 * or the 401 to send. Ingest and the fleet routes share it.
 */
export async function fleetTokenId(sql: Sql, request: Request): Promise<string | Response> {
  const token = bearer(request.headers.get('authorization'))
  if (!token) {
    return fail(401, 'send the fleet token as "Authorization: Bearer <token>" (CLUB_RELAY_TOKEN on the Mac)', {
      'www-authenticate': 'Bearer',
    })
  }
  const found = (await sql.unsafe(
    `select id from fleet_tokens where token_hash = $1 and revoked_at is null`,
    [hashFleetToken(token)],
  )) as unknown as Array<{ id: string }>
  const tokenId = found[0]?.id
  if (!tokenId) {
    return fail(401, 'this fleet token is unknown or revoked; mint a new one on the Connections page', {
      'www-authenticate': 'Bearer',
    })
  }
  return tokenId
}

export async function ingest(sql: Sql, request: Request): Promise<Response> {
  const tokenId = await fleetTokenId(sql, request)
  if (tokenId instanceof Response) return tokenId

  const body = await readJson(request, MAX_INGEST_BYTES)
  if (body instanceof Response) return body
  const checked = validateIngest(body)
  if (!checked.ok) return fail(400, checked.error)

  await sql.begin(async (tx) => {
    for (const row of checked.rows) {
      const [text, values] = upsertStatement(row)
      await tx.unsafe(text, values)
    }
    await tx.unsafe(`update fleet_tokens set last_seen_at = $1 where id = $2`, [nowIso(), tokenId])
  })
  return json({ accepted: checked.rows.length })
}
