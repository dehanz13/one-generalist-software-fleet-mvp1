// One player call, as the match runner checks it: the reply must parse, the
// official reviews must pass, and the player must have changed only what it
// may. The first two are corrected in the player's own session; the third
// cannot be, because the write already happened.
import { Scene } from './lib.mjs'

export const name = 'correction-loops'
export const title = 'The three checks on every player call'

const MUTED = { fontSize: 16, color: '#495057' }

export function build() {
  const s = new Scene()
  const x = 380
  const w = 300

  s.box('send', x, 0, w, 70, 'the club sends the prompt,\nin the player’s own session', 'grey', { fontSize: 17 })
  s.box('reply', x, 120, w, 60, 'the player replies', 'teal')
  s.diamond('json', x, 230, w, 130, 'valid JSON for\nits report type?', 'grey', { fontSize: 17 })
  s.box('fix', 780, 250, 330, 90, 'JSON fix: the parse error,\nsame session, at most 2', 'orange', { fontSize: 17 })
  s.diamond('reviews', x, 420, w, 140, 'official\nreviews\nall green?', 'grey', { fontSize: 17 })
  s.box('correction', 780, 445, 330, 90, 'correction: every violation,\nsame session, while retries last', 'orange', { fontSize: 17 })
  s.box('area', x, 620, w, 70, 'the restricted area: the tree\ncompared with its snapshot', 'grey', { fontSize: 17 })
  s.diamond('allowed', x, 740, w, 130, 'changed only\nwhat it may?', 'red', { fontSize: 17 })
  s.box('rollback', 780, 765, 330, 80, 'roll those paths back;\nno correction can undo a write', 'red', { fontSize: 17 })
  s.ellipse('done', x + 25, 930, 250, 76, 'report saved,\nhanded to the next player', 'green', { fontSize: 17 })
  s.ellipse('out', 820, 930, 250, 76, 'the objective:\nturnover', 'red')

  s.arrow('send', 'reply')
  s.arrow('reply', 'json')
  s.arrow('json', 'reviews', { label: 'yes' })
  s.arrow('json', 'fix', { sides: ['right', 'left'], label: 'no' })
  s.arrow('fix', 'reply', {
    sides: ['top', 'right'],
    toOffset: 15,
    via: [[945, 165]],
  })
  s.arrow('reviews', 'area', { label: 'yes' })
  s.arrow('reviews', 'correction', { sides: ['right', 'left'], label: 'no' })
  s.arrow('correction', 'reply', {
    sides: ['right', 'right'],
    toOffset: -15,
    via: [
      [1150, 490],
      [1150, 135],
    ],
  })
  s.arrow('area', 'allowed')
  s.arrow('allowed', 'done', { label: 'yes' })
  s.arrow('allowed', 'rollback', { sides: ['right', 'left'], label: 'no' })
  s.arrow('rollback', 'out')
  s.text(790, 350, 'none left: turnover', MUTED)
  s.text(790, 545, 'none left: turnover', MUTED)

  // what each check is
  s.text(0, 250, 'a typed match report:\nTalkReport, AttackReport,\nVarReport, BardReport, …', MUTED)
  s.text(
    0,
    410,
    'ball_in_play: every artifact exists\nball_not_flat: no artifact is empty\njson_parses: every .json parses\nreplay_matches_report: the files\n  it says it changed, changed\ndecision_stands: an approval\n  agrees with its own findings',
    MUTED,
  )
  s.text(0, 640, 'writes: what this player may\nchange; restricted_area: what\nno player may, unless it names it', MUTED)

  return s.items
}
