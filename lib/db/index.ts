import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "../paths";
import { SCHEMA, SCHEMA_VERSION } from "./schema";

let handle: { file: string; db: DatabaseSync } | null = null;
let gen = 0;

// Bumped by bulk imports so in-memory caches built on top of the DB know to reload.
export const generation = () => gen;
export const bumpGeneration = () => { gen++; };

// Vercel's deploy bundle is read-only; /tmp is the only writable path there.
// ponytail: /tmp is per-instance and wiped on cold start, so chats and saves are not durable on Vercel; move to a hosted DB if they must persist.
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
