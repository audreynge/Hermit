import { getCached, putCached } from "./cache";

export type ParcelZone = { zone: string; source: string; apn: string };

const SCAG = "https://maps.scag.ca.gov/scaggis/rest/services/LDX/Zoning_poly_LA/MapServer/0/query";
const inLA = (lat: number, lon: number) => lat > 33.7 && lat < 34.35 && lon > -118.7 && lon < -118.15;

export function parseZoningResponse(json: unknown): { zone: string; apn: string } | null {
  const f = (json as { features?: { attributes?: { ZN24_CITY?: string; APN24?: string } }[] })?.features?.[0]?.attributes;
  return f?.ZN24_CITY ? { zone: f.ZN24_CITY, apn: f.APN24 ?? "" } : null;
}

export async function lookupZoning(lat: number, lon: number, fetchFn: typeof fetch = fetch): Promise<ParcelZone | null> {
  if (!inLA(lat, lon)) return null;
  const key = `zoning:${lat.toFixed(5)},${lon.toFixed(5)}`;
  const hit = getCached<ParcelZone | { none: true }>(key);
  if (hit) return "none" in hit ? null : hit;
  const q = new URLSearchParams({
    geometry: `${lon.toFixed(5)},${lat.toFixed(5)}`, geometryType: "esriGeometryPoint", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", outFields: "APN24,ZN24_CITY", returnGeometry: "false", f: "json",
  });
  try {
    const res = await fetchFn(`${SCAG}?${q}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray((json as { features?: unknown }).features)) return null;
    const parsed = parseZoningResponse(json);
    const out = parsed ? { ...parsed, source: `scag Zoning_poly_LA (ZN24_CITY, APN ${parsed.apn})` } : null;
    putCached(key, out ?? { none: true }, 30);
    return out;
  } catch {
    return null;
  }
}

export { normalizeZone, zoningAgreement } from "./zones";
