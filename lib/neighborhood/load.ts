import fs from "node:fs";
import path from "node:path";
import { dataDir, isSafeId } from "../query/load";
import type { SiteFile } from "./types";

const cache = new Map<string, SiteFile | null>();

export function loadSite(sid: string): SiteFile | null {
  if (!isSafeId(sid)) return null;
  if (cache.has(sid)) return cache.get(sid)!;
  const f = path.join(dataDir(), "site", `${sid}.json`);
  const v = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as SiteFile) : null;
  cache.set(sid, v);
  return v;
}
