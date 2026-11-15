// Plan → positions. The planner (plan.ts) says what goes in a room and how pieces relate ("nightstands beside the bed");
// this pure solver puts each piece against a wall, in the open middle or next to its anchor, keeping doors and walkways
// clear and dropping what doesn't fit. Works on the floor plan: plan (x, y) == world (x, -z), yaw as in ops.corners.
import { nearestOnBoundary, pointInPolygon, type Pt } from "../geometry/polygon";
import { doorPoint } from "../reason/access";
import type { RoomGraph } from "../types";
import { clampSize, type Size } from "./catalog";
import { underCeiling } from "./ops";

export const PLACES = ["wall", "corner", "center", "grid", "beside", "front", "behind", "around", "facing", "on"] as const;
export type Place = (typeof PLACES)[number];
export const DEPENDENT: readonly Place[] = ["beside", "front", "behind", "around", "facing", "on"];
export type PlanItem = { key: string; name: string; terms: string[]; size: Size; count: number; place: Place; of?: string; wall?: "near-door" | "far-from-door"; priority: number };
export type Door = { at: Pt; width: number }; // meters, plan coords
export type LayoutRoom = { id: string; label: string; polygon: Pt[]; ceiling?: number; doors: Door[] };
export type Obstacle = { pos: Pt; size: Size; rotY: number };
export type Laid = { key: string; name: string; terms: string[]; size: Size; pos: Pt; rotY: number; elevation?: number }; // elevation: meters above the floor ("on" items)
export type Layout = { placed: Laid[]; dropped: { name: string; count: number }[]; capped: boolean }; // capped: stopped at the item budget, not for lack of room

type Box = { c: Pt; f: Pt; w: number; d: number }; // center, unit front direction, width across f, depth along f
type Entry = { box: Box; group: string; zone?: Box; grid?: boolean };
type Inst = { item: PlanItem; box: Box; group: string; top: number; tops?: Laid[] }; // top: height of its upper surface; tops: "on" items standing on it

const WALL_GAP = 0.03; // back of a wall item to the wall
const WALL_ZONE = 0.6; // kept clear in front of wall items
const CENTER_ZONE = 0.6; // kept clear around center items (beyond their seats)
const HALF_AISLE = 0.45; // grid zones can't overlap, so rows get a 0.9 m aisle
const DOOR_DEPTH = 1.0;
/** Overrides for the clearances above, in meters: grid aisle width, clear depth in front of wall items, door patch depth. */
export type Clearances = { aisle?: number; frontClear?: number; turn?: number };
/** Screening clearances for a wheelchair user (ADA 2010 Standards): a 36 in accessible route (§403.5.1), or the chair plus
 *  2 in a side when wider; 30 × 48 in clear floor space for a forward approach to work surfaces (§305.3); a 60 in turning
 *  space (§304.3) at each door. */
export const wheelchairClearances = (chairWidthIn: number): Clearances =>
  ({ aisle: Math.max(36, chairWidthIn + 4) * 0.0254, frontClear: 48 * 0.0254, turn: 60 * 0.0254 });
const ON_GAP = 0.05; // between items sharing a top
const FLAT_H = 0.1; // rugs (sizes are clamped to ≥ 0.1 m): no collisions, not obstacles
const SEAT = /\b(chair|stool|seat|bench|sofa|couch|loveseat|recliner)\b/;

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const right = (f: Pt): Pt => ({ x: f.y, y: -f.x });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Yaw (degrees) of an item whose front faces plan direction f: world front (sin θ, cos θ) == plan (f.x, -f.y). */
export const yawOf = (f: Pt) => (((Math.atan2(f.x, -f.y) * 180) / Math.PI) % 360 + 360) % 360;
const frontOf = (rotY: number): Pt => { const a = (rotY * Math.PI) / 180; return { x: Math.sin(a), y: -Math.cos(a) }; };

export function boxCorners(b: Box): Pt[] {
  const r = right(b.f);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => add(add(b.c, r, (i * b.w) / 2), b.f, (k * b.d) / 2));
}
/** Separating-axis test; touching (within 1 mm) doesn't count. */
function overlaps(a: Box, b: Box): boolean {
  if (dist(a.c, b.c) > (Math.hypot(a.w, a.d) + Math.hypot(b.w, b.d)) / 2) return false; // cheap reject
  const pa = boxCorners(a), pb = boxCorners(b);
  for (const ax of [a.f, right(a.f), b.f, right(b.f)]) {
    const ra = pa.map((p) => dot(p, ax)), rb = pb.map((p) => dot(p, ax));
    if (Math.min(...ra) >= Math.max(...rb) - 1e-3 || Math.min(...rb) >= Math.max(...ra) - 1e-3) return false;
  }
  return true;
}

type Edge = { a: Pt; u: Pt; n: Pt; len: number };
const unitOf = (a: Pt, b: Pt) => { const l = dist(a, b) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };
const SAME_DIR = Math.cos((10 * Math.PI) / 180), SHORT = 0.15, OFF_LINE = 0.06;
/** Walls of the outline with inward normals. Scan outlines split straight walls into short, slightly jogged pieces, so
 *  runs of near-collinear edges (and tiny jogs) merge into one wall. Normals are tested at each wall's midpoint, so
 *  L-shaped rooms work. */
function edgesOf(poly: Pt[]): Edge[] {
  const raw = poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length] })).filter((e) => dist(e.a, e.b) > 1e-6);
  if (raw.length < 3) return [];
  const long = (i: number) => dist(raw[i].a, raw[i].b) >= SHORT;
  const dirOf = (i: number) => unitOf(raw[i].a, raw[i].b);
  // Start at a real corner: a long edge whose previous long edge turns away.
  const start = raw.findIndex((_, i) => {
    if (!long(i)) return false;
    for (let k = 1; k < raw.length; k++) { const j = (i - k + raw.length) % raw.length; if (long(j)) return dot(dirOf(j), dirOf(i)) < SAME_DIR; }
    return false;
  });
  const walls: { a: Pt; b: Pt }[] = [];
  let run: { a: Pt; b: Pt; u?: Pt } | null = null;
  for (let k = 0; k < raw.length; k++) {
    const i = (Math.max(0, start) + k) % raw.length, e = raw[i];
    const offLine = (p: Pt) => (run?.u ? Math.abs((p.x - run.a.x) * run.u.y - (p.y - run.a.y) * run.u.x) : 0);
    if (run && offLine(e.b) <= OFF_LINE && (!long(i) || !run.u || dot(dirOf(i), run.u) >= SAME_DIR)) { run.b = e.b; run.u ??= long(i) ? dirOf(i) : undefined; continue; }
    if (run) walls.push(run);
    run = { a: e.a, b: e.b, u: long(i) ? dirOf(i) : undefined };
  }
  if (run) walls.push(run);
  return walls.flatMap(({ a, b }) => {
    const len = dist(a, b);
    if (len < 0.2) return [];
    const u = unitOf(a, b), mid = add(a, u, len / 2);
    let n = { x: -u.y, y: u.x };
    if (!pointInPolygon(add(mid, n, 0.08), poly)) n = { x: -n.x, y: -n.y };
    return pointInPolygon(add(mid, n, 0.08), poly) ? [{ a, u, n, len }] : [];
  });
}

/** Lays out one room's plan. `budget` caps how many items are placed (model downloads are the cost). */
export function layoutRoom(plan: PlanItem[], room: LayoutRoom, existing: Obstacle[] = [], budget = 30, clear: Clearances = {}): Layout {
  const poly = room.polygon;
  const halfAisle = clear.aisle ? clear.aisle / 2 : HALF_AISLE, frontClear = clear.frontClear ?? WALL_ZONE, turn = clear.turn ?? DOOR_DEPTH;
  const placed: Laid[] = [], missing = new Map<string, number>();
  let capped = false;
  const miss = (name: string, n: number) => n > 0 && missing.set(name, (missing.get(name) ?? 0) + n);
  const done = (): Layout => ({ placed, dropped: [...missing].map(([name, count]) => ({ name, count })), capped });
  if (poly.length < 3) { plan.forEach((p) => miss(p.name, p.count)); return done(); }

  const edges = edgesOf(poly);
  const longest = edges.reduce((m, e) => (e.len > m.len ? e : m), edges[0]);
  const doors: Box[] = room.doors.flatMap((dr) => {
    const e = edges.map((e) => ({ e, near: nearestOnBoundary(dr.at, [e.a, add(e.a, e.u, e.len)]) })).sort((x, y) => x.near.dist - y.near.dist)[0];
    return e && e.near.dist < 0.35 ? [{ c: add(e.near.pt, e.e.n, turn / 2), f: e.e.n, w: Math.max(dr.width + 0.2, clear.turn ?? 0), d: turn }] : [];
  });
  const doorDist = (p: Pt) => Math.min(Infinity, ...doors.map((b) => dist(p, add(b.c, b.f, -turn / 2))));
  const entries: Entry[] = existing.map((o, i) => ({ box: { c: o.pos, f: frontOf(o.rotY), w: o.size.w, d: o.size.d }, group: `existing${i}` }));
  const insts: Inst[] = [];

  const inside = (b: Box) => boxCorners(b).every((p) => pointInPolygon(p, poly) && nearestOnBoundary(p, poly).dist >= 0.02)
    && !poly.some((v) => Math.abs(dot({ x: v.x - b.c.x, y: v.y - b.c.y }, right(b.f))) < b.w / 2 - 1e-3 && Math.abs(dot({ x: v.x - b.c.x, y: v.y - b.c.y }, b.f)) < b.d / 2 - 1e-3);
  const free = (b: Box, group: string, flat: boolean, zone?: Box, grid?: boolean) => {
    if (!inside(b)) return false;
    if (flat) return true;
    if (doors.some((dr) => overlaps(b, dr))) return false;
    return entries.every((e) => !overlaps(b, e.box)
      && (e.group === group || ((!e.zone || !overlaps(b, e.zone)) && (!zone || !overlaps(zone, e.box)) && !(grid && e.grid && zone && e.zone && overlaps(zone, e.zone)))));
  };

  // Room an item's seats need: "around" seats on every side, "front" seats (desk chair) ahead, "behind" (receptionist) behind.
  const depth = (it: PlanItem, place: Place) => Math.max(0, ...plan.filter((p) => p.of === it.key && p.place === place && p.size.h > FLAT_H).map((p) => p.size.d + 0.05));
  /** The box grown by `front` ahead, `back` behind and `side` left and right. */
  const extend = (b: Box, front: number, back: number, side: number): Box => ({ c: add(b.c, b.f, (front - back) / 2), f: b.f, w: b.w + 2 * side, d: b.d + front + back });
  const reach = (it: PlanItem, b: Box, m = 0) => { const a = depth(it, "around"); return extend(b, Math.max(a, depth(it, "front")) + m, Math.max(a, depth(it, "behind")) + m, a + m); };
  // A desk someone sits behind stands off its wall with room for the chair and to get in and out.
  const backGap = (it: PlanItem) => (depth(it, "behind") ? depth(it, "behind") + 0.15 : WALL_GAP);
  const zoneOf = (it: PlanItem, b: Box): Box | undefined => {
    if (it.place === "wall" || it.place === "corner") {
      // Wide and deep enough for what sits in front (a styling chair, a desk chair pulled out), so stations don't crowd.
      const fronts = plan.filter((p) => p.of === it.key && p.place === "front" && p.size.h > FLAT_H);
      const w = Math.max(b.w, ...fronts.map((p) => p.size.w + 0.4)), d = Math.max(frontClear,...fronts.map((p) => p.size.d + 0.3));
      return { c: add(b.c, b.f, b.d / 2 + d / 2), f: b.f, w, d };
    }
    if (it.place === "center") return reach(it, b, CENTER_ZONE);
    if (it.place === "grid") return reach(it, b, halfAisle);
    return undefined;
  };

  function wallSpots(s: Size, back = WALL_GAP): { box: Box; t: number; len: number }[] {
    return edges.flatMap((e) => {
      if (e.len < s.w + 2 * WALL_GAP) return [];
      const lo = s.w / 2 + WALL_GAP, hi = e.len - s.w / 2 - WALL_GAP, ts = [lo, hi, (lo + hi) / 2];
      for (let t = lo + 0.1; t < hi; t += 0.1) ts.push(t);
      return ts.map((t) => ({ t, len: e.len, box: { c: add(add(e.a, e.u, t), e.n, s.d / 2 + back), f: e.n, w: s.w, d: s.d } }));
    });
  }
  // Floor positions on a lattice aligned to the longest wall (s along it, t into the room); both orientations unless `fixed`.
  const rel = poly.map((p) => ({ s: dot({ x: p.x - longest.a.x, y: p.y - longest.a.y }, longest.u), t: dot({ x: p.x - longest.a.x, y: p.y - longest.a.y }, longest.n) }));
  const [S0, S1, T0, T1] = [Math.min(...rel.map((r) => r.s)), Math.max(...rel.map((r) => r.s)), Math.min(...rel.map((r) => r.t)), Math.max(...rel.map((r) => r.t))];
  function floorSpots(s: Size, ps: number, pt: number, s0 = S0 + ps / 2, t0 = T0 + pt / 2, fixed = false): Box[] {
    const out: Box[] = [];
    for (let t = t0; t < T1; t += pt) for (let si = s0; si < S1; si += ps) {
      const c = add(add(longest.a, longest.u, si), longest.n, t);
      if (!pointInPolygon(c, poly)) continue;
      out.push({ c, f: longest.n, w: s.w, d: s.d });
      if (!fixed) out.push({ c, f: longest.u, w: s.w, d: s.d });
    }
    return out;
  }
  const middle = add(add(longest.a, longest.u, (S0 + S1) / 2), longest.n, (T0 + T1) / 2);
  const lattices = new Map<string, Box[]>();
  /** Grid items: the lattice phase (centered first, then quarter shifts) that fits the most free spots, far from the door first. */
  function lattice(it: PlanItem, size: Size, ok: (b: Box) => boolean): Box[] {
    const hit = lattices.get(it.key);
    if (hit) return hit;
    const z = reach(it, { c: { x: 0, y: 0 }, f: { x: 0, y: 1 }, w: size.w, d: size.d }, halfAisle), ps = z.w, pt = z.d;
    const center = (lo: number, hi: number, p: number) => lo + ((hi - lo) - Math.floor((hi - lo) / p) * p) / 2 + p / 2;
    const phases = [[center(S0, S1, ps), center(T0, T1, pt)], ...[0, 0.25, 0.5, 0.75].flatMap((a) => [0, 0.25, 0.5, 0.75].map((b) => [S0 + ps * (a + 0.5), T0 + pt * (b + 0.5)]))];
    let best: Box[] = [];
    for (const [s0, t0] of phases) { const spots = floorSpots(size, ps, pt, s0, t0, true).filter(ok); if (spots.length > best.length) best = spots; }
    // A partial grid grows from the middle of the free floor, not from a corner.
    const mid = best.reduce((m, b) => ({ x: m.x + b.c.x / best.length, y: m.y + b.c.y / best.length }), { x: 0, y: 0 });
    best.sort((a, b) => dist(a.c, mid) - dist(b.c, mid));
    lattices.set(it.key, best);
    return best;
  }

  /** Room for an anchor's beside/front companions at this spot (so a sofa isn't centered where its armchair can't go).
   *  `ideal`: only their first-choice slots (chair straight in front, nightstands on both sides). */
  function companionsFit(it: PlanItem, box: Box, group: string, place: "beside" | "front" | "behind", ideal: boolean): boolean {
    return plan.every((d) => {
      if (d.of !== it.key || d.place !== place) return true;
      const need = Math.min(d.count, place === "beside" ? 2 : 1), spots = dependentSpots(d, sizeOf(d), box);
      const ok = (b: Box) => free(b, group, sizeOf(d).h <= FLAT_H);
      return ideal ? spots.slice(0, need).every(ok) : spots.filter(ok).length >= need;
    });
  }

  /** Best free spot for an anchor instance (no `of`), or null. */
  function anchorSpot(it: PlanItem, size: Size, group: string, flat: boolean): Box | null {
    const siblings = insts.filter((x) => x.item.key === it.key).map((x) => x.box.c);
    const others = insts.filter((x) => !x.item.of && x.item.key !== it.key).map((x) => x.box.c);
    const depW = Math.max(size.w, ...plan.filter((p) => p.of === it.key).map((p) => p.size.w));
    let cands: { box: Box; score: number }[];
    if (it.place === "wall" || it.place === "corner") {
      cands = wallSpots(size, backGap(it)).map(({ box, t, len }) => {
        const dd = doorDist(box.c);
        let score = it.wall === "far-from-door" ? Math.min(dd, 8) : it.wall === "near-door" ? -dd * 2 : Math.min(dd, 2) * 0.5;
        if (it.place === "corner") score -= Math.min(t - size.w / 2, len - t - size.w / 2) * 2;
        else if (!siblings.length && it.count === 1 && size.w >= 1) score -= Math.abs(t - len / 2) * 0.6; // a bed or sofa centered on its wall
        if (siblings.length) score -= Math.min(...siblings.map((p) => Math.abs(dist(p, box.c) - (depW + 0.5)))) * 2; // stations in a row
        if (others.length) score += Math.min(3, ...others.map((p) => dist(p, box.c))) * 0.3; // spread out
        return { box, score };
      });
    } else if (it.place === "grid") {
      const ok = (b: Box) => inside(reach(it, b)) && free(b, group, flat, zoneOf(it, b), true);
      cands = lattice(it, size, ok).map((box, i) => ({ box, score: -i }));
    } else {
      // Open middle: away from walls and doors; in a big room, ties go to the middle rather than the first corner found.
      cands = floorSpots(size, 0.15, 0.15).map((box) => ({ box, score: Math.min(3, nearestOnBoundary(box.c, poly).dist) + Math.min(2, doorDist(box.c)) * 0.3 - dist(box.c, middle) * 0.05 }));
    }
    cands.sort((a, b) => b.score - a.score);
    const floor = it.place === "center" || it.place === "grid";
    // Best spot whose companions sit in their ideal slots, else one where they fit somewhere, else (beside only) without them.
    const tiers: (Box | null)[] = [null, null, null];
    for (const { box } of cands) {
      if (floor && !inside(reach(it, box))) continue; // its seats must fit too
      const zone = zoneOf(it, box);
      if (zone && (it.place === "wall" || it.place === "corner") && !pointInPolygon(zone.c, poly)) continue; // not facing a wall up close
      if (!free(box, group, flat, zone, it.place === "grid")) continue;
      // A mirror without room for its chair, or a reception desk without its receptionist's, is pointless.
      if (!companionsFit(it, box, group, "front", false) || !companionsFit(it, box, group, "behind", false)) continue;
      if (companionsFit(it, box, group, "front", true) && companionsFit(it, box, group, "behind", true) && companionsFit(it, box, group, "beside", true)) return box;
      const tier = companionsFit(it, box, group, "beside", false) ? 1 : 2;
      tiers[tier] ??= box; // a bed is still a bed without its nightstands
    }
    return tiers[1] ?? tiers[2];
  }

  /** Candidate spots for a dependent next to its anchor instance, in preference order. */
  function dependentSpots(it: PlanItem, size: Size, k: Box): Box[] {
    const r = right(k.f), flat = size.h <= FLAT_H;
    if (it.place === "beside") {
      const out: Box[] = [];
      for (let slot = 0; slot < 3; slot++) for (const side of [1, -1]) {
        const off = k.w / 2 + 0.05 + slot * (size.w + 0.05) + size.w / 2;
        out.push({ c: add(add(k.c, r, side * off), k.f, (size.d - k.d) / 2), f: k.f, w: size.w, d: size.d });
      }
      return out;
    }
    if (it.place === "front") {
      const seat = SEAT.test(it.name), gap = flat ? -0.2 : seat ? 0.02 : 0.4;
      const c = add(k.c, k.f, k.d / 2 + gap + size.d / 2), pitch = size.w + 0.15, m = Math.max(1, Math.floor((k.w + 0.15) / pitch));
      const offs = Array.from({ length: m }, (_, j) => (j - (m - 1) / 2) * pitch).sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
      return (m === 1 ? [0, 0.35, -0.35] : offs).map((o) => ({ c: add(c, r, o), f: seat ? { x: -k.f.x, y: -k.f.y } : k.f, w: size.w, d: size.d }));
    }
    if (it.place === "behind") {
      const c = add(k.c, k.f, -(k.d / 2 + 0.02 + size.d / 2)); // faces the same way as its anchor: over the desk
      return [0, 0.35, -0.35].map((o) => ({ c: add(c, r, o), f: k.f, w: size.w, d: size.d }));
    }
    if (it.place === "around") {
      const sides = [{ n: k.f, len: k.w, half: k.d / 2 }, { n: { x: -k.f.x, y: -k.f.y }, len: k.w, half: k.d / 2 }, { n: r, len: k.d, half: k.w / 2 }, { n: { x: -r.x, y: -r.y }, len: k.d, half: k.w / 2 }];
      const slots = sides.map((sd) => {
        const m = Math.max(1, Math.floor(sd.len / (size.w + 0.1)));
        const offs = Array.from({ length: m }, (_, j) => ((j + 0.5) / m - 0.5) * sd.len).sort((a, b) => Math.abs(a) - Math.abs(b));
        return offs.map((o) => ({ c: add(add(k.c, sd.n, sd.half + 0.02 + size.d / 2), right(sd.n), o), f: { x: -sd.n.x, y: -sd.n.y }, w: size.w, d: size.d }));
      });
      // Long sides first, alternating, then the ends.
      const out: Box[] = [];
      for (let j = 0; j < Math.max(slots[0].length, slots[1].length); j++) out.push(...[slots[0][j], slots[1][j]].filter(Boolean));
      return [...out, ...slots[2].slice(0, 1), ...slots[3].slice(0, 1)];
    }
    // facing: on a wall in front of the anchor, turned back toward it.
    return wallSpots(size).map(({ box }) => ({ box, v: { x: box.c.x - k.c.x, y: box.c.y - k.c.y } }))
      .filter(({ box, v }) => dot(v, k.f) > 0.5 && Math.abs(dot(v, r)) < dot(v, k.f) && dot(box.f, k.f) < -0.7)
      .sort((a, b) => Math.abs(dot(a.v, r)) - Math.abs(dot(b.v, r))).map(({ box }) => box);
  }

  /** On top of an anchor: one row across its width, centered and facing as it does; earlier items on it shift over to make
   *  room. Null when the row would overhang the top. */
  function onTop(size: Size, a: Inst): Box | null {
    const k = a.box, tops = a.tops ?? [], r = right(k.f);
    const total = tops.reduce((n, t) => n + t.size.w + ON_GAP, size.w);
    if (size.d > k.d || total > k.w + 1e-9) return null;
    let s = -total / 2;
    for (const t of tops) { t.pos = add(k.c, r, s + t.size.w / 2); s += t.size.w + ON_GAP; }
    return { c: add(k.c, r, s + size.w / 2), f: k.f, w: size.w, d: size.d };
  }

  // Dependents need a real anchor in this plan: beside/facing without one stand on a wall, a chair "around" nothing is dropped.
  const keys = new Set(plan.map((p) => p.key));
  const items: PlanItem[] = [];
  for (const p of plan) {
    if (!DEPENDENT.includes(p.place)) items.push({ ...p, of: undefined });
    else if (p.of && p.of !== p.key && keys.has(p.of)) items.push(p);
    else if (p.place === "beside" || p.place === "facing") items.push({ ...p, place: "wall", of: undefined });
    else miss(p.name, p.count);
  }

  const sizeOf = (it: PlanItem) => underCeiling(clampSize(it.size), room.ceiling);
  const put = (it: PlanItem, box: Box, group: string, flat: boolean, h: number, elevation = 0): Inst => {
    const inst: Inst = { item: it, box, group, top: elevation + h };
    insts.push(inst);
    // Items standing on another piece aren't floor obstacles.
    if (!flat && !elevation) entries.push({ box, group, zone: zoneOf(it, box), grid: it.place === "grid" });
    placed.push({ key: it.key, name: it.name, terms: it.terms, size: { w: box.w, d: box.d, h }, pos: box.c, rotY: yawOf(box.f), ...(elevation && { elevation }) });
    return inst;
  };

  const handled = new Set<PlanItem>();
  const prio = (it: PlanItem) => Math.min(3, Math.max(1, Math.round(it.priority) || 1));
  const kids = (it: PlanItem, pri: number) => items.filter((d) => d.of === it.key && !handled.has(d) && prio(d) <= pri);
  const mark = (it: PlanItem, pri: number) => { handled.add(it); for (const d of kids(it, pri)) mark(d, pri); };
  /** Places an item's instances for one anchor instance (or as an anchor), each followed straight away by its own
   *  companions, so a mirror's chair claims its spot before the next mirror goes down. */
  function placeFor(it: PlanItem, a: Inst | null, pri: number) {
    // On top of the anchor: the item's top stays under the ceiling too.
    const elev = a && it.place === "on" ? a.top : 0;
    const size = elev ? underCeiling(clampSize(it.size), room.ceiling && Math.max(1e-3, room.ceiling - elev)) : sizeOf(it), flat = size.h <= FLAT_H;
    const groupSize = 1 + items.filter((d) => d.of === it.key && prio(d) <= pri).reduce((n, d) => n + d.count, 0);
    for (let i = 0; i < it.count; i++) {
      // Repeats (the 7th table) must leave one slot for every other kind still to come (the host stand).
      const reserve = a || i === 0 ? 0 : items.filter((x) => !x.of && !handled.has(x) && x !== it).length;
      if (placed.length + (a ? 1 : i === 0 ? 1 : groupSize) > budget - reserve) { capped = true; break; }
      const group = a?.group ?? `${it.key}#${insts.filter((x) => x.item.key === it.key).length}`;
      const box = !a ? anchorSpot(it, size, group, flat) : it.place === "on" ? (size.h >= 0.05 ? onTop(size, a) : null) : dependentSpots(it, size, a.box).find((b) => free(b, group, flat));
      if (!box) { miss(it.name, 1); continue; } // its companions go unmentioned: "no room for the table" says it
      const inst = put(it, box, group, flat, size.h, elev);
      if (elev) (a!.tops ??= []).push(placed[placed.length - 1]);
      for (const d of kids(it, pri)) placeFor(d, inst, pri);
    }
  }
  function process(it: PlanItem, pri: number) {
    const anchors = it.of ? insts.filter((x) => x.item.key === it.of) : [null];
    for (const a of anchors) placeFor(it, a, pri);
    mark(it, pri);
  }
  // Priority passes; anchors largest first. Later passes add lower-priority companions to anchors already down.
  for (const pri of [1, 2, 3]) {
    for (const it of items.filter((x) => !x.of && !handled.has(x) && prio(x) <= pri).sort((a, b) => b.size.w * b.size.d - a.size.w * a.size.d)) process(it, pri);
    for (let more = true; more;) {
      more = false;
      for (const d of items) if (d.of && !handled.has(d) && prio(d) <= pri && items.some((a) => a.key === d.of && handled.has(a))) { process(d, pri); more = true; }
    }
  }
  // Left over: cycles in `of` never become ready.
  for (const it of items) if (!handled.has(it)) miss(it.name, it.count);
  return done();
}

export type PlanRoom = LayoutRoom & { objects: string[] };
const DOOR_SNAP_M = 0.5; // real scans: rejected centres are either within ~0.5 m of the wall or metres away on a truncated outline
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 '&/-]{0,39}$/;
/** Planner context for rooms of the room graph: outline, ceiling, doors (estimated on the shared wall when the scan has no
 *  position; outside doors without one are unknown) and what the scan shows there. */
export function planRooms(g: RoomGraph, ids: string[]): PlanRoom[] {
  return ids.flatMap((id) => {
    const r = g.rooms.find((x) => x.id === id);
    if (!r || r.polygon.length < 3) return [];
    // A scanned centre near this room's outline is the real door, snapped onto it; doorPoint also checks the other room,
    // whose outline is often truncated, so it only fills in when the centre is missing or far off.
    const own = (at?: Pt) => { const n = at && nearestOnBoundary(at, r.polygon); return n && n.dist <= DOOR_SNAP_M ? n.pt : null; };
    const doors = [
      ...g.edges.filter((e) => e.a === id || e.b === id).map((e) => ({ at: own(e.at) ?? doorPoint(g, e.a, e.b, e.at), widthIn: e.widthIn })),
      ...[...(g.entries ?? []), ...(g.extraEntries ?? [])].filter((e) => e.roomId === id).map((e) => ({ at: own(e.at) ?? doorPoint(g, id, null, e.at), widthIn: e.widthIn })),
    ].flatMap((d) => (d.at ? [{ at: d.at, width: (d.widthIn ?? 34) * 0.0254 }] : []));
    // Matterport labels look like "rre_kitchen_sink": drop the prefix and underscores so the planner can read them.
    const objects = [...new Set(g.objects.filter((o) => o.roomId === id).map((o) => o.label.replace(/^rre_/i, "").replace(/_/g, " ").trim()))].filter((l) => PLAIN.test(l)).slice(0, 30);
    return [{ id, label: r.label, polygon: r.polygon, ceiling: r.heightFt ? r.heightFt * 0.3048 : undefined, doors, objects }];
  });
}
