// Lays a whole room out from a furnishing plan: wall pieces run along the walls (longest first) facing in, the rest
// sit in rows around the middle, every footprint inside the room and clear of the others. Pure, so it's testable.
import { centroid, nearestOnBoundary, pointInPolygon, type Pt } from "../geometry/polygon";
import { clampSize, normName, type Size } from "./catalog";
import { corners, nextId, toWorld, underCeiling, yawFacing, type Placed, type RoomRef } from "./ops";

export type PlanItem = { name: string; terms: string[]; size: Size; count: number; at: "wall" | "center" };

const WALL_GAP = 0.2, AISLE = 0.7, WALL_CLEAR = 0.6, STEP = 0.25, WALKWAY = 0.9;

type Box = { minX: number; maxX: number; minY: number; maxY: number };
const box = (pts: Pt[], pad: number): Box => ({
  minX: Math.min(...pts.map((p) => p.x)) - pad, maxX: Math.max(...pts.map((p) => p.x)) + pad,
  minY: Math.min(...pts.map((p) => p.y)) - pad, maxY: Math.max(...pts.map((p) => p.y)) + pad,
});
const hits = (a: Box, b: Box) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

export type Door = { at: Pt; widthM: number };
const DOOR_CLEAR = 0.6; // swing and walking room in front of a door

export function layoutRoom(room: RoomRef, plan: PlanItem[], existing: Placed[], floorY: number, doors: Door[] = []): { placed: Placed[]; skipped: string[] } {
  const poly = room.polygon;
  const all = [...existing];
  const placed: Placed[] = [], skipped: string[] = [];
  if (poly.length < 3) return { placed, skipped: plan.map((p) => p.name) };
  const c = centroid(poly);
  // Edges with their inward normal, longest first; each keeps a cursor of how much wall is used.
  const edges = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let n = { x: -dir.y, y: dir.x };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((c.x - mid.x) * n.x + (c.y - mid.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    return { a, dir, n, len, cursor: WALL_GAP };
  }).filter((e) => e.len > 0.8).sort((x, y) => y.len - x.len);
  const facing = (n: Pt) => yawFacing(n.x, -n.y); // plan normal (x, y) is world (x, -y)
  const grid = edges[0] ? facing(edges[0].n) : 0;

  const fits = (pos: Pt, size: Size, rotY: number, clear: number, wallClear: number) => {
    const cs = corners(toWorld(pos, floorY), size, rotY);
    if (!cs.every((p) => pointInPolygon(p, poly) && nearestOnBoundary(p, poly).dist >= wallClear)) return false;
    const mine = box(cs, clear), bare = box(cs, 0);
    if (doors.some((dr) => Math.hypot(Math.max(bare.minX - dr.at.x, 0, dr.at.x - bare.maxX), Math.max(bare.minY - dr.at.y, 0, dr.at.y - bare.maxY)) < dr.widthM / 2 + DOOR_CLEAR)) return false;
    return all.every((o) => !hits(mine, box(corners(o.pos, o.fitted ?? o.size, o.rotY), 0)));
  };
  const add = (it: PlanItem, pos: Pt, rotY: number, size: Size) => {
    const p: Placed = { id: nextId(all), name: normName(it.name), terms: it.terms.length ? it.terms : [it.name], size, approxSize: false, pos: toWorld(pos, floorY), rotY };
    all.push(p); placed.push(p);
  };

  const copies = plan.flatMap((it) => Array.from({ length: Math.max(1, Math.min(it.count, 40)) }, () => it));
  // Biggest pieces first so they get the long walls and the middle.
  copies.sort((x, y) => y.size.w * y.size.d - x.size.w * x.size.d);
  for (const it of copies) {
    const size = underCeiling(clampSize(it.size), room.ceiling);
    let done = false;
    if (it.at === "wall") {
      for (const e of edges) {
        while (!done && e.cursor + size.w + WALL_GAP <= e.len) {
          const t = e.cursor + size.w / 2, off = size.d / 2 + 0.05;
          const pos = { x: e.a.x + e.dir.x * t + e.n.x * off, y: e.a.y + e.dir.y * t + e.n.y * off };
          // Leave a walkway in front: a piece along a narrow corridor wall would block it.
          const front = { x: pos.x + e.n.x * (size.d / 2 + WALKWAY), y: pos.y + e.n.y * (size.d / 2 + WALKWAY) };
          const open = pointInPolygon(front, poly) && nearestOnBoundary(front, poly).dist >= WALKWAY / 2;
          if (open && fits(pos, size, facing(e.n), 0.05, 0.02)) { add(it, pos, facing(e.n), size); e.cursor += size.w + WALL_GAP; done = true; }
          else e.cursor += STEP;
        }
        if (done) break;
      }
    }
    if (!done) {
      // Rows aligned with the longest wall, nearest the middle first, leaving walking room around each piece.
      const a = (grid * Math.PI) / 180, ux = { x: Math.cos(a), y: Math.sin(a) }, uy = { x: -ux.y, y: ux.x };
      const sx = size.w + AISLE, sy = size.d + AISLE, spots: Pt[] = [];
      for (let i = -12; i <= 12; i++) for (let k = -12; k <= 12; k++) spots.push({ x: c.x + ux.x * i * sx + uy.x * k * sy, y: c.y + ux.y * i * sx + uy.y * k * sy });
      spots.sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y));
      const spot = spots.find((p) => fits(p, size, grid, AISLE / 2, WALL_CLEAR));
      if (spot) { add(it, spot, grid, size); done = true; }
    }
    if (!done) skipped.push(it.name);
  }
  return { placed, skipped };
}
