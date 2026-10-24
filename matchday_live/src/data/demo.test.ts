import { describe, expect, it, vi } from 'vitest'
import type { EventRow, MatchDetail } from '../../shared/types'
import { tinyDataset } from './__fixtures__/tiny'
import { DemoSource, INSTANT } from './demo'

function source() {
  let real = 1_000_000
  const demo = new DemoSource(tinyDataset(), { speed: 1, realNow: () => real })
  return { demo, tick: (ms: number) => ((real += ms), demo.clock.advance(ms)) }
}

describe('DemoSource', () => {
  it('answers like an API at the replay clock', async () => {
    const { demo, tick } = source()
    expect(await demo.matches('0')).toEqual([])
    demo.clock.play()
    tick(1_200)
    const list = await demo.matches('0')
    expect(list.map((m) => m.match_id)).toEqual(['m1'])
    expect(list[0]?.status).toBe('running')
    expect((await demo.match('m2'))).toBeNull()
    demo.close()
  })

  it('streams new events, sends a fresh detail when an objective changes, and resets on restart', () => {
    const { demo, tick } = source()
    const got: EventRow[] = []
    const details: MatchDetail[] = []
    const reset = vi.fn()
    demo.watchMatch('m1', 0, { onEvents: (e) => got.push(...e), onMatch: (d) => details.push(d), onReset: reset })
    demo.clock.play()
    tick(2_000)
    expect(got.map((e) => e.cursor)).toEqual([1, 2])
    tick(60_000)
    expect(got.map((e) => e.cursor)).toEqual([1, 2, 3, 4, 5])
    expect(details.at(-1)?.match.status).toBe('touchdown')
    demo.clock.restart()
    expect(reset).toHaveBeenCalledTimes(1)
    demo.close()
  })

  it('jumps to the end, and archives in memory', async () => {
    const { demo } = source()
    demo.clock.setSpeed(INSTANT)
    expect(demo.clock.current.finished).toBe(true)
    expect((await demo.matches('0')).map((m) => m.match_id)).toEqual(['m2', 'm1'])
    await demo.archive('m1', true)
    expect((await demo.matches('0')).map((m) => m.match_id)).toEqual(['m2'])
    expect((await demo.matches('1')).map((m) => m.match_id)).toEqual(['m1'])
    const talks = await demo.teamTalks('m1', 'playmaker')
    expect(talks.system).toBe('# Playmaker')
    const page = await demo.events('m1', 2, 2)
    expect(page.events.map((e) => e.cursor)).toEqual([3, 4])
    expect(page.has_more).toBe(true)
    demo.close()
  })
})
