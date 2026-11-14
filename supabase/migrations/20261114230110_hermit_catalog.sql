-- Search catalog (CoStar/Matterport-derived shells and room graphs). This data is private and is never
-- committed to the public repo; it is uploaded with `npm run db:push-catalog` and copied into each
-- server instance's local SQLite at startup (instrumentation.ts), where all search reads happen.

create table shells (
  id text primary key,
  sid text,
  mode text not null,
  city text not null,
  sqft double precision,
  json text not null
);

create table roomgraphs (
  sid text primary key,
  json text not null
);

alter table shells enable row level security;
alter table roomgraphs enable row level security;
revoke all on shells, roomgraphs from anon, authenticated;
