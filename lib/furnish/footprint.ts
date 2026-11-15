// One furniture list for both views. The 3D tour's Placed items are canonical (world meters, y up); the 2D floor
// plan draws their footprints. Plan (x, y) == world (x, -z), the same mapping lib/furnish/ops.ts uses.
import { pointInPolygon, type Pt } from "../geometry/polygon";
import { FURNITURE } from "../spec/furnish";
import type { Placed as Placement } from "../spec/place";
import { normName, typicalSize } from "./catalog";
import { dims, quarter, type Placed } from "./ops";

/** What the 2D plan draws: the item's axis-aligned footprint, min corner + size in plan meters. */
export type Footprint = { id: string; roomId: string; type: string; x: number; y: number; w: number; h: number };

const TYPES = FURNITURE.map((f) => f.type).sort((a, b) => b.length - a.length);
/** The 2D glyph for an item name ("walnut dining table" → "table"); unknown names are drawn as labeled boxes. */
export const glyphFor = (name: string) => { const n = normName(name); return TYPES.find((t) => n.includes(t)) ?? n; };

export function roomOf(p: Placed, rooms: { id: string; polygon: Pt[] }[]): string {
  const at = { x: p.pos.x, y: -p.pos.z };
  return rooms.find((r) => r.polygon.length >= 3 && pointInPolygon(at, r.polygon))?.id ?? "";
}

export function toFootprint(p: Placed, rooms: { id: string; polygon: Pt[] }[] = []): Footprint {
  const s = dims(p);
  const quarter = Math.round((((p.rotY % 180) + 180) % 180) / 90) === 1; // turned ~90°: width runs along plan y
  const w = quarter ? s.d : s.w, h = quarter ? s.w : s.d;
  return { id: p.id, roomId: roomOf(p, rooms), type: glyphFor(p.name), x: p.pos.x - w / 2, y: -p.pos.z - h / 2, w, h };
}

const nextNum = (items: { id: string }[]) => items.reduce((m, p) => Math.max(m, Number(p.id.slice(1)) || 0), 0) + 1;

/** A piece the 2D placer fit inside a room, as a 3D item. The tour finds its model and sets it on the floor. */
export function fromPlacement(f: Placement, existing: { id: string }[], floorY = 0): Placed {
  const { size, known } = typicalSize(f.type);
  return {
    id: `f${nextNum(existing)}`, name: f.type, terms: [f.type], size: { w: f.w, d: f.h, h: size.h }, approxSize: !known,
    pos: { x: f.x + f.w / 2, y: floorY, z: -(f.y + f.h / 2) }, rotY: 0,
  };
}

/** Saved furniture from before the views were merged was 2D placements; anything without `pos` is converted. Saves
 *  from before items could be tipped get pitch and roll 0; odd angles snap to the nearest quarter turn. */
export function migrate(raw: unknown): Placed[] {
  if (!Array.isArray(raw)) return [];
  const out: Placed[] = [];
  for (const x of raw) {
    if (x && typeof x === "object" && "pos" in x) {
      const p = x as Placed;
      out.push({ ...p, rotY: Number.isFinite(p.rotY) ? p.rotY : 0, pitch: quarter(Number(p.pitch) || 0), roll: quarter(Number(p.roll) || 0) });
    }
    else if (x && typeof x === "object" && "type" in x && "x" in x) out.push(fromPlacement(x as Placement, out));
  }
  return out;
}
