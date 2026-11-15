export type Poi = { lat: number; lon: number; tags: Record<string, string>; name?: string; km?: number };

// One prefetched neighborhood file per site (data/processed/site/<sid>.json). Nulls mean "not available", never zero.
export type SiteFile = {
  sid: string; lat: number; lon: number; city: string; retrieved: string;
  traffic: { aadt: number; road: string; km: number; year?: number; source: string } | null;
  pois: Poi[];
  osmSource: string | null;
  blockGroup: string | null;
  demographics: { income?: number; pop?: number; age2544?: number; source: string } | null;
  busyness?: { hours: number[]; source: string } | null; // 24 values, 0–100, BestTime venue average (proxy)
  workers?: { jobs: number; retailFood: number; source: string } | null; // people whose job is within a 10-minute walk
  heat?: { lat: number; lon: number; w: number }[]; // foot-traffic proxy sources, built at request time (lib/neighborhood/build.ts)
  heatSources?: string[]; // what fed the heat, for the legend
};
