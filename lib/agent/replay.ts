import { db, q, usingPostgres } from "../db";
import { ensureImported, isSafeId } from "../query/load";
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

// Bundled runs (the recorded demo) are imported into local SQLite, so they stay readable when live runs go to Postgres.
const bundled = (sql: string, ...p: string[]) => (ensureImported(), usingPostgres() ? (db().prepare(sql).all(...p) as Row[]) : []);

export async function loadRun(id: string): Promise<RecordedRun | null> {
  if (!isSafeId(id)) return null;
  ensureImported();
  const sql = "SELECT id, created_at, spec_json, events_json FROM runs WHERE id = ?";
  const [r] = [...(await q<Row>(sql, [id])), ...bundled(sql, id)];
  return r ? { id: r.id, createdAt: r.created_at, spec: JSON.parse(r.spec_json), events: JSON.parse(r.events_json) } : null;
}

export async function listRuns(): Promise<{ id: string; createdAt: string; useType: string; city: string }[]> {
  ensureImported();
  const sql = "SELECT id, created_at, spec_json FROM runs ORDER BY created_at DESC LIMIT 200";
  const rows = [...(await q<Omit<Row, "events_json">>(sql)), ...bundled(sql)].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return rows.map((r) => {
    const s = JSON.parse(r.spec_json) as RequirementSpec;
    return { id: r.id, createdAt: r.created_at, useType: s.useType, city: s.city };
  });
}
