import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths";
import type { AerialCount } from "../types";

// Reads a precomputed aerial count (written by pipeline/aerial.ts). Returns null when the space wasn't counted:
// callers must treat null as "not counted", never as zero.
export function loadAerialCount(sid: string | undefined): AerialCount | null {
  if (!sid || !/^[A-Za-z0-9]+$/.test(sid)) return null;
  const file = path.join(dataDir(), "aerial", `${sid}.json`);
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as AerialCount) : null;
  } catch {
    return null;
  }
}
