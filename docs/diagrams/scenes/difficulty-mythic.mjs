// run-mythic, the strict difficulty: the kickoff checklist reads the quest's
// contract, the ruling can stop the match before anything is built, the line
// of scrimmage is measured first, and the scope check runs before the slow
// gate on every round of extra time.
import { Scene } from './lib.mjs'

export const name = 'difficulty-mythic'
export const title = 'run-mythic, the strict difficulty'

export function build() {
  const s = new Scene()
  const x = 300
  const w = 300

  s.text(x - 260, 0, 'ogsf run-mythic specs/<area>-quests/<quest>.md', { fontSize: 28 })

  s.diamond('kickoff', x, 60, w, 140, 'kickoff\nchecklist\npasses?', 'grey')
  s.ellipse('refused', x + 380, 95, 210, 70, 'refused\nexit 2', 'grey')
  s.text(x + 380, 180,
    'clean tree · a feature branch\nspec matches the branch · spec committed\nnot merged already · difficulty: run-mythic\nprecondition: work remains',
    { fontSize: 16, color: '#495057' })

  s.box('ask', x, 250, w, 56, 'ask: your quest spec', 'orange')
  s.box('spec', x, 346, w, 56, 'spec · playmaker', 'violet')
  s.diamond('ruling', x, 442, w, 120, 'ruling:\nimplement?', 'violet')
  s.ellipse('stopped', x + 420, 467, 210, 70, 'ruling stop\nexit 1', 'grey')
  s.text(x + 420, 550, 'noop: already done\nblocked: cannot be done as asked\nnothing is built, nothing committed', {
    fontSize: 16,
    color: '#495057',
  })

  s.box('benchmark', x, 612, w, 76, 'benchmark · qa\nthe line of scrimmage', 'grey')
  s.text(x - 270, 616, 'every lint and tsc\ndiagnostic that exists\nBEFORE the build', { fontSize: 16, color: '#495057' })
  s.box('build', x, 728, w, 56, 'build · builder', 'teal')
  s.diamond('scope', x, 834, w, 140, 'scope check\npasses?', 'grey')
  s.text(x - 285, 846, 'the contract, cheap first:\nthe pre-commit hook,\nthe spec’s `writes` scope,\nthe spec’s own `checks`', { fontSize: 16, color: '#495057' })
  s.diamond('gate', x, 1034, w, 150, 'progressive\ngate green?', 'grey')
  s.text(x - 285, 1050, 'qa against the line:\nno NEW lint or tsc problem,\ntests and build exit 0;\nwhat was there before\nis not this quest’s', { fontSize: 16, color: '#495057' })
  s.box('iterate', x + 400, 954, 220, 80, 'iterate · builder\nthe failures, verbatim', 'teal', { fontSize: 17 })
  s.box('ship', x, 1244, w, 56, 'ship · one commit', 'grey')
  s.ellipse('done', x + 50, 1350, 200, 70, 'touchdown\nexit 0', 'green')
  s.ellipse('out', x + 405, 1244, 210, 70, 'turnover\nexit 1', 'red')

  s.arrow('kickoff', 'refused', { sides: ['right', 'left'], label: 'no' })
  s.arrow('kickoff', 'ask', { label: 'yes' })
  s.arrow('ask', 'spec')
  s.arrow('spec', 'ruling')
  s.arrow('ruling', 'stopped', { sides: ['right', 'left'] })
  s.note(x + 312, 474, 'noop or blocked')
  s.arrow('ruling', 'benchmark', { label: 'implement' })
  s.arrow('benchmark', 'build')
  s.arrow('build', 'scope')
  s.arrow('scope', 'gate', { label: 'yes' })
  s.arrow('gate', 'ship', { label: 'yes' })
  s.arrow('ship', 'done')
  s.arrow('scope', 'iterate', { sides: ['right', 'top'], via: [[x + 510, 904]], label: 'no' })
  s.arrow('gate', 'iterate', { sides: ['right', 'bottom'], via: [[x + 510, 1109]], label: 'no' })
  s.arrow('iterate', 'scope', {
    sides: ['right', 'top'],
    endAt: [x + 225, 869],
    via: [
      [x + 660, 994],
      [x + 660, 804],
      [x + 225, 804],
    ],
  })
  s.note(x + 672, 880, 'extra time:\nback to the\nscope check,\n3 rounds')
  s.arrow('iterate', 'out', {
    sides: ['bottom', 'top'],
    startAt: [x + 560, 1034],
    endAt: [x + 560, 1244],
  })
  s.note(x + 570, 1170, 'red 3 times')

  return s.items
}
