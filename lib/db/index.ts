import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import postgres from "postgres";
import { dataDir } from "../paths";
import { SCHEMA, SCHEMA_VERSION } from "./schema";

let handle: { file: string; db: DatabaseSync } | null = null;
let gen = 0;

// Bumped by bulk imports so in-memory caches built on top of the DB know to reload.
export const generation = () => gen;
export const bumpGeneration = () => { gen++; };

// Vercel's deploy bundle is read-only; /tmp is the only writable path there.
// /tmp is per-instance, so on Vercel it only holds the catalog rebuilt from the bundle; app state goes to Postgres via q().
export const dbFile = () => process.env.HERMIT_DB ?? path.join(process.env.VERCEL ? "/tmp" : dataDir(), "hermit.db");

export function db(): DatabaseSync {
  const file = dbFile();
  if (handle?.file === file) return handle.db;
  handle?.db.close();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const d = new DatabaseSync(file);
  d.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;");
  const { user_version } = d.prepare("PRAGMA user_version").get() as { user_version: number };
  if (user_version < SCHEMA_VERSION) {
    d.exec(SCHEMA);
    d.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
  }
  handle = { file, db: d };
  return d;
}

let pg: postgres.Sql | null = null;
export const usingPostgres = () => !!process.env.DATABASE_URL;

// App state (conversations, saved spaces, runs, caches) must be shared across server instances, so it
// lives in Postgres when DATABASE_URL is set; otherwise local SQLite keeps dev, tests and offline replay working.
// SQL passed here must run on both: '?' placeholders, ON CONFLICT upserts, no engine-specific functions.
export async function q<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!usingPostgres()) return db().prepare(sql).all(...(params as SQLInputValue[])) as T[];
  // Supabase transaction pooler: no prepared statements; small pool per serverless instance.
  pg ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, idle_timeout: 20 });
  let i = 0;
  const rows = await pg.unsafe(sql.replace(/\?/g, () => `$${++i}`), params as postgres.ParameterOrJSON<never>[]);
  // timestamptz comes back as Date; callers expect the ISO strings SQLite stores.
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))) as T[];
}

export function closeDb() {
  handle?.db.close();
  handle = null;
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
