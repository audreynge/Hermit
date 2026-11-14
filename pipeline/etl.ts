// Builds data/processed/shells.json from the private CoStar kit + models_index.csv.
// KIT_DIR and MODELS_INDEX env vars override the default Downloads paths.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { shellFromCommercial, shellFromResidential } from "./transform";
import type { Shell } from "../lib/types";

const KIT = process.env.KIT_DIR ?? path.join(os.homedir(), "Downloads", "costar-hackathon-kit (1)");
const INDEX = process.env.MODELS_INDEX ?? path.join(os.homedir(), "Downloads", "models_index.csv");
const OUT = path.join(process.cwd(), "data", "processed");
const AMENITY = /fitness|gym|lobby|pool|club ?house|amenit|leasing|lounge|mail|roof|courtyard|parking|garage|model unit|\bunit\b|\d\s*br\b|studio,|bed|bath/i;

async function* jsonl(file: string) {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(KIT, "data", file)), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

function csv(file: string): Record<string, string>[] {
  const [head, ...rows] = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  const enums = JSON.parse(fs.readFileSync(path.join(KIT, "schemas", "enums.json"), "utf8"));
  const index = new Map(csv(INDEX).map((r) => [r.sid, r]));
  const scansByProperty = new Map<string, string[]>();
  for (const r of csv(path.join(KIT, "commercial-properties.csv")))
    if (r.MatterportModelId) scansByProperty.set(r.PropertyId, [...(scansByProperty.get(r.PropertyId) ?? []), r.MatterportModelId]);

  const listings = new Map<number, unknown[]>();
  for await (const l of jsonl("commercial-listing-summary.jsonl")) listings.set(l.propertyId, [...(listings.get(l.propertyId) ?? []), l]);

  const comps = new Map<number, unknown[]>();
  for await (const c of jsonl("commercial-sale-comp.jsonl"))
    for (const id of new Set<number>((c.entities ?? []).map((e: { propertyId: number }) => e.propertyId))) comps.set(id, [...(comps.get(id) ?? []), c]);

  const shells: Shell[] = [];
  for await (const p of jsonl("commercial-property.jsonl")) {
    const type = enums.PropertyType[p.propertyType];
    if (["Multifamily", "Hospitality"].includes(type)) continue;
    const ls = (listings.get(p.id) ?? []) as never[];
    const cs = (comps.get(p.id) ?? []) as never[];
    const scans = (scansByProperty.get(String(p.id)) ?? [])
      .map((sid) => index.get(sid) ?? { sid, name: sid })
      .filter((s) => !AMENITY.test(s.name));
    if (scans.length && type !== "Industrial" && type !== "Flex") for (const s of scans) shells.push(shellFromCommercial(p, s, ls, enums, cs));
    else {
      const best = [...scans].sort((a, b) => Number(b.room_count ?? 0) - Number(a.room_count ?? 0))[0];
      shells.push(shellFromCommercial(p, best, ls, enums, cs));
    }
  }

  for await (const r of jsonl("residential-listings.jsonl")) {
    if (!r.isPrimaryForThisListingInstance) continue;
    const s = shellFromResidential(r);
    if (!s.sid) continue;
    const idx = index.get(s.sid);
    if (idx) { s.roomCount = Number(idx.room_count) || undefined; s.panoCount = Number(idx.pano_count) || undefined; }
    shells.push(s);
  }

  const unique = [...new Map(shells.map((s) => [s.id, s])).values()];
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "shells.json"), JSON.stringify(unique));
  const by = (k: (s: Shell) => string) => unique.reduce<Record<string, number>>((a, s) => ((a[k(s)] = (a[k(s)] ?? 0) + 1), a), {});
  console.log(`wrote ${unique.length} shells`, by((s) => s.mode), by((s) => (s.sid ? "scan" : "record-only")), by((s) => s.city));
  console.log("parcel fields", unique.flatMap((s) => Object.keys(s.parcel ?? {})).reduce<Record<string, number>>((a, k) => ((a[k] = (a[k] ?? 0) + 1), a), {}));
}

main();
