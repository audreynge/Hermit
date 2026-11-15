import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../query/load";
import type { Poi, SiteFile } from "./types";

// Builds a site file for any point from the cached city layers the pipeline downloaded (no live Overpass calls).
type Count = { lat: number; lon: number; aadt: number; road: string; year?: number };
const layers = new Map<string, { counts: Count[]; pois: Poi[]; workers: [number, number, number, number, number][] }>();

export const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function layer(city: string) {
  if (!layers.has(city)) {
    const dir = path.join(dataDir(), "neighborhood-cache");
    const read = <T,>(f: string, d: T): T => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : d);
    layers.set(city, { counts: read(`aadt-${city}.json`, [] as Count[]), pois: read(`osm-${city}.json`, [] as Poi[]), workers: read(`workers-${city}.json`, [] as [number, number, number, number, number][]) });
  }
  return layers.get(city)!;
}

// Daytime population: LEHD jobs in census blocks whose centroid is within a 10-minute walk (800 m).
export function workersNear(city: string, lat: number, lon: number): SiteFile["workers"] {
  const W = layer(city).workers;
  if (!W.length) return null;
  let jobs = 0, retailFood = 0;
  const here = { lat, lon };
  for (const [la, lo, all, retail, food] of W) {
    if (Math.abs(la - lat) > 0.009 || Math.abs(lo - lon) > 0.011) continue;
    if (km(here, { lat: la, lon: lo }) <= 0.8) { jobs += all; retailFood += retail + food; }
  }
  return { jobs, retailFood, source: "US Census LEHD LODES 2022 (jobs by census block)" };
}

export function siteAt(lat: number, lon: number, city: string): SiteFile {
  const here = { lat, lon };
  const L = layer(city);
  const near = L.counts.map((c) => ({ ...c, km: km(here, c) })).filter((c) => c.km <= 1.6).sort((a, b) => b.aadt - a.aadt)[0];
  const pois = L.pois.map((p) => ({ ...p, km: km(here, p) })).filter((p) => p.km <= 0.85);
  return {
    sid: "address", lat, lon, city, retrieved: new Date().toISOString().slice(0, 10),
    traffic: near ? { aadt: near.aadt, road: near.road, km: Math.round(near.km * 100) / 100, year: near.year, source: city === "houston" ? "TxDOT 5-year statewide AADT counts" : "Caltrans AADT (state highways only)" } : null,
    pois, osmSource: L.pois.length ? "OpenStreetMap via Overpass (cached)" : null, blockGroup: null, demographics: null, workers: workersNear(city, lat, lon),
  };
}

// Metro bounding boxes the cached layers cover (same as pipeline/neighborhood.ts).
const BBOX: Record<string, [number, number, number, number]> = { houston: [29.45, -95.9, 30.15, -94.95], los_angeles: [33.65, -118.75, 34.4, -117.95] };
export function cityAt(lat: number, lon: number): string | null {
  for (const [c, [s, w, n, e]] of Object.entries(BBOX)) if (lat >= s && lat <= n && lon >= w && lon <= e) return c;
  return null;
}

// Heat sources for the foot-traffic proxy map: nearby places (OSM) and where people work (LEHD jobs per census
// block). Weights are relative (0.15–1.2) so a dense job block glows more than a single shop. Not a foot count.
export function heatFor(site: SiteFile, city: string): { heat: NonNullable<SiteFile["heat"]>; heatSources: string[] } {
  const here = { lat: site.lat, lon: site.lon };
  const heat: NonNullable<SiteFile["heat"]> = site.pois.map((p) => ({ lat: p.lat, lon: p.lon, w: 0.8 }));
  const sources = site.pois.length ? ["nearby places (OpenStreetMap)"] : [];
  let blocks = 0;
  for (const [la, lo, jobs] of layer(city).workers) {
    if (!jobs || Math.abs(la - site.lat) > 0.009 || Math.abs(lo - site.lon) > 0.011) continue;
    if (km(here, { lat: la, lon: lo }) > 0.8) continue;
    heat.push({ lat: la, lon: lo, w: Math.min(1.2, Math.max(0.15, Math.log10(1 + jobs) / 3)) });
    blocks++;
  }
  if (blocks) sources.push("where people work (US Census LEHD)");
  // Keep the strongest 400 so the SVG stays light.
  return { heat: heat.sort((a, b) => b.w - a.w).slice(0, 400), heatSources: sources };
}

// Fills gaps in a prefetched site file (or builds one) from the cached city layers, then adds heat sources.
// Shells without a scan, home scans, and quiet blocks used to get no heat at all.
export function enrichSite(site: SiteFile | null, lat?: number, lon?: number, cityHint?: string): SiteFile | null {
  const la = site?.lat ?? lat, lo = site?.lon ?? lon;
  if (la == null || lo == null || !Number.isFinite(la) || !Number.isFinite(lo)) return site;
  const city = (site?.city && BBOX[site.city] ? site.city : null) ?? (cityHint && BBOX[cityHint] ? cityHint : null) ?? cityAt(la, lo);
  if (!city) return site;
  let out: SiteFile;
  if (!site) out = siteAt(la, lo, city);
  else {
    out = { ...site };
    if (!out.pois.length || !out.workers) {
      const base = siteAt(la, lo, city);
      if (!out.pois.length && base.pois.length) { out.pois = base.pois; out.osmSource = base.osmSource; }
      if (!out.workers) out.workers = base.workers;
      if (!out.traffic) out.traffic = base.traffic;
    }
  }
  return { ...out, ...heatFor(out, city) };
}
