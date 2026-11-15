import fs from "node:fs";
import path from "node:path";
import { db, q, usingPostgres } from "../db";
import { dataDir, ensureImported, isSafeId } from "../query/load";
import type { RequirementSpec, TraceEvent } from "../types";

export type RecordedRun = { id: string; createdAt: string; spec: RequirementSpec; events: TraceEvent[] };
type Row = { id: string; created_at: string; spec_json: string; events_json: string };

export const newRunId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export async function saveRun(id: string, spec: RequirementSpec, events: TraceEvent[]) {
  if (!isSafeId(id)) throw new Error("unsafe run id");
  await q(`INSERT INTO runs (id, created_at, spec_json, events_json) VALUES (?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET created_at = excluded.created_at, spec_json = excluded.spec_json, events_json = excluded.events_json`,
    [id, new Date().toISOString(), JSON.stringify(spec), JSON.stringify(events)]);
}

// The database is the store, but the recorded replays also ship as data/processed/replay/<id>.json. Read them when
// the database lacks the run or can't be reached (offline), so the demo and the home gallery never come up empty.
const replayDir = () => path.join(dataDir(), "replay");
function readLocal(id: string): RecordedRun | null {
  try {
    const f = path.join(replayDir(), `${id}.json`);
    if (!fs.existsSync(f)) return null;
    const r = JSON.parse(fs.readFileSync(f, "utf8")) as Partial<RecordedRun>;
    return r?.spec && Array.isArray(r.events) ? { id: r.id ?? id, createdAt: r.createdAt ?? "", spec: r.spec, events: r.events } : null;
  } catch {
    return null;
  }
}
const localIds = () => {
  try {
    return fs.readdirSync(replayDir()).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter(isSafeId);
  } catch {
    return [];
  }
};

// A replay must never hang on the network: a slow or unreachable Postgres is given this long, then local copies answer.
export const REPLAY_DB_TIMEOUT_MS = 2500;
const withTimeout = <T>(p: Promise<T>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(`no answer in ${ms}ms`)), ms); })])
    .finally(() => clearTimeout(timer));
};

// Bundled runs (the recorded demo) are imported into local SQLite, so they stay readable when live runs go to Postgres.
async function rows<T>(sql: string, p: string[] = []): Promise<T[]> {
  let out: T[] = [];
  try { ensureImported(); } catch { /* local SQLite unavailable */ }
  try { out = await withTimeout(q<T>(sql, p), REPLAY_DB_TIMEOUT_MS); } catch { /* offline or slow: fall through to the local copies */ }
  if (usingPostgres()) try { out = [...out, ...(db().prepare(sql).all(...p) as T[])]; } catch { /* local SQLite unavailable */ }
  return out;
}

export async function loadRun(id: string): Promise<RecordedRun | null> {
  if (!isSafeId(id)) return null;
  const [r] = await rows<Row>("SELECT id, created_at, spec_json, events_json FROM runs WHERE id = ?", [id]);
  return r ? { id: r.id, createdAt: r.created_at, spec: JSON.parse(r.spec_json), events: JSON.parse(r.events_json) } : readLocal(id);
}

export async function listRuns(): Promise<{ id: string; createdAt: string; useType: string; city: string }[]> {
  const found = (await rows<Omit<Row, "events_json">>("SELECT id, created_at, spec_json FROM runs ORDER BY created_at DESC LIMIT 200"))
    .map((r) => {
      const s = JSON.parse(r.spec_json) as RequirementSpec;
      return { id: r.id, createdAt: r.created_at, useType: s.useType, city: s.city };
    });
  const seen = new Set(found.map((r) => r.id));
  for (const id of localIds()) {
    if (seen.has(id)) continue;
    const r = readLocal(id);
    if (r) found.push({ id: r.id, createdAt: r.createdAt, useType: r.spec.useType, city: r.spec.city });
  }
  return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
}
