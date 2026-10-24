-- Matchday Live: the match log in Supabase (Postgres).
--
-- The same eight tables the Go engine writes to match_log.db on each Mac
-- (wiki/DATA-CONTRACT.md), plus the fleet tokens that let a Mac relay its
-- rows, and the schema version. Every time is ISO-8601 UTC text with
-- milliseconds, written by the engine, so a relayed row is byte-identical to
-- the local one; it is stored as text on purpose.
--
-- No foreign keys: a Mac relays rows in the order it wrote them, a backfill
-- sends parents first, and a refused child row would stall a relay over an
-- ordering detail. SQLite never enforced them either.
--
-- Row Level Security is ON for every table and NO policy is defined. Nothing
-- reaches these tables through Supabase's public API (anon or authenticated
-- keys see nothing); only Matchday Live's server connection, which logs in
-- as the database owner through DATABASE_URL, reads and writes them.
--
-- Safe to run more than once: Matchday Live's "Apply schema" button runs this
-- file as it is.

create table if not exists schema_version (
  version     integer primary key,
  applied_at  text not null
);

create table if not exists matches (
  match_id      text primary key,
  setpiece_name text,
  ask           text,
  status        text,
  founder       text,
  project       text,
  machine       text,
  started_at    text,
  ended_at      text,
  total_tokens  bigint default 0,
  total_cost    double precision default 0,
  archived      integer default 0,
  updated_at    text
);

create table if not exists objectives (
  objective_id  text primary key,
  match_id      text not null,
  seq           integer,
  name          text,
  kind          text,
  owner         text,
  description   text,
  status        text default 'turnover',
  attempt       integer default 0,
  retries       integer default 0,
  error         text,
  started_at    text,
  ended_at      text
);

create table if not exists events (
  cursor        bigint generated always as identity unique,
  event_id      text primary key,
  match_id      text not null,
  objective_id  text,
  parent_id     text,
  type          text,
  name          text,
  payload_json  text,
  tokens        bigint,
  started_at    text,
  ended_at      text
);

create table if not exists match_reports (
  report_id     text primary key,
  match_id      text not null,
  objective_id  text,
  player        text,
  report_type   text,
  payload_json  text,
  valid         integer,
  attempt       integer,
  created_at    text
);

create table if not exists official_reviews (
  review_id       text primary key,
  match_id        text not null,
  objective_id    text,
  attempt         integer,
  review          text,
  passed          integer,
  violations_json text,
  checks_json     text,
  created_at      text
);

create table if not exists processes (
  process_id    text primary key,
  match_id      text not null,
  kind          text,
  name          text,
  pid           integer,
  command       text,
  started_at    text,
  ended_at      text
);

create table if not exists club_sessions (
  match_id        text not null,
  player          text not null,
  club            text,
  model           text,
  color           text,
  session_id      text,
  context_tokens  bigint,
  context_window  bigint,
  created_at      text,
  last_used_at    text,
  primary key (match_id, player)
);

create table if not exists team_talks (
  match_id    text not null,
  player      text not null,
  system      text,
  "user"      text,
  updated_at  text,
  primary key (match_id, player)
);

-- A Mac's permission to relay. The token itself is shown once on the page;
-- only its SHA-256 hash (hex) is kept.
create table if not exists fleet_tokens (
  id            text primary key,
  label         text not null,
  token_hash    text not null unique,
  created_at    text not null,
  last_seen_at  text,
  revoked_at    text
);

create index if not exists matches_by_start      on matches (started_at desc);
create index if not exists matches_by_update     on matches (updated_at);
create index if not exists objectives_by_match   on objectives (match_id, seq);
create index if not exists events_by_match       on events (match_id, cursor);
create index if not exists events_by_match_type  on events (match_id, type);
create index if not exists reports_by_match      on match_reports (match_id);
create index if not exists reviews_by_match      on official_reviews (match_id);
create index if not exists processes_by_match    on processes (match_id);

alter table schema_version    enable row level security;
alter table matches           enable row level security;
alter table objectives        enable row level security;
alter table events            enable row level security;
alter table match_reports     enable row level security;
alter table official_reviews  enable row level security;
alter table processes         enable row level security;
alter table club_sessions     enable row level security;
alter table team_talks        enable row level security;
alter table fleet_tokens      enable row level security;

insert into schema_version (version, applied_at)
values (1, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'))
on conflict (version) do nothing;
