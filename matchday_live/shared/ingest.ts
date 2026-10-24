/**
 * What a Mac may send to POST /api/ingest, checked before anything touches
 * the database. The eight tables of the match log, the planned work in
 * upcoming_matches, and their columns are a whitelist: a table or a column
 * that is not here is refused, so the only SQL identifiers that ever reach a
 * query come from this file. `requests` is not here on purpose: a cloud
 * request lives in Supabase and a Mac moves it on over /api/fleet.
 */

export interface TableSpec {
  /** Columns in insert order. */
  columns: readonly string[]
  primaryKey: readonly string[]
  /** Columns a relayed row never overwrites once the row exists. */
  keepOnConflict?: readonly string[]
}

export const INGEST_TABLES: Readonly<Record<string, TableSpec>> = {
  matches: {
    columns: [
      'match_id', 'setpiece_name', 'ask', 'status', 'founder', 'project', 'machine',
      'started_at', 'ended_at', 'total_tokens', 'total_cost', 'archived', 'updated_at',
      // Version 2: the Upcoming Matches ticket this match played.
      'ticket_id',
    ],
    primaryKey: ['match_id'],
    // Archiving is review triage on the page; a Mac re-sending its row must not undo it.
    keepOnConflict: ['archived'],
  },
  objectives: {
    columns: [
      'objective_id', 'match_id', 'seq', 'name', 'kind', 'owner', 'description', 'status',
      'attempt', 'retries', 'error', 'started_at', 'ended_at',
    ],
    primaryKey: ['objective_id'],
  },
  events: {
    columns: [
      'event_id', 'match_id', 'objective_id', 'parent_id', 'type', 'name', 'payload_json',
      'tokens', 'started_at', 'ended_at',
    ],
    primaryKey: ['event_id'],
  },
  match_reports: {
    columns: [
      'report_id', 'match_id', 'objective_id', 'player', 'report_type', 'payload_json', 'valid',
      'attempt', 'created_at',
    ],
    primaryKey: ['report_id'],
  },
  official_reviews: {
    columns: [
      'review_id', 'match_id', 'objective_id', 'attempt', 'review', 'passed', 'violations_json',
      'checks_json', 'created_at',
    ],
    primaryKey: ['review_id'],
  },
  processes: {
    columns: ['process_id', 'match_id', 'kind', 'name', 'pid', 'command', 'started_at', 'ended_at'],
    primaryKey: ['process_id'],
  },
  club_sessions: {
    columns: [
      'match_id', 'player', 'club', 'model', 'color', 'session_id', 'context_tokens',
      'context_window', 'created_at', 'last_used_at',
    ],
    primaryKey: ['match_id', 'player'],
  },
  team_talks: {
    columns: ['match_id', 'player', 'system', 'user', 'updated_at'],
    primaryKey: ['match_id', 'player'],
  },
  // Version 2: planned work. The Mac whose Scheduler owns a ticket is its
  // only writer, so a resend overwrites every column.
  upcoming_matches: {
    columns: [
      'ticket_id', 'source', 'source_ref', 'sprint', 'title', 'date', 'time', 'timezone', 'due_at',
      'set_piece', 'mode', 'prompt', 'player', 'status', 'match_id', 'machine', 'note', 'updated_at',
    ],
    primaryKey: ['ticket_id'],
  },
}

export const MAX_INGEST_ROWS = 500
export const MAX_INGEST_BYTES = 4 * 1024 * 1024

export type CellValue = string | number | null

export interface IngestRow {
  table: string
  row: Record<string, CellValue>
}

export type IngestCheck =
  | { ok: true; machine: string; rows: IngestRow[] }
  | { ok: false; error: string }

/** Check an ingest body. Every error says what to send instead. */
export function validateIngest(body: unknown): IngestCheck {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'send a JSON object: {"machine": "<name>", "rows": [{"table", "row"}]}' }
  }
  const { machine, rows } = body as { machine?: unknown; rows?: unknown }
  if (typeof machine !== 'string' || !machine.trim() || machine.length > 200) {
    return { ok: false, error: '"machine" must be the name of the Mac sending, 1 to 200 characters' }
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: '"rows" must be a non-empty list of {"table", "row"}' }
  }
  if (rows.length > MAX_INGEST_ROWS) {
    return { ok: false, error: `send at most ${MAX_INGEST_ROWS} rows per request; got ${rows.length}` }
  }
  const checked: IngestRow[] = []
  for (const [index, item] of rows.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `rows[${index}] must be {"table", "row"}` }
    }
    const { table, row } = item as { table?: unknown; row?: unknown }
    if (typeof table !== 'string' || !Object.hasOwn(INGEST_TABLES, table)) {
      return {
        ok: false,
        error: `rows[${index}].table must be one of ${Object.keys(INGEST_TABLES).join(', ')}`,
      }
    }
    const spec = INGEST_TABLES[table] as TableSpec
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: `rows[${index}].row must be an object of column values` }
    }
    const cells: Record<string, CellValue> = {}
    for (const [column, value] of Object.entries(row as Record<string, unknown>)) {
      if (!spec.columns.includes(column)) {
        return { ok: false, error: `rows[${index}]: ${table} has no column "${column}"` }
      }
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
        return { ok: false, error: `rows[${index}].${column} must be text, a number or null` }
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        return { ok: false, error: `rows[${index}].${column} must be a finite number` }
      }
      cells[column] = value
    }
    for (const key of spec.primaryKey) {
      const value = cells[key]
      if (typeof value !== 'string' || value === '') {
        return { ok: false, error: `rows[${index}]: ${table}.${key} is the primary key and must be set` }
      }
    }
    checked.push({ table, row: cells })
  }
  return { ok: true, machine: machine.trim(), rows: checked }
}

/**
 * The parameterised upsert for one row: identifiers from the whitelist only,
 * every value a parameter. Returns [sql, values].
 */
export function upsertStatement(input: IngestRow): [string, CellValue[]] {
  const spec = INGEST_TABLES[input.table]
  if (!spec) throw new Error(`no table ${input.table}`)
  const columns = spec.columns.filter((c) => Object.hasOwn(input.row, c))
  const values = columns.map((c) => input.row[c] ?? null)
  const quoted = columns.map((c) => `"${c}"`)
  const placeholders = columns.map((_, i) => `$${i + 1}`)
  const updatable = columns.filter(
    (c) => !spec.primaryKey.includes(c) && !(spec.keepOnConflict ?? []).includes(c),
  )
  const conflict = spec.primaryKey.map((c) => `"${c}"`).join(', ')
  const action = updatable.length
    ? `DO UPDATE SET ${updatable.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`
    : 'DO NOTHING'
  const text =
    `INSERT INTO "${input.table}" (${quoted.join(', ')}) VALUES (${placeholders.join(', ')}) ` +
    `ON CONFLICT (${conflict}) ${action}`
  return [text, values]
}
