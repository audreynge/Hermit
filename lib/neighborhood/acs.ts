// Live ACS lookup for one point (used by Check an address): coordinates → block group → income, population, 25–44 share.
const AGE = ["B01001_011E", "B01001_012E", "B01001_013E", "B01001_014E", "B01001_035E", "B01001_036E", "B01001_037E", "B01001_038E"];

export async function demographicsAt(lat: number, lon: number) {
  const key = process.env.CENSUS_API_KEY?.trim().replace(/^"|"$/g, "");
  if (!key) return null;
  try {
    const g = await (await fetch(`https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Census%20Block%20Groups&format=json`, { signal: AbortSignal.timeout(12_000) })).json();
    const bg = g?.result?.geographies?.["Census Block Groups"]?.[0];
    if (!bg) return null;
    const r = await fetch(`https://api.census.gov/data/2023/acs/acs5?get=B19013_001E,B01003_001E,${AGE.join(",")}&for=block%20group:${bg.BLKGRP}&in=state:${bg.STATE}%20county:${bg.COUNTY}%20tract:${bg.TRACT}&key=${key}`, { signal: AbortSignal.timeout(12_000) });
    const [head, row] = (await r.json()) as string[][];
    const v = (k: string) => Number(row[head.indexOf(k)]);
    const pop = v("B01003_001E"), income = v("B19013_001E");
    return { income: income > 0 ? income : undefined, pop: pop > 0 ? pop : undefined, age2544: pop > 0 ? AGE.reduce((s, k) => s + (v(k) || 0), 0) / pop : undefined, source: "US Census ACS 5-year 2023, block group" };
  } catch { return null; }
}
