// Furnishing ops: Gemini (or the offline parser) picks them, this code applies them. Positions are world meters
// in the Matterport scene (y up). RoomGraph polygons are the floor plane with plan (x, y) == world (x, -z).
import { z } from "zod";
import { parseOps, type Rejected } from "../design/layout-ops";
import { centroid, nearestOnBoundary, pointInPolygon, type Pt } from "../geometry/polygon";
import { clampSize, ftIn, normName, toHex, toMaterial, typicalSize, type MaterialName, type Size } from "./catalog";
import type { Bounds } from "./glb";

export type Vec = { x: number; y: number; z: number };
export type Model = { id: string; source?: "polypizza" | "sketchfab"; url: string; title: string; thumb: string; licence: string; attribution: string; bounds?: Bounds };
export type Placed = {
  id: string; name: string; terms: string[]; size: Size; approxSize: boolean;
  model?: Model | null; // undefined: not looked up yet; null: no matching model, drawn as a labeled box
  pos: Vec; rotY: number; // degrees about the vertical axis
  color?: string; material?: MaterialName;
  fitted?: Size; // size as rendered (the model's real proportions at the target height); used for picking and walls
  planned?: true; // laid out by the room planner: its model never outgrows the planned footprint
};
type RoomRef = { id: string; label: string; polygon: Pt[]; ceiling?: number }; // ceiling height in meters
/** What the user sees: the rendered size once the model is fitted, else the target size. */
export const dims = (p: Placed): Size => p.fitted ?? p.size;
/** Where the user is and what they point at, read from the SDK when the ops are applied. */
export type View = {
  camera: Vec; forward: { x: number; z: number }; floorY: number;
  point?: Vec; // last clicked or pointed floor point
  ahead?: Vec; // floor point in the middle of what the user can see; "front" uses it when given
  room?: RoomRef; // the room the camera is in
  rooms?: RoomRef[]; // every room on this floor: items are kept inside whichever one they're in
  selected?: string;
};

const ANCHORS = ["point", "front", "center", "wall"] as const;
export type Anchor = (typeof ANCHORS)[number];
const Name = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 '&/-]*$/, "use a plain item name");
const Id = z.string().regex(/^f\d{1,4}$/, "bad item id");
const Paint = z.string().trim().max(30);
export const FurnishOp = z.discriminatedUnion("op", [
  // pos/rotY: an exact spot from the layout planner (world x/z); it skips the anchor and the free-spot search.
  z.object({ op: z.literal("add"), name: Name, terms: z.array(Name).max(4).optional(), size: z.object({ w: z.number(), d: z.number(), h: z.number() }).optional(), count: z.number().int().min(1).max(6).optional(), at: z.enum(ANCHORS).optional(), color: Paint.optional(), material: Paint.optional(),
    pos: z.object({ x: z.number().finite(), z: z.number().finite() }).optional(), rotY: z.number().finite().optional() }),
  // Whole-room furnishing: the browser sends this to the layout planner (/api/furniture/plan) instead of applying it.
  z.object({ op: z.literal("furnish"), scope: z.enum(["room", "all"]), room: Name.optional() }),
  // "room" = items whose center is in the camera's room; "all" = every placed item.
  z.object({ op: z.literal("clear"), scope: z.enum(["room", "all"]) }),
  // The browser restores its last snapshot instead of applying this.
  z.object({ op: z.literal("undo") }),
  z.object({ op: z.literal("move"), id: Id, at: z.enum(ANCHORS) }),
  z.object({ op: z.literal("rotate"), id: Id, degrees: z.number().min(-360).max(360) }),
  z.object({ op: z.literal("remove"), id: Id }),
  z.object({ op: z.literal("recolor"), id: Id, color: Paint.optional(), material: Paint.optional() }).refine((o) => o.color || o.material, "give a color or a material"),
  z.object({ op: z.literal("swap"), id: Id, name: Name, terms: z.array(Name).max(4).optional() }),
  // Proportional: one dimension (meters) or a factor sets the scale for all three.
  z.object({ op: z.literal("resize"), id: Id, w: z.number().positive().optional(), d: z.number().positive().optional(), h: z.number().positive().optional(), scale: z.number().positive().max(10).optional() })
    .refine((o) => o.w || o.d || o.h || o.scale, "give a size or a scale"),
]);
export type FurnishOp = z.infer<typeof FurnishOp>;
export type FurnishResult = { value: Placed[]; applied: FurnishOp[]; rejected: Rejected[]; selected?: string };

const toPlan = (v: Vec): Pt => ({ x: v.x, y: -v.z });
const toWorld = (p: Pt, y: number): Vec => ({ x: p.x, y, z: -p.y });
const yawFacing = (dx: number, dz: number) => ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360;
const unit = (x: number, z: number) => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };

/** Keeps a footprint of radius r inside the room: pulls an outside or too-close point inward from the nearest wall. */
export function keepInside(p: Pt, r: number, poly: Pt[]): Pt {
  if (poly.length < 3) return p;
  const c = centroid(poly);
  const near = nearestOnBoundary(p, poly);
  if (pointInPolygon(p, poly) && near.dist >= r) return p;
  // Inward normal of the nearest edge (the side the centroid is on).
  let nx = -(near.b.y - near.a.y), ny = near.b.x - near.a.x;
  const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
  if ((c.x - near.pt.x) * nx + (c.y - near.pt.y) * ny < 0) { nx = -nx; ny = -ny; }
  const q = { x: near.pt.x + nx * r, y: near.pt.y + ny * r };
  if (pointInPolygon(q, poly)) return q;
  // Corner or narrow spot: walk toward the centroid until inside.
  for (let t = 0.1; t <= 1; t += 0.1) { const s = { x: q.x + (c.x - q.x) * t, y: q.y + (c.y - q.y) * t }; if (pointInPolygon(s, poly)) return s; }
  return c;
}

/** Footprint corners on the plan for an item at pos turned by rotY (degrees, same convention as the scene). */
export function corners(pos: Vec, size: Size, rotY: number): Pt[] {
  const a = (rotY * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => {
    const lx = (i * size.w) / 2, lz = (k * size.d) / 2;
    return toPlan({ x: pos.x + lx * c + lz * s, y: 0, z: pos.z - lx * s + lz * c });
  });
}

/** Moves a footprint (center c on the plan) until all four corners are inside the room with `clear` meters to spare. */
export function keepRectInside(c: Pt, size: Size, rotY: number, poly: Pt[], clear = 0.03): Pt {
  if (poly.length < 3) return c;
  let p = c;
  for (let i = 0; i < 16; i++) {
    const pts = corners(toWorld(p, 0), size, rotY);
    let worst: { push: Pt; amount: number } | null = null;
    for (const q of pts) {
      const near = nearestOnBoundary(q, poly), inside = pointInPolygon(q, poly);
      if (inside && near.dist >= clear) continue;
      let nx = -(near.b.y - near.a.y), ny = near.b.x - near.a.x;
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const cen = centroid(poly);
      if ((cen.x - near.pt.x) * nx + (cen.y - near.pt.y) * ny < 0) { nx = -nx; ny = -ny; }
      const amount = (inside ? clear - near.dist : near.dist + clear) + 1e-4;
      if (!worst || amount > worst.amount) worst = { push: { x: nx * amount, y: ny * amount }, amount };
    }
    if (!worst) return p;
    p = { x: p.x + worst.push.x, y: p.y + worst.push.y };
  }
  // Wedged in a corner or narrow spot: walk toward the room's middle until it fits, else take the middle.
  const cen = centroid(poly);
  for (let t = 0.1; t <= 1; t += 0.1) {
    const q = { x: p.x + (cen.x - p.x) * t, y: p.y + (cen.y - p.y) * t };
    if (corners(toWorld(q, 0), size, rotY).every((k) => pointInPolygon(k, poly))) return q;
  }
  return cen;
}

/** The room an item is in: whichever room polygon contains its center, else the camera's room. */
export const roomAt = (pos: Vec, view: View): RoomRef | undefined =>
  view.rooms?.find((r) => r.polygon.length >= 3 && pointInPolygon(toPlan(pos), r.polygon)) ?? view.room;

/** Keeps an item fully inside the room it's in (rotated footprint, small clearance); unchanged where there's no outline. */
export function settle(pos: Vec, size: Size, rotY: number, view: View): Vec {
  const poly = roomAt(pos, view)?.polygon ?? [];
  return poly.length >= 3 ? toWorld(keepRectInside(toPlan(pos), size, rotY, poly), view.floorY) : { ...pos, y: view.floorY };
}

/** Scales a size down (proportionally) to fit under the room's ceiling with 5 cm to spare. */
export function underCeiling(size: Size, ceiling?: number): Size {
  if (!ceiling || size.h <= ceiling - 0.05) return size;
  const k = (ceiling - 0.05) / size.h;
  return { w: size.w * k, d: size.d * k, h: size.h * k };
}

/** World position and yaw for an item of this size at an anchor. Items face the camera, or face away from their wall. */
export function place(size: Size, at: Anchor, view: View): { pos: Vec; rotY: number } {
  const f = unit(view.forward.x, view.forward.z);
  const faceCamera = yawFacing(-f.x, -f.z);
  const front = view.ahead ? { ...view.ahead, y: view.floorY } : { x: view.camera.x + f.x * (1.2 + size.d / 2), y: view.floorY, z: view.camera.z + f.z * (1.2 + size.d / 2) };
  const poly = view.room?.polygon ?? [];
  let pos = front, rotY = faceCamera;
  if (at === "point" && view.point) pos = { ...view.point, y: view.floorY };
  if (at === "center" && poly.length >= 3) pos = toWorld(centroid(poly), view.floorY);
  if (at === "wall" && poly.length >= 3) {
    const near = nearestOnBoundary(toPlan(front), poly);
    const c = centroid(poly);
    let nx = -(near.b.y - near.a.y), ny = near.b.x - near.a.x;
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if ((c.x - near.pt.x) * nx + (c.y - near.pt.y) * ny < 0) { nx = -nx; ny = -ny; }
    pos = toWorld({ x: near.pt.x + nx * (size.d / 2 + 0.03), y: near.pt.y + ny * (size.d / 2 + 0.03) }, view.floorY);
    rotY = yawFacing(nx, -ny); // plan normal (nx, ny) is world (nx, -ny)
  }
  return { pos: settle(pos, size, rotY, view), rotY };
}

const footprint = (s: Size) => Math.hypot(s.w, s.d) / 2;
/** The spot nearest `pos` where a new item overlaps nothing: sideways along the camera's right (alternating sides),
 *  then rows further away and closer, each kept inside its room. Falls back to `pos` if the area is full. */
export function freeSpot(pos: Vec, size: Size, rotY: number, items: Placed[], view: View): Vec {
  const f = unit(view.forward.x, view.forward.z), side = size.w + 0.15, deep = size.d + 0.15;
  const at = (k: number, row: number) => settle({ x: pos.x - f.z * side * k + f.x * deep * row, y: pos.y, z: pos.z + f.x * side * k + f.z * deep * row }, size, rotY, view);
  const clear = (p: Vec) => items.every((o) => Math.hypot(o.pos.x - p.x, o.pos.z - p.z) >= (footprint(dims(o)) + footprint(size)) * 0.8);
  for (const row of [0, 1, -1, 2]) for (const k of [0, 1, -1, 2, -2, 3, -3]) { const p = at(k, row); if (clear(p)) return p; }
  return at(0, 0);
}

const nextId = (items: Placed[]) => `f${items.reduce((m, p) => Math.max(m, Number(p.id.slice(1)) || 0), 0) + 1}`;

/** Applies validated ops in order. Unknown ids, bad colors and too many ops are rejected with a reason, never guessed. */
export function applyFurnishOps(items: Placed[], raw: unknown[], view: View, max?: number): FurnishResult {
  const { ops, rejected } = parseOps(raw, FurnishOp, max);
  let value = items, selected = view.selected;
  const applied: FurnishOp[] = [];
  const reject = (op: FurnishOp, reason: string) => rejected.push({ op, reason });
  for (const op of ops) {
    if (op.op === "furnish") { reject(op, "furnishing a whole room goes through the layout planner"); continue; }
    if (op.op === "undo") { reject(op, "undo goes through the tour's history"); continue; }
    if (op.op === "clear") {
      const poly = view.room?.polygon ?? [];
      if (op.scope === "room" && poly.length < 3) { reject(op, "I can't tell which room you're in; walk into a room on the floor plan, or say \"clear everything\""); continue; }
      value = op.scope === "all" ? [] : value.filter((p) => !pointInPolygon(toPlan(p.pos), poly));
      if (!value.some((p) => p.id === selected)) selected = undefined;
      applied.push(op);
      continue;
    }
    if (op.op === "add" && op.pos) {
      const pos = { x: op.pos.x, y: view.floorY, z: op.pos.z }, typical = typicalSize(op.name);
      const size = underCeiling(clampSize(op.size ?? typical.size), roomAt(pos, view)?.ceiling), id = nextId(value);
      value = [...value, { id, name: normName(op.name), terms: op.terms?.length ? op.terms : [op.name], size, approxSize: !op.size && !typical.known, pos, rotY: op.rotY ?? 0, planned: true }];
      selected = id;
      applied.push(op);
      continue;
    }
    if (op.op === "add") {
      const typical = typicalSize(op.name);
      const base0 = place(clampSize(op.size ?? typical.size), op.at ?? "front", view);
      const size = underCeiling(clampSize(op.size ?? typical.size), roomAt(base0.pos, view)?.ceiling);
      const color = op.color ? toHex(op.color) : undefined, material = op.material ? toMaterial(op.material) : undefined;
      if (color === null) { reject(op, `"${op.color}" isn't a color I know; try a name like navy or a hex code`); continue; }
      if (material === null) { reject(op, `"${op.material}" isn't a material I know`); continue; }
      const base = place(size, op.at ?? "front", view);
      for (let i = 0; i < (op.count ?? 1); i++) {
        const pos = freeSpot(base.pos, size, base.rotY, value, view);
        const id = nextId(value);
        value = [...value, { id, name: normName(op.name), terms: op.terms?.length ? op.terms : [op.name], size, approxSize: !op.size && !typical.known, pos, rotY: base.rotY, ...(color && { color }), ...(material && { material }) }];
        selected = id;
      }
      applied.push(op);
      continue;
    }
    const cur = value.find((p) => p.id === op.id);
    if (!cur) { reject(op, `there's no item ${op.id} in this room`); continue; }
    let next: Placed | null = cur;
    if (op.op === "move") {
      const to = place(dims(cur), op.at, view), rotY = op.at === "point" || op.at === "center" ? cur.rotY : to.rotY;
      next = { ...cur, rotY, pos: settle(to.pos, dims(cur), rotY, view) };
    }
    if (op.op === "rotate") { const rotY = (((cur.rotY + op.degrees) % 360) + 360) % 360; next = { ...cur, rotY, pos: settle(cur.pos, dims(cur), rotY, view) }; }
    if (op.op === "resize") {
      const d = dims(cur);
      const k0 = op.scale ?? (op.w ? op.w / d.w : op.d ? op.d / d.d : op.h! / d.h);
      const size = underCeiling(clampSize({ w: cur.size.w * k0, d: cur.size.d * k0, h: cur.size.h * k0 }), roomAt(cur.pos, view)?.ceiling);
      const k = size.h / cur.size.h; // after clamping
      const fitted = cur.fitted && { w: cur.fitted.w * k, d: cur.fitted.d * k, h: cur.fitted.h * k };
      next = { ...cur, size, approxSize: false, ...(fitted && { fitted }), pos: settle(cur.pos, fitted ?? size, cur.rotY, view) };
    }
    if (op.op === "remove") next = null;
    if (op.op === "swap") next = { ...cur, name: normName(op.name), terms: op.terms?.length ? op.terms : [op.name], model: undefined };
    if (op.op === "recolor") {
      const color = op.color ? toHex(op.color) : undefined, material = op.material ? toMaterial(op.material) : undefined;
      if (color === null) { reject(op, `"${op.color}" isn't a color I know; try a name like navy or a hex code`); continue; }
      if (material === null) { reject(op, `"${op.material}" isn't a material I know`); continue; }
      next = { ...cur, ...(color && { color }), ...(material && { material, ...(!color && { color: undefined }) }) };
    }
    value = next ? value.map((p) => (p.id === cur.id ? next! : p)) : value.filter((p) => p.id !== cur.id);
    selected = next ? next.id : selected === cur.id ? undefined : selected;
    applied.push(op);
  }
  return { value, applied, rejected, selected };
}

/** Uniform scale that brings a model's bounding box to the item's height without overflowing its footprint. */
export function scaleFor(box: { x: number; y: number; z: number }, size: Size): number {
  const byHeight = size.h / Math.max(box.y, 1e-3);
  const byFootprint = Math.max(size.w, size.d) / Math.max(box.x, box.z, 1e-3);
  return Math.min(byHeight, byFootprint);
}

/** Nearest item whose footprint box (size at pos, turned by rotY) a ray passes through; null if none. */
export function hitItem(origin: Vec, dir: Vec, items: Placed[]): string | null {
  let best: { id: string; t: number } | null = null;
  for (const p of items) {
    // Into the item's local frame: undo its position, then its yaw.
    const a = (-p.rotY * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const ox = origin.x - p.pos.x, oz = origin.z - p.pos.z;
    const o = { x: ox * c + oz * s, y: origin.y - p.pos.y, z: -ox * s + oz * c };
    const d = { x: dir.x * c + dir.z * s, y: dir.y, z: -dir.x * s + dir.z * c };
    const s3 = dims(p);
    const min = { x: -s3.w / 2, y: 0, z: -s3.d / 2 }, max = { x: s3.w / 2, y: s3.h, z: s3.d / 2 };
    let t0 = 0, t1 = Infinity;
    for (const k of ["x", "y", "z"] as const) {
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < min[k] || o[k] > max[k]) { t0 = Infinity; break; } continue; }
      const ta = (min[k] - o[k]) / d[k], tb = (max[k] - o[k]) / d[k];
      t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (t0 <= t1 && t0 < (best?.t ?? Infinity)) best = { id: p.id, t: t0 };
  }
  return best?.id ?? null;
}

/** Matterport measurement lines for a selected item: width, depth and height along its footprint, and the gap from
 *  its nearest corner to the nearest wall of its room. Labels in feet and inches. */
export function dimensionLines(p: Placed, view: View): { points: Vec[]; label: string }[] {
  const d = dims(p), y = p.pos.y + 0.01;
  const [a, b, c] = corners(p.pos, d, p.rotY).map((q) => toWorld(q, y));
  const lines = [
    { points: [a, b], label: `W ${ftIn(d.w)}` },
    { points: [b, c], label: `D ${ftIn(d.d)}` },
    { points: [b, { ...b, y: y + d.h }], label: `H ${ftIn(d.h)}` },
  ];
  const poly = roomAt(p.pos, view)?.polygon ?? [];
  if (poly.length >= 3) {
    const gaps = corners(p.pos, d, p.rotY).map((q) => ({ q, near: nearestOnBoundary(q, poly) })).sort((m, n) => m.near.dist - n.near.dist);
    const g = gaps[0];
    if (g.near.dist > 0.02 && g.near.dist < 3) lines.push({ points: [toWorld(g.q, y), toWorld(g.near.pt, y)], label: `${ftIn(g.near.dist)} to wall` });
  }
  return lines;
}

/** Ops that make an item match a line the user measured: proportional resize (horizontal line → width, vertical →
 *  height), turned to run along the line facing the camera, centered on it and kept inside the room. */
export function fromMeasurement(p: Placed, start: Vec, end: Vec, view: View): { ops: object[]; point?: Vec } | null {
  const dx = end.x - start.x, dz = end.z - start.z, dy = end.y - start.y, flat = Math.hypot(dx, dz);
  if (Math.max(flat, Math.abs(dy)) < 0.05) return null;
  if (Math.abs(dy) > flat) return { ops: [{ op: "resize", id: p.id, h: Math.abs(dy) }] };
  // Width runs along local x, which the scene's yaw θ maps to world (cos θ, -sin θ); the front (local +z) to (sin θ, cos θ).
  let yaw = (Math.atan2(-dz, dx) * 180) / Math.PI;
  const mid = { x: (start.x + end.x) / 2, y: view.floorY, z: (start.z + end.z) / 2 };
  const fx = Math.sin((yaw * Math.PI) / 180), fz = Math.cos((yaw * Math.PI) / 180);
  if (fx * (view.camera.x - mid.x) + fz * (view.camera.z - mid.z) < 0) yaw += 180;
  const degrees = ((((yaw - p.rotY) % 360) + 540) % 360) - 180;
  return { ops: [{ op: "resize", id: p.id, w: flat }, ...(Math.abs(degrees) > 0.5 ? [{ op: "rotate", id: p.id, degrees }] : []), { op: "move", id: p.id, at: "point" }], point: mid };
}
