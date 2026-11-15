import { useEffect, useState } from "react";

type Pt = { lat: number; lon: number };

// Record coordinates first; the address geocoder is the second check when they're missing or the map tiles fail.
export function useCoords(address: string, lat?: number, lon?: number, tiles = 9) {
  const has = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat!) <= 90 && Math.abs(lon!) <= 180;
  const [fails, setFails] = useState(0);
  const [force, setForce] = useState(false);
  const [geo, setGeo] = useState<Pt | null | undefined>(undefined);
  const need = !has || force;
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (!need || geo !== undefined) return;
    let live = true;
    fetch(`/api/geocode?q=${encodeURIComponent(address)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((g) => live && setGeo(g && Number.isFinite(g.lat) ? { lat: g.lat, lon: g.lon } : null))
      .catch(() => live && setGeo(null));
    return () => { live = false; };
  }, [need, geo, address]);
  // Counts tile errors per source; switching to the address point resets the count so the second source gets its own verdict.
  const fail = () => {
    const n = fails + 1;
    setFails(n);
    if (n <= tiles / 2) return;
    if (!need) { setForce(true); setFails(0); } else setLost(true);
  };
  const pt: Pt | null | undefined = need ? geo : { lat: lat!, lon: lon! };
  return { pt, byAddress: need && !!geo, fail, dead: lost && need };
}

// Typical weekday shape when the site has no busyness data.
export const DEFAULT_HOURS = Array.from({ length: 24 }, (_, h) => Math.round(Math.max(5, 100 * Math.exp(-((h - 12.5) ** 2) / 30) * 0.7 + 60 * Math.exp(-((h - 18) ** 2) / 8) * 0.4)));
