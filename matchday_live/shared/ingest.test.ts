import { describe, expect, it } from 'vitest'
import { INGEST_TABLES, MAX_INGEST_ROWS, upsertStatement, validateIngest } from './ingest'

const match = { match_id: 'abcd1234', status: 'running', archived: 0, total_cost: 0.5 }

describe('validateIngest', () => {
  it('accepts rows of the eight match log tables and the planned work', () => {
    const result = validateIngest({ machine: ' studio ', rows: [{ table: 'matches', row: match }] })
    expect(result).toEqual({ ok: true, machine: 'studio', rows: [{ table: 'matches', row: match }] })
    expect(Object.keys(INGEST_TABLES).sort()).toEqual(
      ['club_sessions', 'events', 'match_reports', 'matches', 'objectives', 'official_reviews', 'processes', 'team_talks', 'upcoming_matches'].sort(),
    )
  })

  it('takes the ticket a match played, and upcoming_matches rows by ticket id', () => {
    const played = validateIngest({ machine: 'm', rows: [{ table: 'matches', row: { ...match, ticket_id: 'KICK-7' } }] })
    expect(played).toMatchObject({ ok: true })
    const ticket = {
      ticket_id: 'KICK-7', source: 'markdown', source_ref: 'sprints/14.md', sprint: 'Sprint 14', title: 'Fix the login',
      date: '2026-10-20', time: '09:30', timezone: 'America/Chicago', due_at: '2026-10-20T14:30:00.000+00:00',
      set_piece: 'run-heroic', mode: 'auto', prompt: 'fix it', player: null, status: 'scheduled', match_id: null,
      machine: 'studio', note: null, updated_at: '2026-10-17T10:00:00.000+00:00',
    }
    expect(validateIngest({ machine: 'm', rows: [{ table: 'upcoming_matches', row: ticket }] })).toMatchObject({ ok: true })
    expect(validateIngest({ machine: 'm', rows: [{ table: 'upcoming_matches', row: { title: 'no id' } }] })).toMatchObject({ ok: false })
    expect(validateIngest({ machine: 'm', rows: [{ table: 'upcoming_matches', row: { ticket_id: 'K', owner: 'x' } }] })).toMatchObject({
      ok: false,
    })
  })

  it('never takes a request over ingest: requests move only over the fleet API', () => {
    const result = validateIngest({ machine: 'm', rows: [{ table: 'requests', row: { request_id: 'req_1', status: 'touchdown' } }] })
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses an unknown table or column, so no identifier comes from the request', () => {
    expect(validateIngest({ machine: 'm', rows: [{ table: 'fleet_tokens', row: { id: 'x' } }] })).toMatchObject({ ok: false })
    const bad = validateIngest({ machine: 'm', rows: [{ table: 'matches', row: { ...match, 'status; drop table matches': 1 } }] })
    expect(bad).toMatchObject({ ok: false })
    if (!bad.ok) expect(bad.error).toContain('has no column')
  })

  it('refuses the generated event cursor', () => {
    const result = validateIngest({ machine: 'm', rows: [{ table: 'events', row: { event_id: 'evt_1', cursor: 9 } }] })
    expect(result).toMatchObject({ ok: false })
  })

  it('needs the primary key, a machine, and plain values', () => {
    expect(validateIngest({ machine: 'm', rows: [{ table: 'matches', row: { status: 'x' } }] })).toMatchObject({ ok: false })
    expect(validateIngest({ machine: '', rows: [{ table: 'matches', row: match }] })).toMatchObject({ ok: false })
    expect(validateIngest({ machine: 'm', rows: [{ table: 'matches', row: { ...match, ask: { nested: true } } }] })).toMatchObject({
      ok: false,
    })
    expect(validateIngest({ machine: 'm', rows: [{ table: 'matches', row: { ...match, total_cost: Infinity } }] })).toMatchObject({
      ok: false,
    })
    expect(validateIngest(null)).toMatchObject({ ok: false })
    expect(validateIngest({ machine: 'm', rows: [] })).toMatchObject({ ok: false })
  })

  it(`refuses more than ${MAX_INGEST_ROWS} rows`, () => {
    const rows = Array.from({ length: MAX_INGEST_ROWS + 1 }, (_, i) => ({ table: 'matches', row: { match_id: `m${i}` } }))
    expect(validateIngest({ machine: 'm', rows })).toMatchObject({ ok: false })
  })
})

describe('upsertStatement', () => {
  it('quotes whitelisted identifiers and parameterises every value', () => {
    const [text, values] = upsertStatement({ table: 'team_talks', row: { match_id: 'm', player: 'bard', user: 'u', system: 's' } })
    expect(text).toBe(
      'INSERT INTO "team_talks" ("match_id", "player", "system", "user") VALUES ($1, $2, $3, $4) ' +
        'ON CONFLICT ("match_id", "player") DO UPDATE SET "system" = EXCLUDED."system", "user" = EXCLUDED."user"',
    )
    expect(values).toEqual(['m', 'bard', 's', 'u'])
  })

  it('never lets a relayed match row undo an archive made on the page', () => {
    const [text] = upsertStatement({ table: 'matches', row: { match_id: 'm', archived: 0, status: 'touchdown' } })
    expect(text).toContain('"status" = EXCLUDED."status"')
    expect(text).not.toContain('"archived" = EXCLUDED')
  })

  it('quotes the date and time columns of a ticket, which are SQL words', () => {
    const [text, values] = upsertStatement({ table: 'upcoming_matches', row: { ticket_id: 'K-1', date: '2026-10-20', time: '09:30' } })
    expect(text).toBe(
      'INSERT INTO "upcoming_matches" ("ticket_id", "date", "time") VALUES ($1, $2, $3) ' +
        'ON CONFLICT ("ticket_id") DO UPDATE SET "date" = EXCLUDED."date", "time" = EXCLUDED."time"',
    )
    expect(values).toEqual(['K-1', '2026-10-20', '09:30'])
  })

  it('does nothing on conflict when only the key was sent', () => {
    const [text] = upsertStatement({ table: 'events', row: { event_id: 'evt_1' } })
    expect(text).toContain('DO NOTHING')
  })
})
