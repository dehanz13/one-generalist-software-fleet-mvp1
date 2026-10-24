import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './schema'

const folder = join(__dirname, '..', '..', 'supabase', 'migrations')

describe('the embedded schema', () => {
  it('is every Supabase migration, in order, byte for byte (run scripts/sync-schema.mjs after editing one)', () => {
    const files = readdirSync(folder).filter((f) => f.endsWith('.sql')).sort()
    expect(MIGRATIONS.map((m) => m.file)).toEqual(files)
    for (const m of MIGRATIONS) expect(m.sql).toBe(readFileSync(join(folder, m.file), 'utf8'))
    expect(LATEST_SCHEMA_VERSION).toBe(2)
  })

  it('turns row level security on for every table and defines no policy', () => {
    const all = MIGRATIONS.map((m) => m.sql).join('\n')
    const tables = [...all.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1])
    expect(tables).toHaveLength(16)
    for (const table of tables) expect(all).toMatch(new RegExp(`alter table ${table}\\s+enable row level security`))
    expect(all.toLowerCase()).not.toContain('create policy')
  })

  it('keeps no OAuth secret in the clear: codes, tokens and client secrets are stored as hashes', () => {
    const connector = MIGRATIONS[1]!.sql
    for (const table of ['oauth_codes', 'oauth_tokens']) {
      const body = new RegExp(`create table if not exists ${table} \\(([^;]+)\\);`).exec(connector)?.[1] ?? ''
      expect(body).toMatch(/_hash\s+text primary key/)
      expect(body).not.toMatch(/^\s*(code|token|access_token|refresh_token)\s/m)
    }
    expect(connector).toContain('secret_hash')
  })
})
