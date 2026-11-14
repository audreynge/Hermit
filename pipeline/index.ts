// Builds data/processed/shells.json from models_index.csv alone: one light row per scan (all 14,944),
// so the funnel counter starts at the true inventory. CoStar record fields stay null (unknown) unless the kit ETL runs.
// Run: npx tsx pipeline/index.ts [path/to/models_index.csv]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { City, Mode, ScanKind, Shell } from "../lib/types";
import { parseSuiteSqft } from "./transform";

const INDEX = process.argv[2] ?? process.env.MODELS_INDEX ?? path.join(os.homedir(), "Downloads", "models_index.csv");
const OUT = path.join(process.cwd(), "data", "processed");

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const AMENITY = /laundry|cycle room|game ?room|cafe|conference room|entrance|study|media room|lobby|lounge|pool|fitness|gym|club ?house|amenit|leasing|mail|courtyard|roof ?top|rooftop|business center|clubroom|sky ?deck|game room|theater|spa\b(?!.*salon)|dog|pet|bark|grill|cabana|co-?work|conference center|garage|parking|resident|community|yoga|bike|package|kids|playroom|terrace|wellness/i;
const UNIT = /\b\d\s*(?:br|bd|bed)|\bstudio\b|\bbr\b|\bba\b|\bbed|\bbath|\bunit\b|\bapt\b|\bplan\b|model\b|townhome|loft\b|penthouse|bachelor|\d\s*x\s*\d|\b[a-z]\d\b|^\s*#?\d{1,4}[a-z]?\s*$/i;

export function classify(name: string, segment: string): ScanKind {
  const n = name.toLowerCase();
  if (segment === "residential") return "home";
  const unitish = UNIT.test(n);
  if (/medical|\bdental|clinic|physician|doctor/.test(n) && !unitish) return "medical";
  if (/salon|barber|beauty/.test(n)) return "salon";
  if (/warehouse|industrial|showroom|distribution|flex space/.test(n)) return "warehouse";
  if (/retail|storefront|restaurant|\bshop\b/.test(n) && !unitish && !/lounge|lobby/.test(n)) return "retail";
  if (/\boffice|\bsuite\b|\bste\.?\s|executive offices?/.test(n) && !unitish && !/leasing office|studio suite|lounge|clubhouse|business center/.test(n))
    return /suite|ste\.?\s/.test(n) ? "suite" : "office";
  if (AMENITY.test(n)) return "amenity";
  if (UNIT.test(n)) return "unit";
  return "other";
}

const KIND_MODE: Record<ScanKind, Mode | null> = {
  unit: "home", home: "home", amenity: null, suite: "business", office: "business", medical: "business",
  salon: "business", retail: "business", warehouse: "enterprise", other: null,
};
const KIND_TAGS: Record<ScanKind, string[]> = {
  unit: ["home", "apartment"], home: ["home"], amenity: [], suite: ["office"], office: ["office"], medical: ["medical", "office"],
  salon: ["salon"], retail: ["retail"], warehouse: ["warehouse"], other: [],
};

function cityOf(r: Record<string, string>): City | null {
  if (r.lon) return Number(r.lon) > -105 ? "houston" : "los_angeles";
  if (/^(tx|texas|harris)/i.test(r.state)) return "houston";
  if (/^(ca|california|angeles|los)/i.test(r.state)) return "los_angeles";
  return null;
}

export function shellFromIndex(r: Record<string, string>): Shell {
  const kind = classify(r.name, r.segment);
  const city = cityOf(r);
  const beds = r.name.match(/(\d)\s*(?:br|bd|bed)/i)?.[1];
  const baths = r.name.match(/(\d(?:\.5)?)\s*(?:ba|bath)/i)?.[1];
  const sqft = parseSuiteSqft(r.name) ?? (Number(r.name.match(/([\d,]{3,6})\s*SF\b/i)?.[1]?.replace(/,/g, "")) || undefined);
  const looksAddress = /^\d+\s+\S+/.test(r.address);
  return {
    id: r.sid,
    sid: r.sid,
    kind,
    mode: (KIND_MODE[kind] ?? "business") as Mode,
    city: (city ?? "unknown") as City,
    name: r.name.replace(/^[“"]|[”"]$/g, "").trim() || r.sid,
    address: looksAddress ? [r.address, r.city, r.state].filter(Boolean).join(", ") : [r.city, r.state].filter(Boolean).join(", "),
    lat: r.lat ? Number(r.lat) : undefined,
    lon: r.lon ? Number(r.lon) : undefined,
    propertyId: r.costar_property_id ? Number(r.costar_property_id) : undefined,
    homesListingId: r.homes_listing_id ? Number(r.homes_listing_id) : undefined,
    propertyType: kind === "home" || kind === "unit" ? "Residential" : "Unknown",
    subtype: "Unknown",
    useTags: KIND_TAGS[kind],
    sqft,
    sqftSource: sqft ? "scan name" : undefined,
    sprinkler: "unknown",
    heavyPower: null,
    driveInBays: null,
    loadingDocks: null,
    parkingSpaces: null,
    zoning: null,
    elevator: null,
    beds: beds ? Number(beds) : /studio/i.test(r.name) && kind === "unit" ? 0 : undefined,
    baths: baths ? Number(baths) : undefined,
    roomCount: Number(r.room_count) || undefined,
    panoCount: Number(r.pano_count) || undefined,
    floorCount: Number(r.floor_count) || undefined,
    defurnished: r.defurnished === "yes",
    splat: r.splat === "yes",
  };
}

// Matterport's own vision classification of the space, mapped onto Hermit use tags.
const SCAN_CLASS_TAGS: Record<string, string[]> = {
  healthcare: ["medical"], workspace: ["office"], factory_industrial: ["warehouse", "manufacturing"], food_drink: ["restaurant"],
  retail: ["retail"], fitness_sports: ["fitness"], education: ["education"], living_space: ["home"],
};

function main() {
  const rows = parseCsv(fs.readFileSync(INDEX, "utf8"));
  const shells = rows.filter((r) => r.sid).map(shellFromIndex);
  const graphs = path.join(OUT, "roomgraphs");
  for (const s of shells) {
    const f = path.join(graphs, `${s.sid}.json`);
    if (!fs.existsSync(f)) continue;
    const g = JSON.parse(fs.readFileSync(f, "utf8"));
    s.scanClass = g.classification;
    if (g.totalAreaSqft > 30) s.measuredSqft = Math.round(g.totalAreaSqft);
    if (s.kind !== "home" && s.kind !== "unit") s.useTags = [...new Set([...s.useTags, ...(SCAN_CLASS_TAGS[g.classification] ?? [])])];
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "shells.json"), JSON.stringify(shells));
  const by = (k: (s: Shell) => string) => shells.reduce<Record<string, number>>((a, s) => ((a[k(s)] = (a[k(s)] ?? 0) + 1), a), {});
  console.log(`wrote ${shells.length} shells`);
  console.log("kind", by((s) => s.kind!));
  console.log("city", by((s) => s.city));
  console.log("business by city", by((s) => (s.mode !== "home" && s.kind !== "amenity" && s.kind !== "other" ? `${s.kind}/${s.city}` : "-")));
}

if (process.argv[1]?.endsWith("index.ts")) main();
