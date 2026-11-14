import type { SiteFile, Poi } from "./types";

// Plain-language neighborhood answers. Every sentence comes from a prefetched number; missing data says so.
const WALK5_KM = 0.4, WALK10_KM = 0.8, BLOCK_KM = 0.08;

const COMPETITORS: Record<string, { label: string; match: (t: Record<string, string>) => boolean }> = {
  medical: { label: "clinics and dentists", match: (t) => /dentist|doctors|clinic/.test(t.amenity ?? "") },
  salon: { label: "salons", match: (t) => /hairdresser|beauty/.test(t.shop ?? "") },
  restaurant: { label: "restaurants and cafes", match: (t) => /restaurant|cafe|fast_food/.test(t.amenity ?? "") },
  retail: { label: "shops like yours", match: (t) => /clothes|boutique|gift|cosmetics/.test(t.shop ?? "") },
  fitness: { label: "gyms and studios", match: (t) => /fitness_centre|sports_centre/.test(t.leisure ?? "") },
  office: { label: "other offices", match: (t) => !!t.office },
};
const isTransit = (t: Record<string, string>) => t.highway === "bus_stop" || /station|tram_stop/.test(t.railway ?? "") || t.public_transport === "station" || (t.public_transport === "platform" && t.bus !== "no");
const isRail = (t: Record<string, string>) => /station|tram_stop/.test(t.railway ?? "");
const within = (pois: Poi[], km: number, f: (t: Record<string, string>) => boolean) => pois.filter((p) => (p.km ?? 9) <= km && f(p.tags));
const round = (n: number, to: number) => Math.round(n / to) * to;

export type Answer = { headline: string; lines: string[]; source: string; proxy?: boolean; missing?: string };

export function customers(site: SiteFile | null): Answer {
  if (!site) return { headline: "No neighborhood data for this spot yet.", lines: [], source: "none", missing: "No coordinates or prefetched site data" };
  const lines: string[] = [];
  if (site.traffic) lines.push(`About ${round(site.traffic.aadt, 500).toLocaleString()} cars a day pass the busiest counted road nearby, ${site.traffic.km < 0.2 ? "right by the door" : `about ${(site.traffic.km * 0.62).toFixed(1)} mi away`}.`);
  else lines.push(site.city === "los_angeles" ? "No state-highway traffic count close by (Caltrans only counts state highways)." : "No TxDOT traffic count close by.");
  if (site.workers?.jobs) lines.push(`About ${round(site.workers.jobs, 100).toLocaleString()} people work within a 10-minute walk, so there's a weekday lunch crowd.`);
  const stops = within(site.pois, WALK5_KM, isTransit);
  const rail = stops.filter((s) => isRail(s.tags)).length;
  if (site.osmSource) lines.push(stops.length ? `${stops.length} transit stop${stops.length > 1 ? "s" : ""} within a 5-minute walk${rail ? `, including ${rail} rail` : ""}.` : "No bus or rail stops mapped within a 5-minute walk (OpenStreetMap; some cities map few stops).");
  if (site.busyness?.hours?.length) {
    const h = site.busyness.hours, peak = h.indexOf(Math.max(...h));
    const fmt = (x: number) => `${((x + 11) % 12) + 1}${x < 12 ? "am" : "pm"}`;
    lines.push(`The block is busiest around ${fmt(peak)} to ${fmt((peak + 2) % 24)}.`);
  }
  const score = (site.traffic ? Math.min(3, site.traffic.aadt / 15000) : 0) + Math.min(3, stops.length / 2) + Math.min(2, (site.workers?.jobs ?? 0) / 4000);
  const headline = score >= 3.5 ? "Yes, plenty of people pass by." : score >= 1.5 ? "Some passing traffic. People will mostly come on purpose." : "Quiet spot. Customers will need a reason to come.";
  return { headline, lines, source: [site.traffic?.source, site.workers?.source, site.osmSource, site.busyness?.source].filter(Boolean).join(" · "), proxy: true };
}

export function neighbors(site: SiteFile | null): Answer {
  if (!site) return { headline: "No neighborhood data for this spot yet.", lines: [], source: "none", missing: "No site data" };
  const lines: string[] = [];
  const d = site.demographics;
  if (d?.income) lines.push(`Neighbors earn around $${round(d.income, 1000).toLocaleString()} a year (median household).`);
  if (d?.age2544 != null) lines.push(`${Math.round(d.age2544 * 100)}% of neighbors are 25 to 44.`);
  const offices = within(site.pois, WALK10_KM, (t) => !!t.office).length;
  const food = within(site.pois, WALK10_KM, (t) => /restaurant|cafe|fast_food/.test(t.amenity ?? "")).length;
  if (site.osmSource) {
    if (offices) lines.push(`${offices} offices within half a mile${offices >= 15 ? ", so lots of daytime workers" : ""}.`);
    if (food) lines.push(`${food} places to eat within a 10-minute walk.`);
  }
  const missing = d ? undefined : "Income and age need a Census API key";
  return { headline: d?.income ? `A ${d.income > 90000 ? "well-off" : d.income > 55000 ? "middle-income" : "lower-income"} neighborhood${offices >= 15 ? " with lots of offices" : ""}.` : offices >= 15 ? "A busy work area with lots of offices." : "A mostly local neighborhood.", lines, source: [d?.source, site.osmSource].filter(Boolean).join(" · ") || "none", missing };
}

export function competitors(site: SiteFile | null, use: string): Answer {
  const c = COMPETITORS[use];
  if (!site || !site.osmSource) return { headline: "Competitor data isn't loaded for this spot.", lines: [], source: "none", missing: "OpenStreetMap data unavailable" };
  if (!c) return { headline: "Competition isn't a big factor for this kind of space.", lines: [], source: site.osmSource };
  const all = within(site.pois, WALK10_KM, c.match).sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
  const close = all.filter((p) => (p.km ?? 9) <= 3 * BLOCK_KM).length;
  const lines = all.length
    ? [`${all.length} ${c.label} within a 10-minute walk.`, close ? `${close} within 3 blocks of this spot.` : "None within 3 blocks of this spot.", ...(all[0].name ? [`Closest: ${all[0].name}, about ${Math.max(1, Math.round((all[0].km ?? 0) / BLOCK_KM))} block${(all[0].km ?? 0) / BLOCK_KM >= 1.5 ? "s" : ""} away.`] : [])]
    : [`No ${c.label} within a 10-minute walk.`];
  const headline = all.length === 0 ? "You'd be the only one around." : close ? "Busy with competition right next door." : all.length >= 6 ? "Plenty of competition nearby, but not on your doorstep." : "A little competition, which can mean proven demand.";
  return { headline, lines, source: `${site.osmSource} (counts of mapped places; some businesses aren't mapped)`, proxy: true };
}

export const competitorCount = (site: SiteFile | null, use: string) => (site && COMPETITORS[use] ? within(site.pois, WALK10_KM, COMPETITORS[use].match).length : null);
export const transitCount = (site: SiteFile | null) => (site?.osmSource ? within(site.pois, WALK5_KM, isTransit).length : null);

// Home mode: what a renter or buyer asks instead of "will customers come?".
export function gettingAround(site: SiteFile | null): Answer {
  if (!site) return { headline: "No neighborhood data for this spot yet.", lines: [], source: "none", missing: "No coordinates" };
  const stops = within(site.pois, WALK5_KM, isTransit);
  const lines = [site.osmSource ? (stops.length ? `${stops.length} bus or rail stop${stops.length > 1 ? "s" : ""} within a 5-minute walk.` : "No bus or rail stops mapped within a 5-minute walk, so plan on a car.") : "Transit data isn't loaded here."];
  if (site.traffic) lines.push(site.traffic.km < 0.3 && site.traffic.aadt > 40000 ? `A busy road is close by (about ${round(site.traffic.aadt, 1000).toLocaleString()} cars a day), so expect some traffic noise.` : `The nearest counted major road is about ${(site.traffic.km * 0.62).toFixed(1)} mi away.`);
  return { headline: stops.length >= 3 ? "Easy to get around without a car." : stops.length ? "Some transit nearby; a car helps." : "You'll mostly drive from here.", lines, source: [site.osmSource, site.traffic?.source].filter(Boolean).join(" · ") || "none" };
}

export function errands(site: SiteFile | null): Answer {
  if (!site?.osmSource) return { headline: "Nearby places aren't loaded for this spot.", lines: [], source: "none", missing: "OpenStreetMap data unavailable" };
  const n = (f: (t: Record<string, string>) => boolean) => within(site.pois, WALK10_KM, f).length;
  const groceries = n((t) => /supermarket|convenience/.test(t.shop ?? "")), food = n((t) => /restaurant|cafe|fast_food/.test(t.amenity ?? "")), pharmacy = n((t) => t.amenity === "pharmacy"), schools = n((t) => /school|kindergarten/.test(t.amenity ?? ""));
  const lines = [`${groceries} grocery or corner store${groceries === 1 ? "" : "s"}, ${pharmacy} pharmac${pharmacy === 1 ? "y" : "ies"} and ${food} places to eat within a 10-minute walk.`, ...(schools ? [`${schools} school${schools > 1 ? "s" : ""} nearby.`] : [])];
  return { headline: groceries + food >= 15 ? "Lots of everyday errands on foot." : groceries + food >= 4 ? "A few errands within walking distance." : "Mostly a drive for errands.", lines, source: `${site.osmSource} (mapped places)` };
}
