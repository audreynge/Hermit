export const SCHEMA_VERSION = 1;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS shells (id TEXT PRIMARY KEY, sid TEXT, mode TEXT NOT NULL, city TEXT NOT NULL, sqft REAL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS shells_city_mode ON shells (city, mode);
CREATE TABLE IF NOT EXISTS roomgraphs (sid TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, spec_json TEXT NOT NULL, events_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, state_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_conv_seq ON messages (conversation_id, seq);
CREATE TABLE IF NOT EXISTS saved (viewer_id TEXT NOT NULL, shell_id TEXT NOT NULL, report_json TEXT NOT NULL, spec_json TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY (viewer_id, shell_id));
CREATE TABLE IF NOT EXISTS designs (id TEXT PRIMARY KEY, conversation_id TEXT, kind TEXT NOT NULL CHECK (kind IN ('layout', 'upload')), json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS regulation_findings (cache_key TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL);
`;
