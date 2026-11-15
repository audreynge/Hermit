import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths";
import type { PanoCheck } from "../types";

// Reads precomputed "looked closer" checks (written by pipeline/panos.ts) from data/processed/panos/<sid>/checks.json.
// Returns null when this room/feature was never checked: callers must treat null as "not looked at", never as "not seen".
export function loadPanoChecks(sid: string | undefined): PanoCheck[] {
  if (!sid || !/^[A-Za-z0-9]+$/.test(sid)) return [];
  const file = path.join(dataDir(), "panos", sid, "checks.json");
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as PanoCheck[]) : [];
  } catch {
    return [];
  }
}

export function loadPanoCheck(sid: string | undefined, roomId: string, feature: string): PanoCheck | null {
  const f = feature.toLowerCase();
  return loadPanoChecks(sid).find((c) => c.roomId === roomId && c.feature.toLowerCase() === f) ?? null;
}
