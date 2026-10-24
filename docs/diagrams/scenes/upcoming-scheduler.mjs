// Upcoming Matches and the Scheduler: planned tickets and "run this now"
// requests both end as an ordinary match, one at a time, on a Mac that
// agreed to run them.
import { Scene } from './lib.mjs'

export const name = 'upcoming-scheduler'
export const title = 'Upcoming Matches and the Scheduler'

const MUTED = { fontSize: 16, color: '#495057' }

export function build() {
  const s = new Scene()

  // planned work
  s.box('md', 0, 0, 320, 110, 'set_pieces/upcoming/*.md\n## KICK-7 · Add a timer\ndate · time · set piece · mode', 'yellow', { fontSize: 17 })
  s.box('linear', 0, 150, 320, 60, 'Linear: coming later', 'grey', { strokeStyle: 'dashed', fill: 'transparent' })
  s.box('table', 0, 260, 320, 90, 'upcoming_matches\none row per ticket, relayed', 'yellow')

  // run this now
  s.box('page', 600, 0, 210, 70, 'Matchday Live:\nRun now', 'orange', { fontSize: 17 })
  s.box('connector', 830, 0, 210, 70, 'the Claude\nconnector', 'orange', { fontSize: 17 })
  s.box('cli', 1060, 0, 210, 70, 'ogsf request "…"', 'orange', { fontSize: 17 })
  s.box('requests', 760, 170, 360, 80, 'requests\nqueued until a Mac claims one', 'orange', { fontSize: 17 })
  s.diamond('accepted', 810, 340, 260, 140, 'this Mac\naccepts it?', 'grey')
  s.ellipse('refused', 1130, 375, 200, 70, 'refused,\nwith the reason', 'grey', { fontSize: 17 })

  // the Scheduler
  s.box('scheduler', 340, 420, 320, 90, 'ogsf scheduler\nevery 30 s, one match at a time', 'blue', { fontSize: 17 })
  s.box('run', 340, 590, 320, 80, 'the set piece runs\nkickoff checklist first', 'green')
  s.ellipse('match', 365, 740, 270, 76, 'a match, with the\nticket on its row', 'green', { fontSize: 17 })
  s.box('person', 0, 590, 260, 80, 'you, any time:\nogsf upcoming run KICK-7', 'yellow', { fontSize: 17 })

  s.arrow('md', 'linear', { plain: false, endArrowhead: null, dotted: true })
  s.arrow('linear', 'table', { dotted: true })
  s.note(372, 160, 'read into')
  s.arrow('md', 'table', {
    sides: ['right', 'right'],
    via: [
      [360, 55],
      [360, 305],
    ],
  })
  s.arrow('page', 'requests', { sides: ['bottom', 'top'], toOffset: -120 })
  s.arrow('connector', 'requests', { sides: ['bottom', 'top'], toOffset: 0 })
  s.arrow('cli', 'requests', { sides: ['bottom', 'top'], toOffset: 120 })
  s.arrow('requests', 'accepted')
  s.arrow('accepted', 'refused', { sides: ['right', 'left'], label: 'no' })
  s.arrow('accepted', 'scheduler', { sides: ['left', 'right'] })
  s.note(728, 452, 'yes: claimed')
  s.arrow('table', 'scheduler', { sides: ['bottom', 'left'], via: [[160, 465]] })
  s.note(170, 380, 'due, mode: auto')
  s.arrow('scheduler', 'run')
  s.arrow('person', 'run', { sides: ['right', 'left'], label: 'manual' })
  s.arrow('run', 'match')
  s.arrow('match', 'table', {
    sides: ['left', 'left'],
    via: [
      [-40, 778],
      [-40, 305],
    ],
  })
  s.note(-30, 715, 'touchdown\nor turnover')

  s.text(
    720,
    600,
    'It accepts a request only with scheduler.accept_remote: true.\nA request for a ticket you wrote may start any set piece;\none by set piece name, only those in allowed_set_pieces.\nEvery match still passes its kickoff checklist.',
    MUTED,
  )

  return s.items
}
