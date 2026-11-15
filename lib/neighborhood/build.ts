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
