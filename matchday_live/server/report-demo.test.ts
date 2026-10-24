import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { factsFromMatches } from '../shared/report-facts.js'
import { rangeReport } from '../shared/report.js'
import type { DemoDataset } from '../shared/types.js'

describe('the demo recording', () => {
  const dataset = JSON.parse(readFileSync(new URL('../public/demo/matchday-demo.json', import.meta.url), 'utf8')) as DemoDataset

  it('reports consistently: every player objective is somebody’s', () => {
    const all = factsFromMatches(dataset.matches, '0000', '9999')
    const report = rangeReport(all, { timeZone: 'UTC' })
    const playerObjectives = all.objectives.filter((o) => o.kind === 'player').length
    expect(report.agents.reduce((n, a) => n + a.objectives, 0)).toBe(playerObjectives)
    expect(report.totals.matches).toBe(dataset.matches.length)
    expect(report.days.reduce((n, d) => n + d.totals.matches, 0)).toBe(dataset.matches.length)
  })
})
