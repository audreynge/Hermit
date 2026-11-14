// Street address → coordinates. Census first (authoritative, free), then Esri's World Geocoder (free for one-off
// lookups, good with highway addresses Census misses), then Google if GOOGLE_MAPS_API_KEY is set.
export type Geo = { lat: number; lon: number; label: string; source: string; approximate: boolean };

const get = async (url: string) => { const r = await fetch(url, { signal: AbortSignal.timeout(12_000) }); return r.ok ? r.json() : null; };

export async function geocode(address: string): Promise<Geo | null> {
  try {
    const c = await get(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`);
    const m = c?.result?.addressMatches?.[0];
    if (m) return { lat: m.coordinates.y, lon: m.coordinates.x, label: m.matchedAddress, source: "US Census geocoder", approximate: false };
  } catch { /* next provider */ }
  try {
    const a = await get(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(address)}&maxLocations=1&outFields=Score,Addr_type&f=json`);
    const m = a?.candidates?.[0];
    if (m && m.score >= 85) return { lat: m.location.y, lon: m.location.x, label: m.address, source: "Esri World Geocoder", approximate: !/PointAddress|Subaddress/.test(m.attributes?.Addr_type ?? "") };
  } catch { /* next provider */ }
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (key) {
    try {
      const g = await get(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
      const m = g?.results?.[0];
      if (m) return { lat: m.geometry.location.lat, lon: m.geometry.location.lng, label: m.formatted_address, source: "Google Geocoding", approximate: m.geometry.location_type !== "ROOFTOP" };
    } catch { /* give up */ }
  }
  return null;
}
