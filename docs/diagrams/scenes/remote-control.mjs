// Two ways to drive the fleet from the Claude app when you are away from
// your Mac: steer a whole Claude Code session (Remote Control), or ask
// Matchday Live's connector, whose requests a Mac's Scheduler may take.
import { Scene } from './lib.mjs'

export const name = 'remote-control'
export const title = 'Two ways to drive the fleet from the Claude app'

const MUTED = { fontSize: 16, color: '#495057' }

export function build() {
  const s = new Scene()

  s.box('you', 370, 0, 400, 80, 'You, away from your Mac\nthe Claude app · claude.ai', 'orange')

  // 1 · Remote Control
  s.text(40, 130, '1 · Claude Code Remote Control', { fontSize: 24, color: '#1971c2' })
  s.box('anthropic', 40, 190, 420, 80, 'the Anthropic API\nyour Mac only ever calls out', 'grey')
  s.box('rc', 40, 330, 420, 90, 'claude remote-control\nin your repository, on your Mac', 'violet')
  s.box('ogsf', 40, 480, 420, 80, 'it runs ogsf for you:\nany set piece, any command', 'blue')

  // 2 · the connector
  s.text(745, 130, '2 · The Matchday Live connector', { fontSize: 24, color: '#1971c2' })
  s.box('mcp', 680, 190, 420, 90, 'https://<your app>/api/mcp\nsigned in with your page password', 'blue', { fontSize: 17 })
  s.box('requests', 680, 330, 420, 90, 'queue_request · queue_ticket\na row in requests', 'orange')
  s.box('scheduler', 680, 480, 420, 80, 'ogsf scheduler on a Mac\nwith accept_remote: true claims it', 'yellow', { fontSize: 17 })

  s.box('match', 330, 640, 480, 80, 'a match: recorded, relayed,\nshown on Matchday Live', 'green')

  s.arrow('you', 'anthropic', { sides: ['bottom', 'top'], fromOffset: -150, toOffset: 170, both: true })
  s.arrow('anthropic', 'rc', { both: true, label: 'one session' })
  s.arrow('rc', 'ogsf')
  s.arrow('ogsf', 'match', { sides: ['bottom', 'left'], via: [[250, 680]] })
  s.arrow('you', 'mcp', { sides: ['bottom', 'top'], fromOffset: 150, toOffset: -170, both: true })
  s.arrow('mcp', 'requests', { label: 'tools' })
  s.arrow('requests', 'scheduler')
  s.note(905, 438, 'claimed over the fleet API')
  s.arrow('scheduler', 'match', { sides: ['bottom', 'right'], via: [[890, 680]] })
  s.arrow('match', 'mcp', {
    sides: ['right', 'right'],
    dashed: true,
    via: [
      [1150, 680],
      [1150, 235],
    ],
  })
  s.note(1160, 380, 'reports\nand status\ncome back\nthe same way')

  s.text(40, 760, 'A whole Claude Code session: anything you could type.\nNeeds a Pro, Max, Team or Enterprise plan, and\nclaude kept running on the Mac.', MUTED)
  s.text(680, 760, 'Only what the connector offers: reports, matches,\nUpcoming, and requests. The Mac decides what it\nruns; the kickoff checklist still applies.', MUTED)

  return s.items
}
