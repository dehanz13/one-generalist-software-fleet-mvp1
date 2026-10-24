// run-normal and run-heroic, objective by objective, with their loops.
// Colours are owners: orange you, violet the playmaker, teal the builder,
// grey plain code (qa and git), red the safety officer, pink the bard.
import { Scene } from './lib.mjs'

export const name = 'difficulty-normal-heroic'
export const title = 'run-normal and run-heroic'

export function build() {
  const s = new Scene()

  // ── run-normal ──
  s.text(40, 0, 'ogsf run-normal', { fontSize: 28 })
  s.box('n-ask', 40, 60, 240, 60, 'ask: your request', 'orange')
  s.box('n-spec', 40, 170, 240, 60, 'spec · playmaker', 'violet')
  s.box('n-build', 40, 280, 240, 60, 'build · builder', 'teal')
  s.diamond('n-test', 40, 390, 240, 120, 'test · qa\ngreen?', 'grey')
  s.box('n-ship', 40, 570, 240, 60, 'ship · git commit', 'grey')
  s.ellipse('n-done', 60, 690, 200, 70, 'touchdown\nexit 0', 'green')
  s.box('n-iterate', 330, 415, 200, 70, 'iterate · builder\nup to 3 rounds', 'teal')
  s.ellipse('n-out', 330, 690, 200, 70, 'turnover\nexit 1', 'red')

  s.arrow('n-ask', 'n-spec')
  s.arrow('n-spec', 'n-build')
  s.arrow('n-build', 'n-test')
  s.arrow('n-test', 'n-ship', { label: 'green' })
  s.arrow('n-ship', 'n-done')
  s.arrow('n-test', 'n-iterate', { sides: ['right', 'left'], label: 'red' })
  s.arrow('n-iterate', 'n-test', {
    sides: ['top', 'top'],
    endAt: [220, 420],
    via: [
      [430, 365],
      [220, 365],
    ],
  })
  s.arrow('n-iterate', 'n-out', { label: 'red 3 times' })

  // ── run-heroic ──
  const x = 640
  s.text(x, 0, 'ogsf run-heroic', { fontSize: 28 })
  s.diamond('h-kickoff', x, 50, 260, 120, 'kickoff\nchecklist passes?', 'grey')
  s.ellipse('h-refused', x + 320, 75, 200, 70, 'refused\nexit 2', 'grey')
  s.box('h-ask', x, 220, 260, 56, 'ask: your request', 'orange')
  s.box('h-spec', x, 316, 260, 56, 'spec · playmaker', 'violet')
  s.box('h-shipspec', x, 412, 260, 56, 'ship_spec · commit the plan', 'grey', { fontSize: 17 })
  s.box('h-build', x, 508, 260, 56, 'build · builder', 'teal')
  s.diamond('h-test', x, 604, 260, 120, 'test · qa\ngreen?', 'grey')
  s.box('h-iterate', x + 320, 629, 200, 70, 'iterate · builder\nup to 3 rounds', 'teal')
  s.diamond('h-review', x, 774, 260, 130, 'safety officer\napproves?', 'red')
  s.box('h-revise', x + 320, 804, 200, 70, 'revise · builder\nonce, on its findings', 'teal', { fontSize: 17 })
  s.box('h-shipbuild', x, 954, 260, 56, 'retest, then ship_build', 'grey', { fontSize: 17 })
  s.box('h-changes', x, 1050, 260, 56, 'changes · the whole diff', 'grey', { fontSize: 17 })
  s.box('h-document', x, 1146, 260, 56, 'document · bard', 'pink')
  s.box('h-shipdocs', x, 1242, 260, 56, 'ship_docs · commit the docs', 'grey', { fontSize: 17 })
  s.ellipse('h-done', x + 30, 1348, 200, 70, 'touchdown\nexit 0', 'green')
  s.ellipse('h-out', x + 320, 1000, 200, 70, 'turnover\nexit 1', 'red')

  s.arrow('h-kickoff', 'h-refused', { sides: ['right', 'left'], label: 'no' })
  s.arrow('h-kickoff', 'h-ask', { label: 'yes' })
  s.arrow('h-ask', 'h-spec')
  s.arrow('h-spec', 'h-shipspec')
  s.arrow('h-shipspec', 'h-build')
  s.arrow('h-build', 'h-test')
  s.arrow('h-test', 'h-review', { label: 'green' })
  s.arrow('h-test', 'h-iterate', { sides: ['right', 'left'], label: 'red' })
  s.arrow('h-iterate', 'h-test', {
    sides: ['top', 'top'],
    endAt: [x + 195, 634],
    via: [
      [x + 420, 584],
      [x + 195, 584],
    ],
  })
  s.arrow('h-review', 'h-shipbuild', { label: 'yes' })
  s.arrow('h-review', 'h-revise', { sides: ['right', 'left'], label: 'no' })
  s.arrow('h-revise', 'h-review', {
    sides: ['top', 'top'],
    endAt: [x + 195, 806],
    via: [
      [x + 420, 754],
      [x + 195, 754],
    ],
  })
  s.arrow('h-revise', 'h-out', { label: 'still no' })
  s.arrow('h-iterate', 'h-out', {
    sides: ['right', 'right'],
    via: [
      [x + 560, 664],
      [x + 560, 1035],
    ],
  })
  s.note(x + 572, 760, 'red 3 times')
  s.arrow('h-shipbuild', 'h-changes')
  s.arrow('h-changes', 'h-document')
  s.arrow('h-document', 'h-shipdocs')
  s.arrow('h-shipdocs', 'h-done')
  s.text(x + 320, 1085, 'nothing ships;\nthe spec commit stands', { fontSize: 16, color: '#495057' })

  return s.items
}
