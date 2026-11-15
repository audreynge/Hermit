// Daytime population, the free foot-traffic proxy: US Census LEHD LODES 8 Workplace Area Characteristics (jobs per
// census block, 2022) joined to block centroids. Writes neighborhood-cache/workers-<city>.json as
// [lat, lon, jobs, retailJobs, foodJobs] rows inside each city's bounding box. No key needed.
// Run: npx tsx pipeline/workers.ts
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import zlib from "node:zlib";

const CACHE = path.join(process.cwd(), "data", "processed", "neighborhood-cache");
const BBOX = { houston: [29.45, -95.9, 30.15, -94.95], los_angeles: [33.65, -118.75, 34.4, -117.95] } as const;
const STATE = { houston: "tx", los_angeles: "ca" } as const;
const BASE = "https://lehd.ces.census.gov/data/lodes/LODES8";

// Quote-aware split: the crosswalk has fields like "Harris County, TX".
function split(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function lines(url: string, onLine: (cols: string[], head: string[]) => void) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`${r.status} ${url}`);
  const rl = readline.createInterface({ input: Readable.fromWeb(r.body as never).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let head: string[] | null = null;
  for await (const line of rl) {
    const cols = line.includes('"') ? split(line) : line.split(",");
    if (!head) { head = cols; continue; }
    onLine(cols, head);
  }
}

async function city(c: keyof typeof BBOX) {
  const st = STATE[c];
  const [s, w, n, e] = BBOX[c];
  const where = new Map<string, [number, number]>();
  let ix: Record<string, number> | null = null;
  await lines(`${BASE}/${st}/${st}_xwalk.csv.gz`, (cols, head) => {
    ix ??= { id: head.indexOf("tabblk2020"), lat: head.indexOf("blklatdd"), lon: head.indexOf("blklondd") };
    const lat = Number(cols[ix.lat]), lon = Number(cols[ix.lon]);
    if (lat >= s && lat <= n && lon >= w && lon <= e) where.set(cols[ix.id], [lat, lon]);
  });
  const rows: [number, number, number, number, number][] = [];
  let jx: Record<string, number> | null = null;
  await lines(`${BASE}/${st}/wac/${st}_wac_S000_JT00_2022.csv.gz`, (cols, head) => {
    jx ??= { id: head.indexOf("w_geocode"), all: head.indexOf("C000"), retail: head.indexOf("CNS07"), food: head.indexOf("CNS18") };
    const p = where.get(cols[jx.id]);
    if (p) rows.push([Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5, Number(cols[jx.all]), Number(cols[jx.retail]), Number(cols[jx.food])]);
  });
  fs.writeFileSync(path.join(CACHE, `workers-${c}.json`), JSON.stringify(rows));
  console.log(`${c}: ${rows.length} blocks with jobs, ${rows.reduce((t, r) => t + r[2], 0).toLocaleString()} jobs`);
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const c of ["houston", "los_angeles"] as const) await city(c);
}

main();
