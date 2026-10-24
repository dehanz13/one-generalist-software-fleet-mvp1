/**
 * The one connection to Supabase. DATABASE_URL is the transaction pooler
 * string (port 6543), so prepared statements are off: the pooler hands each
 * transaction to whichever backend is free.
 */
import postgres from 'postgres'

export type Sql = postgres.Sql

let client: Sql | null = null

/** True when DATABASE_URL is set. */
export function databaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

/** Thrown when the cloud store is used before DATABASE_URL is set. */
export class NotConfigured extends Error {
  constructor() {
    super('This deployment has no database yet: set DATABASE_URL in Vercel (Settings → Environment Variables) and redeploy.')
  }
}

/** The shared client. Bigints (event cursors, token counts) come back as numbers. */
export function db(): Sql {
  const url = process.env.DATABASE_URL
  if (!url) throw new NotConfigured()
  client ??= postgres(url, {
    prepare: false,
    // A function serves one request at a time; three covers a page's parallel reads.
    // MATCHDAY_DB_POOL=1 is for the tests, whose in-process Postgres has one session.
    max: Number(process.env.MATCHDAY_DB_POOL ?? 3) || 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number) => String(value),
        parse: (raw: string) => Number(raw),
      },
    },
  }) as unknown as Sql
  return client
}

/** The time format the engine writes: ISO-8601 UTC, milliseconds, "+00:00". */
export function nowIso(now = new Date()): string {
  return now.toISOString().replace('Z', '+00:00')
}
