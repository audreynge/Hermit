import fs from "node:fs";
import path from "node:path";
import type { RoomGraph, Shell } from "../types";

export const isSafeId = (id: string) => /^[A-Za-z0-9_-]{1,40}$/.test(id);

export function dataDir(): string {
  if (process.env.HERMIT_DATA_DIR) return process.env.HERMIT_DATA_DIR;
  const processed = path.join(process.cwd(), "data", "processed");
  return fs.existsSync(path.join(processed, "shells.json")) ? processed : path.join(process.cwd(), "data", "sample");
}

let cache: { dir: string; shells: Shell[]; byId: Map<string, Shell> } | null = null;

function table() {
  const dir = dataDir();
  if (cache?.dir !== dir) {
    const shells: Shell[] = JSON.parse(fs.readFileSync(path.join(dir, "shells.json"), "utf8"));
    cache = { dir, shells, byId: new Map(shells.map((s) => [s.id, s])) };
  }
  return cache;
}

export const loadShells = () => table().shells;
export const getShell = (id: string) => table().byId.get(id) ?? null;

export function loadRoomGraph(sid: string): RoomGraph | null {
  if (!isSafeId(sid)) return null;
  const file = path.join(dataDir(), "roomgraphs", `${sid}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}
