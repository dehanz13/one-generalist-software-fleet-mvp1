// How a row reaches the page: written once on the Mac, read there by
// `ogsf var`, and mirrored to the cloud by the relay when one is set up.
import { Scene } from './lib.mjs'

export const name = 'matchday-live-data-flow'
export const title = 'Matchday Live: how a row reaches the page'

const MUTED = { fontSize: 16, color: '#495057' }

export function build() {
  const s = new Scene()

  s.box('page', 330, -170, 320, 90, 'Matchday Live, in a browser\nthe same page either way', 'orange')

  s.zone('mac', 0, 0, 540, 720, 'Your Mac')
  s.box('runner', 40, 70, 210, 80, 'the match runner\nwrites every row', 'blue')
  s.box('log', 40, 220, 210, 90, 'match_log.db\nSQLite, on this Mac', 'green')
  s.box('outbox', 40, 380, 210, 90, 'relay_outbox\na copy of each row', 'green')
  s.box('relay', 40, 540, 210, 110, 'the relay\nevery second, and\nonce more at the end', 'blue', { fontSize: 17 })
  s.box('var', 320, 220, 190, 90, 'ogsf var\n127.0.0.1:4600', 'teal')
  s.text(290, 395, 'offline? rows wait in\nthe outbox until the next\nsend, or ogsf relay push', MUTED)

  s.zone('cloud', 620, 0, 400, 720, 'Your Vercel + Supabase')
  s.box('live', 660, 220, 320, 90, 'GET /api/live\nevents as they land', 'blue')
  s.box('supabase', 660, 380, 320, 90, 'Supabase (Postgres)\nupsert by primary key', 'green')
  s.box('ingest', 660, 550, 320, 90, 'POST /api/ingest\na fleet token, 500 rows a call', 'blue', { fontSize: 17 })
  s.text(660, 90, 'every /api route but ingest\nand health needs the\nsign-in cookie', MUTED)

  s.arrow('runner', 'log', { label: 'each row' })
  s.arrow('log', 'outbox', { label: 'same write' })
  s.arrow('outbox', 'relay')
  s.arrow('relay', 'ingest', { sides: ['right', 'left'], label: 'HTTPS' })
  s.arrow('ingest', 'supabase')
  s.arrow('supabase', 'live', { label: 'read by cursor' })
  s.arrow('log', 'var', { label: 'read by' })
  s.arrow('var', 'page', { sides: ['top', 'bottom'], toOffset: -75, label: 'live stream' })
  s.arrow('live', 'page', {
    sides: ['right', 'right'],
    via: [
      [1060, 265],
      [1060, -125],
    ],
  })
  s.note(1070, 60, 'live\nstream')

  return s.items
}
