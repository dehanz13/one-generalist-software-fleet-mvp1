import { describe, expect, it } from 'vitest'
import { mergePlayers, parsePayload, usageFromEvents } from './players'
import type { EventRow, ObjectiveRow, PlayerRow } from './types'

const event = (cursor: number, patch: Partial<EventRow>): EventRow => ({
  cursor,
  event_id: `evt_${cursor}`,
  match_id: 'm1',
  objective_id: null,
  parent_id: null,
  type: null,
  name: null,
  payload_json: null,
  tokens: null,
  started_at: '2026-10-17T10:00:00.000+00:00',
  ended_at: null,
  ...patch,
})

const objective = (id: string, owner: string): ObjectiveRow => ({
  objective_id: id,
  match_id: 'm1',
  seq: 1,
  name: 'spec',
  kind: 'player',
  owner,
  description: null,
  status: 'running',
  attempt: 0,
  retries: 0,
  error: null,
  started_at: null,
  ended_at: null,
})

const finished: PlayerRow = {
  match_id: 'm1',
  player: 'playmaker',
  club: 'pi',
  model: 'anthropic/claude-sonnet-5-5',
  color: '#a78bfa',
  session_id: 's1',
  context_tokens: 1000,
  context_window: 200000,
  created_at: '2026-10-17T10:01:00.000+00:00',
  last_used_at: '2026-10-17T10:01:00.000+00:00',
}

describe('mergePlayers (the contract rule)', () => {
  it('keeps every finished row and adds a running player from its raider_start', () => {
    const events = [
      event(1, { type: 'raider_start', name: 'playmaker', objective_id: 'o1', payload_json: '{"model":"x/old"}' }),
      event(2, {
        type: 'raider_start',
        name: 'builder',
        objective_id: 'o2',
        started_at: '2026-10-17T10:02:00.000+00:00',
        payload_json: JSON.stringify({ model: 'openai/gpt-5', color: '#22d3ee', session_id: 's2' }),
      }),
    ]
    const players = mergePlayers([finished], events, [objective('o1', 'playmaker'), objective('o2', 'builder')])
    expect(players.map((p) => p.player)).toEqual(['playmaker', 'builder'])
    // A finished row is authoritative: its model is not overwritten by the start.
    expect(players[0]?.model).toBe('anthropic/claude-sonnet-5-5')
    expect(players[1]).toMatchObject({
      club: null,
      model: 'openai/gpt-5',
      color: '#22d3ee',
      session_id: 's2',
      context_tokens: null,
      context_window: null,
      created_at: '2026-10-17T10:02:00.000+00:00',
    })
  })

  it('names a running player by its objective owner before the event name', () => {
    const events = [event(1, { type: 'raider_start', name: 'other', objective_id: 'o9', payload_json: '{}' })]
    expect(mergePlayers([], events, [objective('o9', 'ranger')]).map((p) => p.player)).toEqual(['ranger'])
  })

  it('survives a payload that does not parse', () => {
    const events = [event(1, { type: 'raider_start', name: 'bard', payload_json: '{not json' })]
    expect(mergePlayers([], events, [])[0]).toMatchObject({ player: 'bard', model: null })
    expect(parsePayload('[1,2]')).toBeNull()
  })
})

describe('usageFromEvents', () => {
  it('counts first-time reads and output, never cache reads', () => {
    const usage = {
      input_tokens: 438,
      output_tokens: 27012,
      cache_read_tokens: 1285365,
      cache_write_tokens: 133971,
      total_tokens: 1446786,
    }
    const events = [
      event(1, { type: 'raider_end', payload_json: JSON.stringify({ usage }) }),
      event(2, { type: 'raider_end', payload_json: JSON.stringify({ cost: 0.1 }) }),
      event(3, { type: 'log', payload_json: JSON.stringify({ usage }) }),
    ]
    expect(usageFromEvents(events)).toEqual({ read: 438 + 133971, written: 27012 })
  })
})
