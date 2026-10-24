-- Matchday Live, version 2: Upcoming Matches, run requests, and the Claude
-- connector's OAuth state.
--
-- Additive only: every version 1 table and column keeps its meaning. The
-- same rules as 0001 hold: ISO-8601 UTC text times, no foreign keys, Row
-- Level Security ON with NO policy (only the server connection reads and
-- writes), safe to run more than once. Run after 0001; "Apply schema" on the
-- Connections page runs both, in order.

-- The Upcoming Matches ticket a match played, or null.
alter table matches add column if not exists ticket_id text;

-- Planned work, read from a source (a markdown file now, Linear later) on a
-- Mac and relayed through /api/ingest like the match log.
create table if not exists upcoming_matches (
  ticket_id   text primary key,
  source      text,
  source_ref  text,
  sprint      text,
  title       text,
  date        text,
  time        text,
  timezone    text,
  due_at      text,
  set_piece   text,
  mode        text,
  prompt      text,
  player      text,
  status      text,
  match_id    text,
  machine     text,
  note        text,
  updated_at  text
);

-- "Run this now", from the page or the Claude connector. Lives only here: a
-- Mac's Scheduler claims one over /api/fleet/claim and reports its progress.
-- claimed_token is the fleet token that claimed it, so only that Mac can
-- move it on; it is never sent to the page.
create table if not exists requests (
  request_id    text primary key,
  created_at    text not null,
  requested_by  text,
  kind          text not null,
  set_piece     text,
  prompt        text,
  player        text,
  ticket_id     text,
  machine       text,
  status        text not null,
  claimed_by    text,
  claimed_token text,
  match_id      text,
  note          text,
  updated_at    text
);

-- ── the Claude connector: OAuth 2.1 ─────────────────────────────────────────
-- No code, token or client secret is stored: only its SHA-256 (hex). A
-- leaked copy of these tables lets nobody in.

-- Clients: registered through /oauth/register (kind 'dcr'), or known by the
-- URL of their Client ID Metadata Document (kind 'cimd', cached here).
create table if not exists oauth_clients (
  client_id           text primary key,
  kind                text not null,
  client_name         text,
  redirect_uris       text not null,  -- JSON array of strings
  auth_method         text not null default 'none',
  secret_hash         text,
  created_at          text not null,
  fetched_at          text,           -- cimd: when the document was last read
  last_used_at        text,
  revoked_at          text
);

-- Authorization codes: single use, a couple of minutes long, bound to the
-- client, the exact redirect URI, the PKCE challenge and the resource.
create table if not exists oauth_codes (
  code_hash       text primary key,
  grant_id        text not null,
  client_id       text not null,
  redirect_uri    text not null,
  code_challenge  text not null,
  resource        text not null,
  scope           text,
  created_at      text not null,
  expires_at      text not null,
  used_at         text
);

-- A grant is one consent: the family every rotated token of a connection
-- belongs to. Revoking it (the Connections page, a reused code or refresh
-- token) cuts every token in it at once.
create table if not exists oauth_grants (
  grant_id      text primary key,
  client_id     text not null,
  resource      text not null,
  scope         text,
  created_at    text not null,
  last_used_at  text,
  revoked_at    text
);

-- Access tokens (an hour) and refresh tokens (rotated on every use).
create table if not exists oauth_tokens (
  token_hash  text primary key,
  kind        text not null,  -- access | refresh
  grant_id    text not null,
  client_id   text not null,
  resource    text not null,
  scope       text,
  created_at  text not null,
  expires_at  text not null,
  revoked_at  text
);

create index if not exists matches_by_ticket        on matches (ticket_id);
create index if not exists upcoming_by_due          on upcoming_matches (due_at);
create index if not exists requests_by_queue        on requests (status, created_at);
create index if not exists requests_by_created      on requests (created_at desc);
create index if not exists requests_by_ticket       on requests (ticket_id);
-- One open request per ticket: asking twice while the first is still waiting
-- or playing is refused by the database itself, whatever the timing.
create unique index if not exists requests_one_open_per_ticket
  on requests (ticket_id) where kind = 'ticket' and status in ('queued', 'claimed', 'running');
create index if not exists oauth_codes_by_expiry    on oauth_codes (expires_at);
create index if not exists oauth_grants_by_client   on oauth_grants (client_id);
create index if not exists oauth_tokens_by_grant    on oauth_tokens (grant_id);
create index if not exists oauth_tokens_by_expiry   on oauth_tokens (expires_at);
create index if not exists oauth_clients_by_created on oauth_clients (created_at);

alter table upcoming_matches  enable row level security;
alter table requests          enable row level security;
alter table oauth_clients     enable row level security;
alter table oauth_codes       enable row level security;
alter table oauth_grants      enable row level security;
alter table oauth_tokens      enable row level security;

insert into schema_version (version, applied_at)
values (2, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'))
on conflict (version) do nothing;
