package matchfeed

// Schema is the match log, legacy's seven tables under the picked names plus
// the prompts and the relay outbox. Created with IF NOT EXISTS, so opening an
// existing file is safe; columns added after a file shipped go in
// Migrations, which runs at every open. See wiki/DATA-CONTRACT.md.
const Schema = `
CREATE TABLE IF NOT EXISTS matches (
  match_id      TEXT PRIMARY KEY,
  setpiece_name TEXT,
  ask           TEXT,
  status        TEXT,
  founder       TEXT,
  project       TEXT,
  machine       TEXT,
  started_at    TEXT, ended_at TEXT,
  total_tokens  INTEGER DEFAULT 0, total_cost REAL DEFAULT 0,
  archived      INTEGER DEFAULT 0,
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS objectives (
  objective_id  TEXT PRIMARY KEY,
  match_id      TEXT REFERENCES matches,
  seq           INTEGER,
  name TEXT, kind TEXT, owner TEXT, description TEXT,
  status        TEXT DEFAULT 'turnover',
  attempt       INTEGER DEFAULT 0, retries INTEGER DEFAULT 0,
  error         TEXT,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  match_id      TEXT REFERENCES matches,
  objective_id  TEXT,
  parent_id     TEXT,
  type          TEXT,
  name          TEXT,
  payload_json  TEXT,
  tokens        INTEGER,
  started_at    TEXT, ended_at TEXT
);
CREATE INDEX IF NOT EXISTS events_by_match ON events (match_id);
CREATE TABLE IF NOT EXISTS match_reports (
  report_id     TEXT PRIMARY KEY,
  match_id      TEXT REFERENCES matches,
  objective_id  TEXT,
  player        TEXT,
  report_type   TEXT,
  payload_json  TEXT,
  valid         INTEGER,
  attempt       INTEGER,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS official_reviews (
  review_id     TEXT PRIMARY KEY,
  match_id      TEXT REFERENCES matches,
  objective_id  TEXT,
  attempt       INTEGER,
  review        TEXT,
  passed        INTEGER,
  violations_json TEXT,
  checks_json   TEXT,
  created_at    TEXT
);
CREATE TABLE IF NOT EXISTS processes (
  process_id    TEXT PRIMARY KEY,
  match_id      TEXT REFERENCES matches,
  kind          TEXT,
  name          TEXT,
  pid           INTEGER,
  command       TEXT,
  started_at    TEXT, ended_at TEXT
);
CREATE TABLE IF NOT EXISTS club_sessions (
  match_id      TEXT REFERENCES matches,
  player        TEXT,
  club          TEXT, model TEXT, color TEXT,
  session_id    TEXT,
  context_tokens INTEGER,
  context_window INTEGER,
  created_at    TEXT, last_used_at TEXT,
  PRIMARY KEY (match_id, player)
);
CREATE TABLE IF NOT EXISTS team_talks (
  match_id      TEXT REFERENCES matches,
  player        TEXT,
  system        TEXT,
  user          TEXT,
  updated_at    TEXT,
  PRIMARY KEY (match_id, player)
);
CREATE TABLE IF NOT EXISTS upcoming_matches (
  ticket_id     TEXT PRIMARY KEY,
  source        TEXT,
  source_ref    TEXT,
  sprint        TEXT,
  title         TEXT,
  date          TEXT,
  time          TEXT,
  timezone      TEXT,
  due_at        TEXT,
  set_piece     TEXT,
  mode          TEXT,
  prompt        TEXT,
  player        TEXT,
  status        TEXT,
  match_id      TEXT,
  machine       TEXT,
  note          TEXT,
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS requests (
  request_id    TEXT PRIMARY KEY,
  created_at    TEXT,
  requested_by  TEXT,
  kind          TEXT,
  set_piece     TEXT,
  prompt        TEXT,
  player        TEXT,
  ticket_id     TEXT,
  machine       TEXT,
  status        TEXT,
  claimed_by    TEXT,
  match_id      TEXT,
  note          TEXT,
  updated_at    TEXT
);
CREATE TABLE IF NOT EXISTS relay_outbox (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl           TEXT,
  row_json      TEXT,
  created_at    TEXT
);
`

// Migrations are columns added after a schema shipped, as (table, column,
// declaration). CREATE TABLE IF NOT EXISTS never revisits an existing table,
// so an additive change needs an explicit ALTER. Add to the end; never edit.
var Migrations = [][3]string{
	{"matches", "ticket_id", "TEXT"}, // version 2: the Upcoming Matches ticket a match played
}

// Tables are the tables a relay sends, with their primary keys.
var Tables = map[string][]string{
	"matches":          {"match_id"},
	"objectives":       {"objective_id"},
	"events":           {"event_id"},
	"match_reports":    {"report_id"},
	"official_reviews": {"review_id"},
	"processes":        {"process_id"},
	"club_sessions":    {"match_id", "player"},
	"team_talks":       {"match_id", "player"},
	"upcoming_matches": {"ticket_id"},
}

// LocalTables are tables a Mac keeps and never relays: a request made on the
// cloud page lives in the cloud and is claimed over the fleet API instead.
var LocalTables = map[string][]string{
	"requests": {"request_id"},
}

// TableOrder is the order a backfill sends tables in, parents first.
var TableOrder = []string{"matches", "objectives", "club_sessions", "team_talks",
	"processes", "events", "match_reports", "official_reviews", "upcoming_matches"}
