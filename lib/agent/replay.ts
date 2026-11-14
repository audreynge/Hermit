import fs from "node:fs";
import path from "node:path";
import { dataDir, isSafeId } from "../query/load";
import type { RequirementSpec, TraceEvent } from "../types";

export type RecordedRun = { id: string; createdAt: string; spec: RequirementSpec; events: TraceEvent[] };

const dir = () => path.join(dataDir(), "replay");
export const newRunId = () => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function saveRun(id: string, spec: RequirementSpec, events: TraceEvent[]) {
  if (!isSafeId(id)) throw new Error("unsafe run id");
  fs.mkdirSync(dir(), { recursive: true });
  const run: RecordedRun = { id, createdAt: new Date().toISOString(), spec, events };
  fs.writeFileSync(path.join(dir(), `${id}.json`), JSON.stringify(run));
}

export function loadRun(id: string): RecordedRun | null {
  if (!isSafeId(id)) return null;
  const f = path.join(dir(), `${id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

export function listRuns(): { id: string; createdAt: string; useType: string; city: string }[] {
  if (!fs.existsSync(dir())) return [];
  return fs.readdirSync(dir()).filter((f) => f.endsWith(".json")).flatMap((f) => {
    const r = loadRun(f.slice(0, -5));
    return r ? [{ id: r.id, createdAt: r.createdAt, useType: r.spec.useType, city: r.spec.city }] : [];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
