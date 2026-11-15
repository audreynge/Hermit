// Fills coordinates for business scans that have a street address but no lat/lon (Census, then Esri, then Google).
// Results are cached in neighborhood-cache/geocoded.json and merged by pipeline/index.ts on rebuilds.
// Run: npx tsx --env-file=.env pipeline/geocode.ts
import fs from "node:fs";
import path from "node:path";
import { geocode, type Geo } from "../lib/neighborhood/geocode";
import type { Shell } from "../lib/types";

const DIR = path.join(process.cwd(), "data", "processed");
const CACHE = path.join(DIR, "neighborhood-cache", "geocoded.json");
const BUSINESS = new Set(["suite", "office", "medical", "salon", "retail", "warehouse"]);

async function main() {
  const shells: Shell[] = JSON.parse(fs.readFileSync(path.join(DIR, "shells.json"), "utf8"));
  const cache: Record<string, Geo | null> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
  const todo = shells.filter((s) => s.sid && BUSINESS.has(s.kind ?? "") && s.lat == null && /^\d+\s/.test(s.address) && !cache[s.sid]);
  for (const s of todo) {
    const street = s.address.split(/\s+-\s+|,?\s+(?:suite|ste\.?|#)\s*\w+/i)[0].replace(/,\s*US\b.*$/, "");
    const named = /houston|los angeles|, (TX|CA)\b/i.test(street);
    // With no city on the scan and none in the address, a geocoder would only guess; skip it.
    if (!named && s.city !== "houston" && s.city !== "los_angeles") continue;
    const q = named ? street : `${street}, ${s.city === "houston" ? "Houston, TX" : "Los Angeles, CA"}`;
    cache[s.sid!] = await geocode(q);
    console.log(`${s.sid} ${q} → ${cache[s.sid!] ? `${cache[s.sid!]!.source}${cache[s.sid!]!.approximate ? " (approximate)" : ""}` : "not found"}`);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  let n = 0;
  for (const s of shells) {
    const g = s.sid ? cache[s.sid] : null;
    if (g && s.lat == null) { s.lat = g.lat; s.lon = g.lon; n++; }
  }
  fs.writeFileSync(path.join(DIR, "shells.json"), JSON.stringify(shells));
  console.log(`geocoded ${Object.values(cache).filter(Boolean).length}/${Object.keys(cache).length}; applied ${n}`);
}

main();
