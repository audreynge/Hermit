// Adds a "busiest hours" proxy to the sites that matter for the demo: a BestTime venue search around each site, then the
// weekly forecasts of the venues it found, averaged. Credits are limited (about 6 per site), so it covers only the report
// shells from recorded runs plus a few heroes, capped by MAX_SITES. Cached per site in neighborhood-cache/besttime.json.
// Run: npx tsx --env-file=.env pipeline/besttime.ts [maxSites]
import fs from "node:fs";
import path from "node:path";
import type { SiteFile } from "../lib/neighborhood/types";

const DIR = path.join(process.cwd(), "data", "processed");
const CACHE = path.join(DIR, "neighborhood-cache", "besttime.json");
const key = (process.env.BEST_TIME_KEY ?? process.env.BESTTIME_API_KEY ?? "").trim().replace(/^"|"$/g, "");
const MAX_SITES = Number(process.argv[2] ?? 12);
const HEROES = ["x37LjPx62VA", "PxU1vnyht7Q", "6FNMVoyPrL1"];
const API = "https://besttime.app/api/v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Entry = { hours: number[]; venues: number } | null;

async function busyness(lat: number, lon: number, pub: string): Promise<Entry> {
  const s = await (await fetch(`${API}/venues/search?api_key_private=${key}&q=${encodeURIComponent("restaurants cafes and shops")}&num=6&lat=${lat}&lng=${lon}&radius=600&format=raw`, { method: "POST" })).json();
  if (!s.job_id) { console.log(`  search failed: ${String(s.message ?? s.status).slice(0, 100)}`); return null; }
  let venues: { venue_id: string; forecast?: boolean }[] = [];
  for (let i = 0; i < 40; i++) {
    await sleep(4000);
    const p = await (await fetch(`${API}/venues/progress?job_id=${s.job_id}&collection_id=${s.collection_id ?? ""}&format=raw`)).json();
    if (p.job_finished) { venues = p.venues ?? []; break; }
  }
  const sum = Array(24).fill(0);
  let days = 0, used = 0;
  for (const v of venues.filter((x) => x.forecast).slice(0, 6)) {
    const w = await (await fetch(`${API}/forecasts/week/raw2?api_key_public=${pub}&venue_id=${v.venue_id}`)).json();
    if (w.status !== "OK") continue;
    used++;
    // day_raw has 24 values starting at 6 AM; rotate so index 0 is midnight.
    for (const d of w.analysis?.week_raw ?? []) { (d.day_raw as number[]).forEach((x, i) => { sum[(i + 6) % 24] += x; }); days++; }
  }
  return days ? { hours: sum.map((x) => Math.round(x / days)), venues: used } : null;
}

async function main() {
  if (!key) throw new Error("BEST_TIME_KEY is not set");
  const info = await (await fetch(`${API}/keys/${key}`)).json();
  if (!info.valid) throw new Error("BestTime key is not valid");
  console.log(`BestTime credits: ${info.credits_forecast} forecast, ${info.credits_query} query`);
  const cache: Record<string, Entry> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
  const sids: string[] = [];
  for (const id of ["demo", "clinic"]) {
    const f = path.join(DIR, "replay", `${id}.json`);
    if (fs.existsSync(f)) for (const e of JSON.parse(fs.readFileSync(f, "utf8")).events) if (e.type === "report") for (const r of e.reports) if (r.inside?.sid) sids.push(r.inside.sid);
  }
  sids.push(...HEROES);
  let done = 0;
  for (const sid of [...new Set(sids)]) {
    const file = path.join(DIR, "site", `${sid}.json`);
    if (!fs.existsSync(file)) continue;
    const site: SiteFile = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!(sid in cache)) {
      if (done >= MAX_SITES) continue;
      done++;
      cache[sid] = await busyness(site.lat, site.lon, info.api_key_public).catch(() => null);
      fs.writeFileSync(CACHE, JSON.stringify(cache));
    }
    const c = cache[sid];
    if (c) {
      site.busyness = { hours: c.hours, source: `BestTime forecasts for ${c.venues} nearby venue${c.venues > 1 ? "s" : ""}, weekly average (proxy)` };
      fs.writeFileSync(file, JSON.stringify(site));
    }
    console.log(`${sid}: ${c ? `busyness from ${c.venues} venues` : "no forecast"}`);
  }
}

main();
