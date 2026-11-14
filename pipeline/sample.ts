// Writes the synthetic public bundle in data/sample (no CoStar/Matterport data) plus a recorded demo run.
// Run: npx tsx pipeline/sample.ts
import fs from "node:fs";
import path from "node:path";
import { runAgent } from "../lib/agent/loop";
import { saveRun } from "../lib/agent/replay";
import { loadRoomGraph, loadShells } from "../lib/query/load";
import { parseText } from "../lib/spec/parse";
import type { Room, RoomGraph, Shell, TraceEvent } from "../lib/types";

const OUT = path.join(process.cwd(), "data", "sample");
const M2 = 10.7639;

function rect(id: string, label: string, x: number, y: number, w: number, h: number): Room {
  return { id, label, rawTags: [label], areaSqft: w * h * M2, polygon: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], floorId: "f1" };
}

function graph(sid: string, name: string, rooms: Room[], objects: RoomGraph["objects"] = []): RoomGraph {
  const edges: RoomGraph["edges"] = rooms.slice(1).map((r, i) => ({ a: rooms[i].id, b: r.id, kind: "door" }));
  return { sid, name, totalAreaSqft: rooms.reduce((s, r) => s + r.areaSqft, 0), rooms, edges, objects, panoCount: 20, floorCount: 1 };
}

const base = (o: Partial<Shell> & Pick<Shell, "id" | "name" | "mode" | "city">): Shell => ({
  address: `${o.id.length * 100} Sample Ave, ${o.city === "houston" ? "Houston, TX" : "Los Angeles, CA"}`,
  propertyType: "Office", subtype: "Office_Medical", useTags: ["medical"], sprinkler: "wet", heavyPower: null, driveInBays: null,
  loadingDocks: null, parkingSpaces: 30, zoning: null, elevator: true, constructionStatus: "Existing", stories: 4, ...o,
});

const shells: Shell[] = [
  base({ id: "SAMPLEMED1", sid: "SAMPLEMED1", name: "Sample Medical Suite 210", mode: "business", city: "houston", lat: 29.7366, lon: -95.4613, sqft: 2400, sqftSource: "listing space", buildingClass: "A", listing: { listingId: 1, status: "active", askingRate: 28, availableSqft: 2400, contact: { name: "Sam Sample", company: "Sample Realty" } } }),
  base({ id: "SAMPLEMED2", sid: "SAMPLEMED2", name: "Sample Office Suite 400", mode: "business", city: "houston", lat: 29.749, lon: -95.47, sqft: 2600, sqftSource: "scan name", useTags: ["office"], subtype: "Unknown", listing: { listingId: 2, status: "active" } }),
  base({ id: "SAMPLEMED3", sid: "SAMPLEMED3", name: "Sample Clinic Shell 105", mode: "business", city: "houston", lat: 29.72, lon: -95.4, sqft: 2200, buildingClass: "A", listing: { listingId: 3, status: "active" } }),
  base({ id: "SAMPLEOFF4", name: "Sample Creative Loft", mode: "business", city: "los_angeles", lat: 34.05, lon: -118.25, sqft: 3000, sqftSource: "building record", zoning: "LAC2", useTags: ["office"], subtype: "Office_LoftOrCreativeSpace" }),
  base({ id: "SAMPLEWH1", sid: "SAMPLEWH1", name: "Sample Distribution Center", mode: "enterprise", city: "los_angeles", lat: 33.99, lon: -118.23, sqft: 22000, sqftSource: "building record", propertyType: "Industrial", subtype: "Industrial_Warehouse", useTags: ["warehouse"], heavyPower: true, driveInBays: 3, loadingDocks: 4, sprinkler: "esfr", zoning: "LAM2-1", stories: 1, listing: { listingId: 4, status: "active" } }),
  base({ id: "SAMPLEWH2", name: "Sample Flex Building", mode: "enterprise", city: "los_angeles", lat: 33.98, lon: -118.22, sqft: 19000, sqftSource: "building record", propertyType: "Industrial", subtype: "Industrial_Warehouse", useTags: ["warehouse"], heavyPower: false, driveInBays: 1, sprinkler: "wet", zoning: "LAM1", stories: 1 }),
  base({ id: "SAMPLEHOME1", sid: "SAMPLEHOME1", name: "101 Sample Lane", mode: "home", city: "houston", lat: 29.8, lon: -95.3, sqft: 1800, sqftSource: "listing", propertyType: "Residential", subtype: "Residential, Detached", useTags: ["home"], beds: 3, baths: 2, parkingSpaces: 2, homesListingId: 9001, listing: { listingId: 9001, status: "active", price: 399000 } }),
  base({ id: "SAMPLEHOME2", sid: "SAMPLEHOME2", name: "202 Sample Court", mode: "home", city: "houston", lat: 29.81, lon: -95.31, sqft: 2100, sqftSource: "listing", propertyType: "Residential", subtype: "Residential, Detached", useTags: ["home"], beds: 4, baths: 2.5, parkingSpaces: 2, homesListingId: 9002, listing: { listingId: 9002, status: "active", price: 445000 } }),
];

const graphs: RoomGraph[] = [
  graph("SAMPLEMED1", "Sample Medical Suite 210", [
    rect("w", "reception", 0, 0, 8, 6), rect("e1", "office", 8, 0, 3.5, 3.5), rect("e2", "office", 11.5, 0, 3.5, 3.5), rect("e3", "office", 15, 0, 3.5, 3.5),
    rect("b1", "bathroom", 8, 3.5, 2.5, 2.5), rect("b2", "bathroom", 10.5, 3.5, 2.5, 2.5), rect("o", "other", 13, 3.5, 5.5, 8),
  ], [{ label: "sink", roomId: "e1", confidence: 0.9 }, { label: "sink", roomId: "e2", confidence: 0.85 }]),
  graph("SAMPLEMED2", "Sample Office Suite 400", [rect("a", "office", 0, 0, 6, 5), rect("b", "office", 6, 0, 6, 5), rect("c", "other", 0, 5, 12, 12)]),
  graph("SAMPLEMED3", "Sample Clinic Shell 105", [rect("a", "office", 0, 0, 10, 10), rect("b", "office", 10, 0, 10, 10)]),
  graph("SAMPLEWH1", "Sample Distribution Center", [rect("wh", "open", 0, 0, 60, 33), rect("of", "office", 60, 0, 8, 8)]),
  graph("SAMPLEHOME1", "101 Sample Lane", [rect("l", "living", 0, 0, 6, 5), rect("k", "kitchen", 6, 0, 4, 4), rect("b1", "bedroom", 0, 5, 4, 4), rect("b2", "bedroom", 4, 5, 4, 4), rect("b3", "office", 8, 5, 3, 3.5), rect("ba", "bathroom", 10, 0, 2.5, 3)]),
  graph("SAMPLEHOME2", "202 Sample Court", [rect("l", "living", 0, 0, 7, 6), rect("k", "kitchen", 7, 0, 4, 4), rect("b1", "bedroom", 0, 6, 4, 4), rect("b2", "bedroom", 4, 6, 4, 4), rect("b3", "bedroom", 8, 6, 4, 4), rect("b4", "bedroom", 12, 6, 4, 4)]),
];

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "roomgraphs"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "shells.json"), JSON.stringify(shells, null, 1));
  for (const g of graphs) fs.writeFileSync(path.join(OUT, "roomgraphs", `${g.sid}.json`), JSON.stringify(g));

  process.env.HERMIT_DATA_DIR = OUT;
  const spec = parseText("Dental clinic in Houston, 2,000-3,000 sq ft, 3 exam rooms with sinks, a waiting room, 2 restrooms, wheelchair accessible");
  const events: TraceEvent[] = [{ type: "run", id: "run", runId: "demo", replay: false }];
  await runAgent(spec, (e) => events.push(e), { shells: loadShells, graph: loadRoomGraph }, { client: null });
  saveRun("demo", spec, events);
  fs.mkdirSync(path.join(OUT, "replay"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "replay", "demo.json"), JSON.stringify({ id: "demo", createdAt: new Date().toISOString(), spec, events }));
  console.log(`wrote ${shells.length} sample shells, ${graphs.length} room graphs, demo replay`);
}

main();
