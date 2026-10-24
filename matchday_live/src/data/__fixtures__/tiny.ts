import type { DemoDataset, DemoMatch, EventRow, RequestRow, UpcomingMatchRow } from '../../../shared/types'

const T0 = Date.parse('2026-10-17T10:00:00.000Z')
export const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString().replace('Z', '+00:00')

function ev(cursor: number, match: string, seconds: number, patch: Partial<EventRow>): EventRow {
  return {
    cursor,
    event_id: `evt_${match}_${cursor}`,
    match_id: match,
    objective_id: null,
    parent_id: null,
    type: 'log',
    name: 'console',
    payload_json: '{"message":"hi","level":"info"}',
    tokens: null,
    started_at: at(seconds),
    ended_at: null,
    ...patch,
  }
}

/** Two matches: m1 runs 0..60 s with a player objective, m2 starts 120 s later and fails. */
export function tinyDataset(): DemoDataset {
  const m1: DemoMatch = {
    match: {
      match_id: 'm1', setpiece_name: 'team-talk', ask: 'plan it', status: 'touchdown', founder: 'dani', project: 'p',
      machine: 'mac', started_at: at(0), ended_at: at(60), total_tokens: 500, total_cost: 0.25, archived: 0, updated_at: at(60),
    },
    objectives: [
      { objective_id: 'm1_01_ask', match_id: 'm1', seq: 1, name: 'ask', kind: 'head_coach', owner: 'dani', description: 'Capture',
        status: 'touchdown', attempt: 0, retries: 0, error: null, started_at: at(0), ended_at: at(1) },
      { objective_id: 'm1_02_spec', match_id: 'm1', seq: 2, name: 'spec', kind: 'player', owner: 'playmaker', description: 'Plan',
        status: 'touchdown', attempt: 0, retries: 0, error: null, started_at: at(1), ended_at: at(60) },
    ],
    players: [
      { match_id: 'm1', player: 'playmaker', club: 'pi', model: 'anthropic/claude', color: '#a78bfa', session_id: 's',
        context_tokens: 100, context_window: 1000, created_at: at(59), last_used_at: at(59) },
    ],
    events: [
      ev(1, 'm1', 0, { objective_id: 'm1_01_ask', type: 'objective_start', name: 'ask' }),
      ev(2, 'm1', 1, { objective_id: 'm1_02_spec', type: 'raider_start', name: 'playmaker', payload_json: '{"model":"anthropic/claude"}' }),
      // A span: started at 10 s, recorded when it ended at 20 s.
      ev(3, 'm1', 10, { objective_id: 'm1_02_spec', type: 'ability_cast', name: 'bash: ls', ended_at: at(20), payload_json: '{"tool":"bash","ok":true}' }),
      ev(4, 'm1', 59, { objective_id: 'm1_02_spec', type: 'raider_end', name: 'playmaker', tokens: 500,
        payload_json: '{"cost":0.25,"usage":{"input_tokens":10,"output_tokens":20,"cache_write_tokens":5}}' }),
      ev(5, 'm1', 60, { objective_id: 'm1_02_spec', type: 'objective_end', name: 'spec', payload_json: '{"status":"touchdown"}' }),
    ],
    reports: [
      { report_id: 'rep_1', match_id: 'm1', objective_id: 'm1_02_spec', player: 'playmaker', report_type: 'TalkReport',
        payload_json: '{"status":"touchdown"}', valid: 1, attempt: 1, created_at: at(58) },
    ],
    reviews: [
      { review_id: 'rev_1', match_id: 'm1', objective_id: 'm1_02_spec', attempt: 1, review: 'ball_in_play', passed: 1,
        violations_json: '[]', checks_json: '[]', created_at: at(58) },
    ],
    processes: [
      { process_id: 'p1', match_id: 'm1', kind: 'setpiece', name: '', pid: 1, command: 'ogsf team-talk', started_at: at(0), ended_at: at(60) },
    ],
    team_talks: [{ player: 'playmaker', system: '# Playmaker', user: 'plan it' }],
  }
  const m2: DemoMatch = {
    ...m1,
    match: { ...m1.match, match_id: 'm2', status: 'turnover', started_at: at(1000), ended_at: at(1010), updated_at: at(1010) },
    objectives: [
      { ...m1.objectives[0]!, objective_id: 'm2_01_ask', match_id: 'm2', started_at: at(1000), ended_at: at(1001) },
    ],
    players: [],
    events: [ev(1, 'm2', 1000, { objective_id: 'm2_01_ask', type: 'objective_start', name: 'ask' })],
    reports: [],
    reviews: [],
    processes: [],
    team_talks: [],
  }
  return { version: 1, generated_at: at(2000), title: 'tiny', matches: [m2, m1] }
}

/**
 * The same two matches as a version 2 recording: m1 played ticket KICK-1, m2
 * came from a request; KICK-2 is still to come, KICK-3 was skipped, and one
 * request was refused before anything ran.
 */
export function tinyDatasetV2(): DemoDataset {
  const base = tinyDataset()
  const matches = base.matches.map((m) => (m.match.match_id === 'm1' ? { ...m, match: { ...m.match, ticket_id: 'KICK-1' } } : m))
  const ticket = (patch: Partial<UpcomingMatchRow> & { ticket_id: string }): UpcomingMatchRow => ({
    source: 'markdown', source_ref: 'set_pieces/upcoming/sprint-14.md', sprint: 'Sprint 14', title: patch.ticket_id,
    date: '2026-10-17', time: '05:00', timezone: 'America/Chicago', due_at: at(-5), set_piece: 'team-talk', mode: 'auto',
    prompt: 'plan it', player: null, status: 'scheduled', match_id: null, machine: 'mac', note: null, updated_at: at(0),
    ...patch,
  })
  const request = (patch: Partial<RequestRow> & { request_id: string }): RequestRow => ({
    created_at: at(500), requested_by: 'page', kind: 'set_piece', set_piece: 'ask', prompt: 'hi', player: 'ranger',
    ticket_id: null, machine: null, status: 'queued', claimed_by: null, match_id: null, note: null, updated_at: at(500),
    ...patch,
  })
  return {
    ...base,
    version: 2,
    matches,
    upcoming: [
      // Linked through matches.ticket_id only.
      ticket({ ticket_id: 'KICK-1', status: 'touchdown' }),
      ticket({ ticket_id: 'KICK-2', due_at: at(5000), date: '2026-10-18', status: 'scheduled' }),
      ticket({ ticket_id: 'KICK-3', due_at: at(30), status: 'skipped', note: 'manual: nobody started it' }),
    ],
    requests: [
      request({ request_id: 'req_m2', status: 'turnover', claimed_by: 'mac', match_id: 'm2', updated_at: at(1010) }),
      request({ request_id: 'req_refused', created_at: at(20), updated_at: at(40), set_piece: 'play', status: 'refused', note: 'play is not allowed' }),
      request({ request_id: 'req_later', created_at: at(9000), updated_at: at(9000) }),
    ],
  }
}
