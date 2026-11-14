-- Hermit app state shared across server instances. Mirrors the SQLite tables in lib/db/schema.ts;
-- *_json columns hold opaque app blobs the server never queries into, so they stay text.
-- The catalog (shells, roomgraphs) is read-only bundle data and stays in per-instance SQLite.

create table conversations (
  id text primary key,
  viewer_id text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  state_json text not null
);

create table messages (
  id text primary key,
  conversation_id text not null references conversations (id) on delete cascade,
  seq integer not null,
  role text not null,
  kind text not null,
  payload_json text not null,
  created_at timestamptz not null,
  unique (conversation_id, seq) -- also serves as the FK index
);

create table saved (
  viewer_id text not null,
  shell_id text not null,
  report_json text not null,
  spec_json text not null,
  saved_at timestamptz not null,
  primary key (viewer_id, shell_id)
);

create table designs (
  id text primary key,
  conversation_id text,
  kind text not null check (kind in ('layout', 'upload')),
  json text not null,
  created_at timestamptz not null
);

create table runs (
  id text primary key,
  created_at timestamptz not null,
  spec_json text not null,
  events_json text not null
);
create index runs_created_at on runs (created_at desc);

create table regulation_findings (
  cache_key text primary key,
  json text not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null
);

-- Only the server touches these tables, over a direct Postgres connection as the owner role.
-- RLS with no policies plus revoked grants keeps them unreachable through the Data API.
alter table conversations enable row level security;
alter table messages enable row level security;
alter table saved enable row level security;
alter table designs enable row level security;
alter table runs enable row level security;
alter table regulation_findings enable row level security;
revoke all on conversations, messages, saved, designs, runs, regulation_findings from anon, authenticated;
