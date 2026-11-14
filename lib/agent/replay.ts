import { db } from "../db";
import { ensureImported, isSafeId } from "../query/load";
import type { RequirementSpec, TraceEvent } from "../types";

export type RecordedRun = { id: string; createdAt: string; spec: RequirementSpec; events: TraceEvent[] };

export const newRunId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function saveRun(id: string, spec: RequirementSpec, events: TraceEvent[]) {
  if (!isSafeId(id)) throw new Error("unsafe run id");
  db().prepare("INSERT OR REPLACE INTO runs (id, created_at, spec_json, events_json) VALUES (?, ?, ?, ?)")
    .run(id, new Date().toISOString(), JSON.stringify(spec), JSON.stringify(events));
}

export function loadRun(id: string): RecordedRun | null {
  if (!isSafeId(id)) return null;
  ensureImported();
  const r = db().prepare("SELECT id, created_at, spec_json, events_json FROM runs WHERE id = ?").get(id) as
    | { id: string; created_at: string; spec_json: string; events_json: string } | undefined;
  return r ? { id: r.id, createdAt: r.created_at, spec: JSON.parse(r.spec_json), events: JSON.parse(r.events_json) } : null;
}

export function listRuns(): { id: string; createdAt: string; useType: string; city: string }[] {
  ensureImported();
  const rows = db().prepare("SELECT id, created_at, spec_json FROM runs ORDER BY created_at DESC LIMIT 200").all() as { id: string; created_at: string; spec_json: string }[];
  return rows.map((r) => {
    const s = JSON.parse(r.spec_json) as RequirementSpec;
    return { id: r.id, createdAt: r.created_at, useType: s.useType, city: s.city };
  });
}
