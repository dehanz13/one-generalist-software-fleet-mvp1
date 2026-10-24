/**
 * The numbers the docs' charts draw, and where each comes from. Charts that
 * describe players are computed from the demo recording by the same report
 * code every report uses, so they can never disagree with a report of it.
 */
import { factsFromMatches } from '../../../shared/report-facts'
import { rangeReport, type AgentPerformance } from '../../../shared/report'
import type { DemoDataset } from '../../../shared/types'
import { loadDemoDataset } from '../../data/demo'

/** From wiki/GO-MIGRATION.md, section 5: 32 strict runs of the Python factory. */
export const TIME_SPLIT = {
  source: 'wiki/GO-MIGRATION.md, section 5 (32 strict runs of the Python factory)',
  parts: [
    { key: 'building', label: 'Building', share: 0.55 },
    { key: 'planning', label: 'Planning', share: 0.22 },
    { key: 'verifying', label: 'Verifying', share: 0.13 },
    { key: 'rest', label: 'The rest (not broken down in the source)', share: 0.1 },
  ],
} as const

/**
 * The progressive gate on one starting count. 847 → 721 is the example in
 * the gate's own console line (backroom_staff/qa/qa.go); the other two apply
 * the rule from the same file to the same start.
 */
export const GATE_CASES = {
  source: 'backroom_staff/qa/qa.go: RunQuality and its console line, “lint: 847→721 (-126)”',
  cases: [
    { label: 'Only removes problems', before: 847, after: 721, added: 0 },
    { label: 'Same total, one problem swapped', before: 847, after: 847, added: 1 },
    { label: 'Fewer in total, one new', before: 847, after: 800, added: 1 },
  ],
} as const

/** The gate's rule: green only when no new problem appeared, whatever the totals. */
export function gatePasses(added: number): boolean {
  return added === 0
}

export interface PlayerPoint {
  player: string
  cost: number
  read: number
  written: number
  billed: number
  objectives: number
}

/** Every player in a report, most expensive first. */
export function playerPoints(agents: AgentPerformance[]): PlayerPoint[] {
  return agents
    .map((a) => ({
      player: a.player,
      cost: a.cost,
      read: a.tokens.read,
      written: a.tokens.written,
      billed: a.tokens.billed,
      objectives: a.objectives,
    }))
    .sort((a, b) => b.cost - a.cost || a.player.localeCompare(b.player))
}

/** The whole recording as one report: every match, every day. */
export function demoPlayers(dataset: DemoDataset): PlayerPoint[] {
  const facts = factsFromMatches(dataset.matches, '0000-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z')
  return playerPoints(rangeReport(facts, { timeZone: 'UTC' }).agents)
}

export const DEMO_SOURCE = 'the demo recording, public/demo/matchday-demo.json, through shared/report.ts'

let pending: Promise<PlayerPoint[]> | null = null

/** One fetch of the recording, shared by every chart on the page. */
export function loadDemoPlayers(): Promise<PlayerPoint[]> {
  pending ??= loadDemoDataset()
    .then(demoPlayers)
    .catch((error: unknown) => {
      pending = null
      throw error
    })
  return pending
}
