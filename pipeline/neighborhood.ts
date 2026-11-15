// Prefetches free neighborhood data for every candidate site and writes data/processed/site/<sid>.json.
// Sources: TxDOT / Caltrans annual average daily traffic, OpenStreetMap (Overpass), Census geocoder, and Census ACS
// when CENSUS_API_KEY is set. Each city's layers are pulled once in bulk, then matched to sites locally.
// Run: npx tsx --env-file=.env pipeline/neighborhood.ts [--layers]
import fs from "node:fs";
import path from "node:path";
import type { Shell } from "../lib/types";
import type { SiteFile, Poi } from "../lib/neighborhood/types";
import { workersNear } from "../lib/neighborhood/build";

const DIR = path.join(process.cwd(), "data", "processed");
const OUT = path.join(DIR, "site");
const CACHE = path.join(DIR, "neighborhood-cache");
const env = (k: string) => process.env[k]?.trim().replace(/^"|"$/g, "");
const BBOX = { houston: [29.45, -95.9, 30.15, -94.95], los_angeles: [33.65, -118.75, 34.4, -117.95] } as const;
const HEROES = new Set(["x37LjPx62VA", "1uXpcwty9Sr", "PxU1vnyht7Q", "GpFkvxKtRrp", "6FNMVoyPrL1", "Kst1D1ZfDa8", "zvKHR9DHNjJ"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url: string, init?: RequestInit, tries = 4): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
      if (r.ok) return await r.json();
      if (r.status < 500 && r.status !== 429) throw new Error(`${r.status} ${url.slice(0, 80)}`);
    } catch (e) { if (i === tries - 1) throw e; }
    await sleep(2000 * 2 ** i);
  }
}
function cached<T>(name: string, make: () => Promise<T>): Promise<T> {
  const f = path.join(CACHE, `${name}.json`);
  if (fs.existsSync(f)) return Promise.resolve(JSON.parse(fs.readFileSync(f, "utf8")));
  return make().then((v) => { fs.writeFileSync(f, JSON.stringify(v)); return v; });
}
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

type Count = { lat: number; lon: number; aadt: number; road: string; year?: number };

async function arcgisAll(base: string, params: string): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const r = await getJSON(`${base}/query?${params}&outSR=4326&returnGeometry=true&f=json&resultOffset=${offset}&resultRecordCount=1000`);
    out.push(...(r.features ?? []));
    if (!r.exceededTransferLimit && (r.features?.length ?? 0) < 1000) break;
  }
  return out;
}

async function trafficCounts(city: keyof typeof BBOX): Promise<Count[]> {
  const [s, w, n, e] = BBOX[city];
  const env4326 = encodeURIComponent(JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n, spatialReference: { wkid: 4326 } }));
  if (city === "houston") {
    const feats = await arcgisAll("https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_5_Year_Statewide_AADT_Traffic_Counts/FeatureServer/0",
      `where=1%3D1&geometry=${env4326}&geometryType=esriGeometryEnvelope&outFields=TRFC_STATN_ID,LATEST_AADT_YR,AADT_RPT_QTY,AADT_RPT_HIST_01_QTY,AADT_RPT_HIST_02_QTY,AADT_RPT_HIST_03_QTY,AADT_RPT_HIST_04_QTY`);
    return feats.flatMap((f) => {
      const a = f.attributes;
      const aadt = [a.AADT_RPT_QTY, a.AADT_RPT_HIST_01_QTY, a.AADT_RPT_HIST_02_QTY, a.AADT_RPT_HIST_03_QTY, a.AADT_RPT_HIST_04_QTY].find((x) => x > 0);
      return aadt && f.geometry ? [{ lat: f.geometry.y, lon: f.geometry.x, aadt, road: `TxDOT count station ${a.TRFC_STATN_ID}`, year: a.LATEST_AADT_YR }] : [];
    });
  }
  const feats = await arcgisAll("https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0",
    `where=1%3D1&geometry=${env4326}&geometryType=esriGeometryEnvelope&outFields=RTE,DESCRIPTION,AHEAD_AADT,BACK_AADT`);
  return feats.flatMap((f) => {
    const a = f.attributes;
    const aadt = Math.max(Number(a.AHEAD_AADT) || 0, Number(a.BACK_AADT) || 0);
    return aadt && f.geometry ? [{ lat: f.geometry.y, lon: f.geometry.x, aadt, road: `State Route ${a.RTE} at ${String(a.DESCRIPTION).split(",").slice(1).join(",").trim().toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}` }] : [];
  });
}

// Tags we count around each site. Competitor tags per use live in rules/uses.json ("osm").
const OSM_TAGS = ['shop~"hairdresser|beauty|massage|cosmetics|clothes|boutique|gift|convenience|supermarket"', 'amenity~"dentist|doctors|clinic|restaurant|cafe|fast_food|bar|pharmacy|bank|school|kindergarten"', 'leisure~"fitness_centre|sports_centre"', 'highway="bus_stop"', 'railway~"station|tram_stop"', 'public_transport~"station|platform"', 'office'];

async function osm(city: keyof typeof BBOX): Promise<Poi[]> {
  const [s, w, n, e] = BBOX[city];
  const q = `[out:json][timeout:170][bbox:${s},${w},${n},${e}];(${OSM_TAGS.map((t) => `node[${t}];`).join("")});out;`;
  for (const host of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]) {
    try {
      const r = await getJSON(host, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "hermit-hackathon/0.1" }, body: `data=${encodeURIComponent(q)}` }, 3);
      return (r.elements ?? []).map((el: { lat: number; lon: number; tags: Record<string, string> }) => ({ lat: el.lat, lon: el.lon, tags: el.tags ?? {}, name: el.tags?.name }));
    } catch (e) { console.error(`overpass ${host} failed: ${String(e).slice(0, 100)}`); }
  }
  return [];
}

async function blockGroup(lat: number, lon: number): Promise<string | null> {
  const r = await getJSON(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Census%20Block%20Groups&format=json`, undefined, 3).catch(() => null);
  return r?.result?.geographies?.["Census Block Groups"]?.[0]?.GEOID ?? null;
}

// ACS 5-year: median household income, population, and the 25–44 share, by block group (pulled per county).
async function acs(geoids: string[]): Promise<Map<string, { income?: number; pop?: number; age2544?: number }>> {
  const key = env("CENSUS_API_KEY");
  const out = new Map<string, { income?: number; pop?: number; age2544?: number }>();
  if (!key) return out;
  const age = ["B01001_011E", "B01001_012E", "B01001_013E", "B01001_014E", "B01001_035E", "B01001_036E", "B01001_037E", "B01001_038E"];
  const counties = [...new Set(geoids.map((g) => g.slice(0, 5)))];
  for (const c of counties) {
    const r = await getJSON(`https://api.census.gov/data/2023/acs/acs5?get=B19013_001E,B01003_001E,${age.join(",")}&for=block%20group:*&in=state:${c.slice(0, 2)}%20county:${c.slice(2)}%20tract:*&key=${key}`).catch((e) => { console.error("acs", c, String(e).slice(0, 80)); return null; });
    if (!r) continue;
    const [head, ...rows] = r as string[][];
    const ix = (k: string) => head.indexOf(k);
    for (const row of rows) {
      const id = `${row[ix("state")]}${row[ix("county")]}${row[ix("tract")]}${row[ix("block group")]}`;
      const pop = Number(row[ix("B01003_001E")]);
      const income = Number(row[ix("B19013_001E")]);
      const young = age.reduce((s, k) => s + (Number(row[ix(k)]) || 0), 0);
      out.set(id, { income: income > 0 ? income : undefined, pop: pop > 0 ? pop : undefined, age2544: pop > 0 ? young / pop : undefined });
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });
  const shells: Shell[] = JSON.parse(fs.readFileSync(path.join(DIR, "shells.json"), "utf8"));
  const sites = shells.filter((s) => s.lat != null && s.lon != null && s.sid && (HEROES.has(s.sid) || (s.mode !== "home" && !["amenity", "other", "unit"].includes(s.kind ?? ""))));
  console.log(`${sites.length} sites`);
  const layers: Record<string, { counts: Count[]; pois: Poi[] }> = {};
  for (const city of ["houston", "los_angeles"] as const) {
    const counts = await cached(`aadt-${city}`, () => trafficCounts(city));
    const pois = await cached(`osm-${city}`, () => osm(city));
    layers[city] = { counts, pois };
    console.log(city, `${counts.length} traffic counts, ${pois.length} OSM points`);
  }
  // --layers: only the city-wide layers the report map builds from (no per-site lookups).
  if (process.argv.includes("--layers")) return;
  // Block groups are cached; only sites added since the last run are looked up.
  const bgFile = path.join(CACHE, "blockgroups.json");
  const bgs: Record<string, string | null> = fs.existsSync(bgFile) ? JSON.parse(fs.readFileSync(bgFile, "utf8")) : {};
  const queue = sites.filter((s) => !(s.sid! in bgs));
  await Promise.all(Array.from({ length: 4 }, async () => { for (let s = queue.shift(); s; s = queue.shift()) bgs[s.sid!] = await blockGroup(s.lat!, s.lon!); }));
  fs.writeFileSync(bgFile, JSON.stringify(bgs));
  const demo = await acs(Object.values(bgs).filter(Boolean) as string[]);
  const now = new Date().toISOString().slice(0, 10);
  let withTraffic = 0, withOsm = 0, withAcs = 0;
  for (const s of sites) {
    const here = { lat: s.lat!, lon: s.lon! };
    const L = layers[s.city] ?? { counts: [], pois: [] };
    const near = L.counts.map((c) => ({ ...c, km: km(here, c) })).filter((c) => c.km <= 1.6).sort((a, b) => b.aadt - a.aadt);
    const pois = L.pois.map((p) => ({ ...p, km: km(here, p) })).filter((p) => p.km <= 0.85);
    const bg = bgs[s.sid!] ?? null;
    const d = bg ? demo.get(bg) : undefined;
    const file: SiteFile = {
      sid: s.sid!, lat: s.lat!, lon: s.lon!, city: s.city, retrieved: now,
      traffic: near[0] ? { aadt: near[0].aadt, road: near[0].road, km: Math.round(near[0].km * 100) / 100, year: near[0].year, source: s.city === "houston" ? "TxDOT 5-year statewide AADT counts" : "Caltrans AADT (state highways only)" } : null,
      pois: pois.map((p) => ({ lat: p.lat, lon: p.lon, tags: p.tags, name: p.name, km: Math.round(p.km * 1000) / 1000 })),
      osmSource: L.pois.length ? "OpenStreetMap via Overpass" : null,
      blockGroup: bg,
      demographics: d ? { ...d, source: "US Census ACS 5-year 2023, block group" } : null,
      workers: workersNear(s.city, s.lat!, s.lon!),
    };
    if (file.traffic) withTraffic++;
    if (L.pois.length) withOsm++;
    if (d) withAcs++;
    // Keep BestTime busyness from pipeline/besttime.ts; it costs credits to refetch.
    const prev = path.join(OUT, `${s.sid}.json`);
    if (fs.existsSync(prev)) { const old = JSON.parse(fs.readFileSync(prev, "utf8")) as SiteFile; if (old.busyness) file.busyness = old.busyness; }
    fs.writeFileSync(prev, JSON.stringify(file));
  }
  console.log(`wrote ${sites.length}: traffic ${withTraffic}, OSM ${withOsm}, ACS ${withAcs}${env("CENSUS_API_KEY") ? "" : " (no CENSUS_API_KEY)"}`);
}

main();
