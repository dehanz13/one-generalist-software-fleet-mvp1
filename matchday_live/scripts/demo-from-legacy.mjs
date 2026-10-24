// Build an interim demo recording from the scrubbed legacy sample database.
//
//   node scripts/demo-from-legacy.mjs <ogsf-sample.db> <out.json>
//
// The sample (archives/sample-runs/ogsf-sample.db) holds six real runs of the
// Python factory with every request, prompt, path and log line removed. This
// renames everything to the Go fleet's vocabulary (wiki/VOCABULARY.md) and
// writes the DemoDataset shape (shared/types.ts) that `ogsf demo --export`
// writes. Removed text stays visibly removed; descriptions, colours and
// prompts the scrub took out are put back from the legacy code, where the
// legacy code fixes them.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const [, , dbPath, outPath] = process.argv
if (!dbPath || !outPath) {
  console.error('usage: node scripts/demo-from-legacy.mjs <ogsf-sample.db> <out.json>')
  process.exit(2)
}
const here = dirname(fileURLToPath(import.meta.url))
const legacyPrompts = join(here, '..', '..', '..', 'legacy', 'adws', 'adw_data', 'prompt_engineering')

// ── vocabulary ──────────────────────────────────────────────────────────────

const SETPIECES = {
  adw_prompt: 'ask', adw_scout: 'scout-opposition', adw_plan: 'team-talk', adw_plan_build: 'talk-attack',
  adw_plan_build_test: 'run-normal', adw_simple_sdlc: 'run-heroic', adw_plan_build_test_quality: 'run-mythic',
  adw_build: 'attack', adw_build_test: 'attack-var', adw_build_review: 'attack-review', adw_document: 'bard',
  adw_quality: 'qa',
}
const STATUS = { success: 'touchdown', fail: 'turnover', running: 'running', queued: 'queued' }
const KINDS = { engineer: 'head_coach', agent: 'player', code: 'referee' }
const PLAYERS = { planner: 'playmaker', builder: 'builder', scout: 'ranger', reviewer: 'safety_officer', documenter: 'bard' }
const OWNERS = { ...PLAYERS, engineer: 'founder', quality: 'qa', contract: 'contract', git: 'git' }
const COLORS = { playmaker: '#a78bfa', builder: '#22d3ee', ranger: '#fbbf24', safety_officer: '#fb7185', bard: '#e879f9' }
const REVIEWS = {
  artifacts_exist: 'ball_in_play', files_non_empty: 'ball_not_flat',
  diff_matches_claims: 'replay_matches_report', verdict_consistent: 'decision_stands',
}
const REPORTS = {
  PlanOutput: 'TalkReport', BuildOutput: 'AttackReport', ScoutOutput: 'AnalystReport', ReviewOutput: 'VarReport',
  GenericOutput: 'GenericReport', DocumentOutput: 'BardReport', ChangesOutput: 'ChangesReport', VerifyOutput: 'QaReport',
}
const EVENT_TYPES = {
  phase_start: 'objective_start', phase_end: 'objective_end', agent_start: 'raider_start', agent_end: 'raider_end',
  tool_call: 'ability_cast', handoff: 'trade', gate_pass: 'gear_check_pass', gate_fail: 'gear_check_fail',
  log: 'log', error: 'error',
}
const TOOLS = {
  subagent_create: 'sub_bring_on', subagent_continue: 'sub_instruct', subagent_list: 'sub_bench_list',
  subagent_remove: 'sub_take_off',
}

function objectiveName(name) {
  if (!name) return name
  const fixed = {
    request: 'ask', plan: 'spec', baseline: 'benchmark', build: 'build', commit: 'ship', commit_plan: 'ship_spec',
    commit_build: 'ship_build', commit_docs: 'ship_docs', reverify: 'qa_rerun', prompt: 'answer',
    scout: 'scout_opposition', quality: 'qa',
  }
  if (fixed[name]) return fixed[name]
  const loop = /^(contract|verify|fix)_(\d+)$/.exec(name)
  if (loop) return `${{ contract: 'scope_check', verify: 'qa', fix: 'iterate' }[loop[1]]}_${loop[2]}`
  return name // test_N, retest, review_N, revise_N, changes, document
}

// What each objective says it does, from the legacy set pieces (the scrub
// removed the descriptions; the code fixes them).
const DESCRIPTIONS = {
  ask: 'Capture the incoming ask',
  answer: 'Send the request straight to the player and parse its match report',
  scout_opposition: 'Find and report where things live — change nothing',
  spec: 'Turn the request into an implementable plan',
  ship_spec: 'Put the spec on record before any code exists to blur it',
  build: 'Implement the plan exactly',
  benchmark: 'Measure pre-quest diagnostics (the line of scrimmage for the progressive gate)',
  ship_build: 'Land the code only now: green suite, approved review',
  ship: 'Commit the quest — no new diagnostics, tests and eligible build green',
}
function describe(name) {
  if (DESCRIPTIONS[name]) return DESCRIPTIONS[name]
  if (/^test_\d+$/.test(name)) return 'Run the suite — a known command, so code runs it and no player has to rediscover it'
  if (/^review_\d+$/.test(name)) return 'Confirm the build matches the plan'
  if (/^scope_check_\d+$/.test(name)) return "Pre-commit hook, declared scope, and the spec's own checks — before the slow gate"
  if (/^qa_\d+$/.test(name)) return 'Lint, typecheck, test, and eligible build — progressive gate against the line of scrimmage'
  if (/^iterate_\d+$/.test(name)) return 'Resolve the reported regression'
  return ''
}

// ── text the scrub removed ──────────────────────────────────────────────────

const SCRUBBED = /\[scrubbed(?::(\d+))?\]/g
function unscrub(text, what = 'text') {
  if (typeof text !== 'string') return text
  return text.replace(SCRUBBED, (_, n) => (n ? `(${what} removed from the sample, ${n} characters)` : `(${what} removed)`))
}
function isScrubbed(text) {
  return typeof text === 'string' && /^\[scrubbed(:\d+)?\]$/.test(text)
}

function renamePayload(type, payload) {
  if (!payload || typeof payload !== 'object') return payload
  const out = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'coding_agent') out.club = value
    else if (key === 'harness_engineering') {
      out.enchantments = Array.isArray(value) ? value.map(() => 'set_pieces/clubhouse/enchantments/subagents.ts') : value
    } else if (key === 'agent') out.player = PLAYERS[value] ?? value
    else if (key === 'tools' && Array.isArray(value)) out.tools = value.map((t) => TOOLS[t] ?? t)
    else if (key === 'tool' && typeof value === 'string') out.tool = TOOLS[value] ?? value
    else if (key === 'kind' && type === 'objective_start') out.kind = KINDS[value] ?? value
    else if (key === 'owner') out.owner = OWNERS[value] ?? (isScrubbed(value) ? 'founder' : value)
    else if (key === 'status') out.status = STATUS[value] ?? value
    else if (key === 'description') out.description = value
    else if (key === 'color') out.color = isScrubbed(value) ? undefined : value
    // The scrub removed log levels too; their lengths say which: info and warn are 4, error is 5.
    else if (key === 'level' && isScrubbed(value)) out.level = value.includes(':5') ? 'error' : 'info'
    else out[key] = scrubDeep(value)
  }
  return out
}
function scrubDeep(value) {
  if (typeof value === 'string') return unscrub(value)
  if (Array.isArray(value)) return value.map(scrubDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]))
  }
  return value
}
function renameReport(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const out = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'notes_for_next_agent') out.notes_for_next_player = unscrub(value)
    else if (key === 'verdict') out.ruling = value
    else if (key === 'verdict_reason') out.ruling_reason = unscrub(value)
    else if (key === 'status') out.status = STATUS[value] ?? value
    else if (key === 'raw') out.raw = unscrub(value, 'reply')
    else out[key] = scrubDeep(value)
  }
  return out
}

// ── read ────────────────────────────────────────────────────────────────────

const db = new DatabaseSync(dbPath, { readOnly: true })
const all = (sql, ...params) => db.prepare(sql).all(...params)
const sessions = all('select * from sessions order by started_at')

const matches = sessions.map((s) => {
  const id = s.adw_id
  const phases = all('select * from phases where adw_id = ? order by seq', id)
  const objectiveIds = new Map()
  const objectives = phases.map((p) => {
    const name = objectiveName(p.name)
    const objectiveId = `${id}_${String(p.seq).padStart(2, '0')}_${name}`
    objectiveIds.set(p.phase_id, objectiveId)
    return {
      objective_id: objectiveId,
      match_id: id,
      seq: p.seq,
      name,
      kind: KINDS[p.kind] ?? p.kind,
      owner: OWNERS[p.owner] ?? (isScrubbed(p.owner) ? 'founder' : p.owner),
      description: describe(name) || unscrub(p.description),
      status: STATUS[p.status] ?? p.status,
      attempt: p.attempt,
      retries: p.retries,
      error: p.error ? unscrub(p.error, 'error') : null,
      started_at: p.started_at,
      ended_at: p.ended_at,
    }
  })
  const objectiveOf = (phaseId) => (phaseId ? objectiveIds.get(phaseId) ?? null : null)

  const events = all('select rowid as cursor, * from events where adw_id = ? order by rowid', id).map((e) => {
    const type = EVENT_TYPES[e.type] ?? e.type
    let payload = null
    try {
      payload = e.payload_json ? JSON.parse(e.payload_json) : null
    } catch {
      payload = null
    }
    payload = renamePayload(type, payload)
    let name = e.name
    if (type === 'objective_start' || type === 'objective_end') name = objectiveName(name)
    else if (type === 'raider_start' || type === 'raider_end' || type === 'trade') name = PLAYERS[name] ?? name
    else if (type === 'gear_check_pass' || type === 'gear_check_fail') name = REVIEWS[name] ?? name
    else if (type === 'ability_cast') {
      if (typeof name === 'string' && name.startsWith('quality:')) name = `qa:${name.slice('quality:'.length)}`
      else if (isScrubbed(name) || !name) name = payload?.tool ? `${payload.tool}: (arguments removed)` : 'tool call'
      else name = TOOLS[name] ?? name
    } else if (type === 'log') name = isScrubbed(name) ? 'console' : objectiveName(name)
    else if (type === 'error') name = isScrubbed(name) ? 'error' : objectiveName(name)
    if (type === 'raider_start' && payload && !payload.color) payload.color = COLORS[name]
    if (type === 'objective_start' && payload) payload.description = describe(objectiveName(e.name)) || unscrub(payload.description)
    if (type === 'log' && payload && 'input' in payload) payload.input = unscrub(payload.input, 'request')
    return {
      cursor: Number(e.cursor),
      event_id: e.event_id,
      match_id: id,
      objective_id: objectiveOf(e.phase_id),
      parent_id: e.parent_id || null,
      type,
      name,
      payload_json: payload === null ? null : JSON.stringify(payload),
      tokens: e.tokens,
      started_at: e.started_at,
      ended_at: e.ended_at,
    }
  })

  const reports = all('select * from envelopes where adw_id = ? order by created_at, rowid', id).map((r) => {
    let payload = null
    try {
      payload = JSON.parse(r.payload_json)
    } catch {
      payload = null
    }
    return {
      report_id: r.envelope_id.replace(/^env_/, 'rep_'),
      match_id: id,
      objective_id: objectiveOf(r.phase_id),
      player: PLAYERS[r.agent] ?? r.agent,
      report_type: REPORTS[r.output_type] ?? r.output_type,
      payload_json: payload === null ? null : JSON.stringify(renameReport(payload)),
      valid: r.valid,
      attempt: r.attempt,
      created_at: r.created_at,
    }
  })

  const reviews = all('select * from gate_results where adw_id = ? order by id', id).map((g) => ({
    review_id: `rev_${id}_${String(g.id).padStart(4, '0')}`,
    match_id: id,
    objective_id: objectiveOf(g.phase_id),
    attempt: g.attempt,
    review: REVIEWS[g.gate] ?? g.gate,
    passed: g.passed,
    violations_json: g.violations_json ? JSON.stringify(scrubDeep(JSON.parse(g.violations_json))) : '[]',
    checks_json: g.checks_json ? JSON.stringify(scrubDeep(JSON.parse(g.checks_json))) : null,
    created_at: g.created_at,
  }))

  const processes = all('select * from processes where adw_id = ? order by id', id).map((p) => ({
    process_id: `proc_${id}_${String(p.id).padStart(4, '0')}`,
    match_id: id,
    kind: p.kind === 'adw' ? 'setpiece' : 'player',
    name: p.kind === 'adw' ? '' : PLAYERS[p.name] ?? p.name,
    pid: p.pid,
    command:
      p.kind === 'adw'
        ? `ogsf ${(s.adw_name ?? '').split(' + ').map((n) => SETPIECES[n] ?? n).join(' ')}`
        : `pi ${PLAYERS[p.name] ?? p.name}`,
    started_at: p.started_at,
    ended_at: p.ended_at,
  }))

  const players = all('select * from agent_sessions where adw_id = ? order by created_at, agent', id).map((a) => {
    const player = PLAYERS[a.agent] ?? a.agent
    return {
      match_id: id,
      player,
      club: a.coding_agent,
      model: a.model,
      color: a.color && !isScrubbed(a.color) ? a.color : COLORS[player] ?? null,
      session_id: a.session_id,
      context_tokens: a.context_tokens,
      context_window: a.context_window,
      created_at: a.created_at,
      last_used_at: a.last_used_at,
    }
  })

  const teamTalks = [...new Set(objectives.filter((o) => o.kind === 'player').map((o) => o.owner))].map((player) =>
    teamTalk(player, s.adw_name),
  )

  const setpiece = (s.adw_name ?? '').split(' + ').map((n) => SETPIECES[n] ?? n).join(' + ')
  return {
    match: {
      match_id: id,
      setpiece_name: setpiece,
      ask: `Sample ${setpiece} match. The request was removed from the sample (${(s.request ?? '').replace(SCRUBBED, '$1')} characters).`,
      status: STATUS[s.status] ?? s.status,
      founder: 'founder',
      project: 'sample-runs',
      machine: 'sample-mac',
      started_at: s.started_at,
      ended_at: s.ended_at,
      total_tokens: s.total_tokens,
      total_cost: s.total_cost,
      archived: 0,
      updated_at: s.ended_at ?? s.started_at,
    },
    objectives,
    players,
    events,
    reports,
    reviews,
    processes,
    team_talks: teamTalks,
  }
})

// ── prompts: the legacy templates, renamed, with the removed parts marked ───

function legacyRole(player) {
  return { playmaker: 'planner', builder: 'builder', ranger: 'scout', safety_officer: 'reviewer', bard: 'documenter' }[player]
}
function renameProse(text) {
  return text
    .replaceAll('{{project_conventions}}', '(club rules removed from the sample)')
    .replaceAll('{{prompt}}', '(request removed from the sample)')
    .replaceAll('{{previous_envelope}}', '(previous match report removed from the sample)')
    .replaceAll('{{context_handoff_dir}}', 'set_pieces/clubhouse/matches/<match_id>/torch_pass')
    .replaceAll('context_handoff_dir', 'torch_pass_dir')
    .replaceAll('previous_envelope', 'previous_report')
    .replaceAll('notes_for_next_agent', 'notes_for_next_player')
    .replaceAll('verdict_reason', 'ruling_reason')
    .replaceAll('verdict', 'ruling')
    .replaceAll('subagent_create', 'sub_bring_on')
    .replaceAll('_continue', '_instruct')
    .replaceAll('_list', '_bench_list')
    .replaceAll('_remove', '_take_off')
    .replaceAll('PlanOutput', 'TalkReport')
    .replaceAll('BuildOutput', 'AttackReport')
    .replaceAll('ScoutOutput', 'AnalystReport')
    .replaceAll('ReviewOutput', 'VarReport')
    .replaceAll('DocumentOutput', 'BardReport')
    .replaceAll('"success"', '"touchdown"')
    .replaceAll('`success`', '`touchdown`')
    .replaceAll('adw_id', 'match_id')
    .replaceAll('Project conventions', 'Club rules')
    .replaceAll('# Planner Agent', '# Playmaker')
    .replaceAll('# Scout Agent', '# Ranger')
    .replaceAll('# Reviewer Agent', '# Safety officer')
    .replaceAll('# Documenter Agent', '# Bard')
    .replaceAll('# Builder Agent', '# Builder')
    .replaceAll('.../sessions/', '.../matches/')
    .replaceAll('/context_handoff', '/torch_pass')
}
function teamTalk(player, adwName) {
  const role = legacyRole(player)
  const read = (file) => {
    if (!role) return null
    try {
      return renameProse(readFileSync(join(legacyPrompts, role, file), 'utf8'))
    } catch {
      return null
    }
  }
  // The ask lane sends the user prompt straight through.
  const user = adwName === 'adw_prompt' ? '(request removed from the sample)' : read('user.md')
  return { player, system: read('system.md'), user }
}

const dataset = {
  version: 1,
  generated_at: new Date().toISOString().replace('Z', '+00:00'),
  title: 'Six real matches from the legacy factory, scrubbed (interim demo)',
  matches,
}
writeFileSync(outPath, JSON.stringify(dataset))
const counts = matches.map((m) => `${m.match.match_id}: ${m.match.setpiece_name}, ${m.objectives.length} objectives, ${m.events.length} events`)
console.log(`wrote ${outPath}\n  ${counts.join('\n  ')}`)
