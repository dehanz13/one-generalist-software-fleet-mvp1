// The fleet's components: what runs on your Mac, what is optional in your
// cloud, and what talks to what.
import { Scene } from './lib.mjs'

export const name = 'components'
export const title = 'The fleet’s components'

export function build() {
  const s = new Scene()

  // ── your Mac ──
  s.zone('mac', 0, 0, 1000, 860, 'Your Mac · your repository')

  s.ellipse('founder', 40, 60, 210, 90, 'You,\nthe founder', 'orange')
  s.box('ogsf', 340, 60, 230, 90, 'ogsf\none binary', 'blue', { fontSize: 22 })
  s.box('players', 680, 50, 280, 110, 'players\nplaymaker · builder · ranger\nsafety officer · bard', 'violet')

  s.box('config', 40, 220, 210, 90, 'club.config.yaml\nplayers · qa · rules', 'grey')
  s.box('setpiece', 340, 220, 230, 90, 'a set piece\n(13 to choose from)', 'green')
  s.box('club', 680, 220, 280, 90, 'the club: pi\n(scripted, for the demo)', 'teal')

  s.box('upcoming', 40, 380, 210, 90, 'Upcoming Matches\nupcoming/*.md', 'yellow')
  s.box('runner', 340, 380, 230, 90, 'the match runner\nobjectives, in order', 'blue')
  s.box('referee', 680, 370, 280, 120, 'the referee: plain code\nofficial reviews · qa\nrestricted area · contract', 'grey')

  s.box('scheduler', 40, 540, 210, 90, 'ogsf scheduler\nstarts what is due', 'yellow')
  s.box('log', 340, 540, 230, 90, 'match_log.db\nthe whole record', 'green')
  s.box('var', 680, 540, 280, 90, 'ogsf var\nhttp://127.0.0.1:4600', 'teal')

  s.box('relay', 340, 720, 230, 90, 'the relay\nPOST /api/ingest', 'blue')

  s.arrow('founder', 'ogsf', { label: 'runs' })
  s.arrow('ogsf', 'setpiece')
  s.arrow('config', 'setpiece', { sides: ['right', 'left'], fromOffset: -20, toOffset: -20, label: 'read by' })
  s.arrow('setpiece', 'runner')
  s.arrow('runner', 'club', { label: 'objective' })
  s.arrow('club', 'players', { label: 'team talk' })
  s.arrow('runner', 'referee', { sides: ['right', 'left'], label: 'every report' })
  s.arrow('runner', 'log', { label: 'rows' })
  s.arrow('upcoming', 'scheduler', { label: 'tickets' })
  s.arrow('scheduler', 'setpiece', {
    sides: ['right', 'left'],
    toOffset: 22,
    via: [
      [298, 585],
      [298, 287],
    ],
  })
  s.arrow('log', 'var', { label: 'reads' })
  s.arrow('log', 'relay', { label: 'outbox' })

  // ── model providers ──
  s.zone('providers-zone', 1060, 0, 420, 160, 'Model providers', 'violet')
  s.box('providers', 1090, 55, 360, 80, 'Anthropic · OpenAI · …\nyour own keys, in .env', 'white')
  s.arrow('club', 'providers', { sides: ['right', 'left'], label: 'prompts' })

  // ── who watches ──
  s.box('browser', 1080, 200, 180, 90, 'a browser\nlaptop · phone · TV', 'orange')
  s.box('claude', 1290, 200, 170, 90, 'the Claude app', 'orange')
  s.arrow('var', 'browser', {
    sides: ['right', 'left'],
    via: [
      [1020, 585],
      [1020, 245],
    ],
  })
  s.note(1028, 330, 'local')

  // ── your cloud ──
  s.zone('cloud', 1060, 340, 420, 380, 'Your cloud (optional)', 'blue', { titleAt: 'bottom' })
  s.box('matchday', 1090, 380, 360, 100, 'Matchday Live on Vercel\nthe page · the API\nthe Claude connector', 'blue')
  s.box('supabase', 1090, 545, 360, 70, 'Supabase (Postgres)', 'green')
  s.arrow('matchday', 'supabase', { both: true })
  s.arrow('matchday', 'browser', { sides: ['top', 'bottom'], fromOffset: -90, toOffset: 0, label: 'live' })
  s.arrow('matchday', 'claude', { sides: ['top', 'bottom'], fromOffset: 95, toOffset: 0, both: true, label: 'MCP' })
  s.arrow('relay', 'matchday', {
    sides: ['right', 'left'],
    via: [
      [1040, 765],
      [1040, 430],
    ],
  })
  s.note(640, 735, 'HTTPS, with a fleet token')

  return s.items
}
