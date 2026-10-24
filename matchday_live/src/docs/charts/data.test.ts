import { describe, expect, it } from 'vitest'
import { factsFromMatches } from '../../../shared/report-facts'
import { rangeReport } from '../../../shared/report'
import type { DemoDataset } from '../../../shared/types'
import recording from '../../../public/demo/matchday-demo.json?raw'
import { GATE_CASES, TIME_SPLIT, demoPlayers, gatePasses } from './data'

const dataset = JSON.parse(recording) as DemoDataset

describe('the docs charts', () => {
  it('splits the run time exactly as the migration notes do, and accounts for the rest', () => {
    expect(TIME_SPLIT.parts.map((p) => p.share)).toEqual([0.55, 0.22, 0.13, 0.1])
    expect(TIME_SPLIT.parts.reduce((n, p) => n + p.share, 0)).toBeCloseTo(1)
  })

  it('judges the gate on new problems, never on totals', () => {
    expect(GATE_CASES.cases.map((c) => gatePasses(c.added))).toEqual([true, false, false])
  })

  it('draws every player of the demo, most expensive first, adding up to the report', () => {
    const players = demoPlayers(dataset)
    expect(players.length).toBeGreaterThan(0)
    const costs = players.map((p) => p.cost)
    expect([...costs].sort((a, b) => b - a)).toEqual(costs)
    const report = rangeReport(factsFromMatches(dataset.matches, '0000', '9999'), { timeZone: 'UTC' })
    expect(players.map((p) => p.player).sort()).toEqual(report.agents.map((a) => a.player).sort())
    const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0)
    expect(sum(players.map((p) => p.billed))).toBe(sum(report.agents.map((a) => a.tokens.billed)))
    for (const p of players) expect(p.billed).toBeGreaterThanOrEqual(0)
  })
})
