// One match, as a sequence: `ogsf run-heroic`. Players never talk to each
// other; plain code hands each one the previous match report and checks
// every reply before anything moves on.
import { Scene } from './lib.mjs'

export const name = 'match-sequence'
export const title = 'A match, step by step (run-heroic)'

const X = { founder: 100, code: 330, playmaker: 560, builder: 790, referee: 1020, safety: 1250, bard: 1480 }

export function build() {
  const s = new Scene()
  let y = 140
  const step = (n = 54) => (y += n)

  s.message(X.founder, X.code, y, 'ogsf run-heroic "…"')
  step()
  s.selfCall(X.code, y, 'kickoff checklist: clean tree, feature branch')
  step(64)
  s.message(X.code, X.playmaker, y, 'spec: the request')
  step()
  s.message(X.playmaker, X.code, y, 'TalkReport (JSON)', { reply: true })
  step()
  s.selfCall(X.code, y, 'official review: red (a file it named is missing)', { color: 'red' })
  step(64)
  s.message(X.code, X.playmaker, y, 'correction, same session', { color: 'red' })
  step()
  s.message(X.playmaker, X.code, y, 'TalkReport, corrected', { reply: true })
  step()
  s.message(X.code, X.referee, y, 'ship_spec: commit the plan')
  step(64)
  s.message(X.code, X.builder, y, 'build: the plan, the last report')
  step()
  s.message(X.builder, X.code, y, 'AttackReport: changed files', { reply: true })
  step()
  s.selfCall(X.code, y, 'restricted area: outside `writes`? rolled back')
  step(64)
  s.message(X.code, X.referee, y, 'test: the qa checks')
  step()
  s.message(X.referee, X.code, y, 'red: the failures, word for word', { reply: true, color: 'red' })
  step()
  s.message(X.code, X.builder, y, 'iterate_1 (extra time, up to 3)', { color: 'red' })
  step()
  s.message(X.builder, X.code, y, 'AttackReport', { reply: true })
  step()
  s.message(X.code, X.referee, y, 'test again: green', { color: 'green' })
  step(64)
  s.message(X.code, X.safety, y, 'review: the request and the change')
  step()
  s.message(X.safety, X.code, y, 'VarReport: approved', { reply: true })
  step()
  s.message(X.code, X.referee, y, 'retest, ship_build, changes (the diff)')
  step(64)
  s.message(X.code, X.bard, y, 'document: the diff')
  step()
  s.message(X.bard, X.code, y, 'BardReport', { reply: true })
  step()
  s.message(X.code, X.referee, y, 'ship_docs')
  step(64)
  s.message(X.code, X.founder, y, 'touchdown: exit 0, three commits', { reply: true, color: 'green' })

  // the participants, drawn under the messages
  const bottom = y + 40
  const mark = s.items.length
  s.lifeline('founder', X.founder, 0, bottom, 'You,\nthe founder', 'orange')
  s.lifeline('code', X.code, 0, bottom, 'the set piece\n(plain code)', 'blue')
  s.lifeline('playmaker', X.playmaker, 0, bottom, 'playmaker', 'violet')
  s.lifeline('builder', X.builder, 0, bottom, 'builder', 'teal')
  s.lifeline('referee', X.referee, 0, bottom, 'referee (code)\nqa · contract · git', 'grey')
  s.lifeline('safety', X.safety, 0, bottom, 'safety officer', 'red')
  s.lifeline('bard', X.bard, 0, bottom, 'bard', 'pink')
  s.sendToBack(mark)

  // what the lines mean
  s.text(X.founder - 95, bottom + 30,
    'Solid: an objective handed over.   Dashed: a match report handed back.   Red: a correction, in the same session.\n' +
      'Every step above is a row in match_log.db the moment it happens, so ogsf var and Matchday Live show it live.',
    { fontSize: 18, color: '#495057' })

  return s.items
}
