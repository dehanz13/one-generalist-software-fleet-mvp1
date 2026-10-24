import { describe, expect, it } from 'vitest'
import { parseDoc, slugify, splitRow, type Block } from './parse'

const only = (source: string): Block[] => parseDoc(source).blocks

describe('parseDoc', () => {
  it('reads headings with GitHub anchors, and the title', () => {
    const doc = parseDoc('# What OGSF is\n\n## 1 · Claude Code Remote Control\n\n## Notes\n\n## Notes\n')
    expect(doc.title).toBe('What OGSF is')
    expect(doc.headings.map((h) => h.id)).toEqual(['what-ogsf-is', '1--claude-code-remote-control', 'notes', 'notes-1'])
  })

  it('anchors a heading by its words, without code ticks or links', () => {
    expect(slugify('qa and the `progressive` gate')).toBe('qa-and-the-progressive-gate')
    expect(slugify('[Linear](linear.md) (coming later)')).toBe('linear-coming-later')
  })

  it('keeps a fence of four backticks open across a fence of three', () => {
    const blocks = only('````md\n```ogsf\ndifficulty: run-mythic\n```\n````\n\nafter')
    expect(blocks[0]).toEqual({ type: 'code', lang: 'md', text: '```ogsf\ndifficulty: run-mythic\n```' })
    expect(blocks[1]).toEqual({ type: 'paragraph', text: 'after' })
  })

  it('reads a table, with escaped pipes and alignment', () => {
    const [table] = only('| A | B |\n|:---|---:|\n| `x \\| y` | 2 |\n| short |')
    expect(table).toEqual({
      type: 'table',
      head: ['A', 'B'],
      align: ['left', 'right'],
      rows: [
        ['`x | y`', '2'],
        ['short', ''],
      ],
    })
    expect(splitRow('| a | b |')).toEqual(['a', 'b'])
  })

  it('reads list items that hold code blocks and further paragraphs', () => {
    const [list] = only('1. Start it:\n\n   ```sh\n   claude --rc\n   ```\n\n   Or type `/rc`.\n2. Open the app.\n\nAfter the list.')
    expect(list?.type).toBe('list')
    if (list?.type !== 'list') return
    expect(list.ordered).toBe(true)
    expect(list.items).toHaveLength(2)
    expect(list.items[0]!.map((b) => b.type)).toEqual(['paragraph', 'code', 'paragraph'])
    expect(list.items[0]![1]).toEqual({ type: 'code', lang: 'sh', text: 'claude --rc' })
    expect(only('- a\n- b\n\nAfter the list.').map((b) => b.type)).toEqual(['list', 'paragraph'])
  })

  it('continues a list item lazily, and ends a list at a different kind', () => {
    const blocks = only('- one\ncontinued\n1. other')
    expect(blocks.map((b) => b.type)).toEqual(['list', 'list'])
    const first = blocks[0]
    if (first?.type === 'list') expect(first.items[0]).toEqual([{ type: 'paragraph', text: 'one\ncontinued' }])
  })

  it('turns a diagram on its own line into an image, and a chart marker into a chart', () => {
    expect(only('![The components](diagrams/components.svg)')).toEqual([
      { type: 'image', alt: 'The components', src: 'diagrams/components.svg' },
    ])
    expect(only('<!-- chart: time-split -->\n\n<!-- just a note -->')).toEqual([{ type: 'chart', name: 'time-split' }])
  })

  it('reads quotes and rules', () => {
    expect(only('> quoted\n> more\n\n---')).toEqual([
      { type: 'quote', blocks: [{ type: 'paragraph', text: 'quoted\nmore' }] },
      { type: 'rule' },
    ])
  })
})
