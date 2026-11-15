import { describe, expect, it } from "vitest";
import { nearestOnBoundary, pointInPolygon, type Pt } from "../geometry/polygon";
import { boxCorners, layoutRoom, yawOf, type Laid, type LayoutRoom, type PlanItem } from "./layout";
import { corners } from "./ops";

const rect = (w: number, d: number, x = 0, y = 0): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }];
const room = (polygon: Pt[], doors: LayoutRoom["doors"] = [], ceiling?: number): LayoutRoom => ({ id: "r", label: "room", polygon, doors, ceiling });
let n = 0;
const item = (name: string, w: number, d: number, h: number, place: PlanItem["place"], extra: Partial<PlanItem> = {}): PlanItem =>
  ({ key: extra.key ?? `k${n++}`, name, terms: [name], size: { w, d, h }, count: 1, place, priority: 1, ...extra });
const front = (p: Laid): Pt => { const a = (p.rotY * Math.PI) / 180; return { x: Math.sin(a), y: -Math.cos(a) }; };
const boxOf = (p: Laid) => ({ c: p.pos, f: front(p), w: p.size.w, d: p.size.d });
const cornersOf = (p: Laid) => boxCorners(boxOf(p));
const of = (placed: Laid[], name: string) => placed.filter((p) => p.name === name);
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Footprints overlap (SAT, 1 mm tolerance). */
function overlap(a: Pt[], b: Pt[]): boolean {
  const axes = [a, b].flatMap((q) => [0, 1].map((i) => ({ x: q[i + 1].x - q[i].x, y: q[i + 1].y - q[i].y })));
  return axes.every((ax) => {
    const pa = a.map((p) => p.x * ax.x + p.y * ax.y), pb = b.map((p) => p.x * ax.x + p.y * ax.y), l = Math.hypot(ax.x, ax.y);
    return Math.min(...pa) < Math.max(...pb) - 1e-3 * l && Math.min(...pb) < Math.max(...pa) - 1e-3 * l;
  });
}
/** Every layout must hold these: inside the room, nothing overlapping (rugs aside), doorways clear. */
function sane(placed: Laid[], r: LayoutRoom) {
  const solid = placed.filter((p) => p.size.h > 0.1);
  for (const p of placed) for (const c of cornersOf(p)) expect(pointInPolygon(c, r.polygon), `${p.name} inside`).toBe(true);
  for (const p of placed) for (const v of r.polygon) {
    const b = boxOf(p), rel = { x: v.x - b.c.x, y: v.y - b.c.y };
    const inBox = Math.abs(rel.x * b.f.y - rel.y * b.f.x) < b.w / 2 - 1e-3 && Math.abs(rel.x * b.f.x + rel.y * b.f.y) < b.d / 2 - 1e-3;
    expect(inBox, `${p.name} crosses a corner of the room`).toBe(false);
  }
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) expect(overlap(cornersOf(solid[i]), cornersOf(solid[j])), `${solid[i].name} vs ${solid[j].name}`).toBe(false);
  for (const d of r.doors) for (const p of solid) expect(cornersOf(p).every((c) => Math.hypot(c.x - d.at.x, c.y - d.at.y) > d.width / 2), `${p.name} blocks a door`).toBe(true);
}
/** Distance from the back edge's midpoint to the nearest wall. */
const backGap = (p: Laid, poly: Pt[]) => { const f = front(p); return nearestOnBoundary({ x: p.pos.x - f.x * p.size.d / 2, y: p.pos.y - f.y * p.size.d / 2 }, poly).dist; };

describe("layoutRoom", () => {
  it("uses the same yaw convention as ops.corners", () => {
    for (const f of [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: Math.SQRT1_2, y: -Math.SQRT1_2 }]) {
      const b = { c: { x: 2, y: 3 }, f, w: 1.6, d: 0.6 };
      const mine = boxCorners(b).map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).sort();
      const theirs = corners({ x: 2, y: 0, z: -3 }, { w: 1.6, d: 0.6, h: 1 }, yawOf(f)).map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).sort();
      expect(mine).toEqual(theirs);
    }
  });

  it("bedroom: bed centered on the wall away from the door, nightstands flank it with backs aligned", () => {
    const r = room(rect(4, 4), [{ at: { x: 2, y: 0 }, width: 0.9 }]);
    const { placed, dropped } = layoutRoom([
      item("bed", 1.6, 2.1, 0.6, "wall", { key: "bed", wall: "far-from-door" }),
      item("nightstand", 0.5, 0.4, 0.55, "beside", { of: "bed", count: 2, priority: 2 }),
      item("dresser", 1.5, 0.5, 0.8, "wall", { priority: 2 }),
    ], r);
    sane(placed, r);
    expect(dropped).toEqual([]);
    const [bed] = of(placed, "bed");
    expect(bed.pos.y).toBeGreaterThan(2.5); // back on the far (y = 4) wall
    expect(Math.abs(bed.pos.x - 2)).toBeLessThan(0.2);
    expect(backGap(bed, r.polygon)).toBeLessThan(0.05);
    const ns = of(placed, "nightstand");
    expect(ns).toHaveLength(2);
    expect(ns.map((p) => Math.sign(p.pos.x - bed.pos.x)).sort()).toEqual([-1, 1]);
    for (const p of ns) { expect(p.rotY).toBeCloseTo(bed.rotY); expect(backGap(p, r.polygon)).toBeLessThan(0.05); }
  });

  it("desk with a chair tucked in front, facing it; a bookshelf elsewhere on a wall", () => {
    const r = room(rect(3, 3.5), [{ at: { x: 0, y: 1 }, width: 0.8 }]);
    const { placed } = layoutRoom([
      item("desk", 1.4, 0.7, 0.75, "wall", { key: "desk", wall: "far-from-door" }),
      item("office chair", 0.65, 0.65, 1.1, "front", { of: "desk" }),
      item("bookshelf", 0.9, 0.35, 1.8, "wall", { priority: 2 }),
    ], r);
    sane(placed, r);
    const [desk] = of(placed, "desk"), [chair] = of(placed, "office chair"), [shelf] = of(placed, "bookshelf");
    expect(angle(chair.rotY, desk.rotY)).toBeCloseTo(180);
    expect(Math.hypot(chair.pos.x - desk.pos.x, chair.pos.y - desk.pos.y)).toBeLessThan(0.75);
    expect(backGap(shelf, r.polygon)).toBeLessThan(0.05);
  });

  it("living room: TV stand on the opposite wall facing the sofa, coffee table between, rug under", () => {
    const r = room(rect(5, 4), [{ at: { x: 0.6, y: 0 }, width: 0.9 }]);
    const { placed } = layoutRoom([
      item("sofa", 2.1, 0.9, 0.85, "wall", { key: "sofa", wall: "far-from-door" }),
      item("coffee table", 1.2, 0.6, 0.45, "front", { of: "sofa" }),
      item("tv stand", 1.5, 0.45, 0.55, "facing", { of: "sofa", priority: 2 }),
      item("rug", 2.4, 1.7, 0.02, "front", { of: "sofa", priority: 3 }),
    ], r);
    sane(placed, r);
    const [sofa] = of(placed, "sofa"), [tv] = of(placed, "tv stand"), [table] = of(placed, "coffee table");
    expect(angle(tv.rotY, sofa.rotY)).toBeCloseTo(180);
    const f = front(sofa), along = (p: Laid) => (p.pos.x - sofa.pos.x) * f.x + (p.pos.y - sofa.pos.y) * f.y;
    expect(along(table)).toBeGreaterThan(0);
    expect(along(tv)).toBeGreaterThan(along(table));
    expect(of(placed, "rug")).toHaveLength(1);
  });

  it("restaurant: tables in rows with aisles, every chair faces its table, nothing in the doorway", () => {
    const r = room(rect(10, 8), [{ at: { x: 5, y: 0 }, width: 1.0 }]);
    const { placed, dropped } = layoutRoom([
      item("four top table", 0.9, 0.9, 0.75, "grid", { key: "t", count: 20 }),
      item("chair", 0.45, 0.5, 0.9, "around", { of: "t", count: 4 }),
      item("host stand", 0.6, 0.5, 1.1, "wall", { wall: "near-door", priority: 2 }),
    ], r, [], 200);
    sane(placed, r);
    const tables = of(placed, "four top table"), chairs = of(placed, "chair");
    expect(tables.length).toBeGreaterThanOrEqual(6);
    expect(chairs.length).toBe(tables.length * 4);
    expect(dropped.find((d) => d.name === "four top table")?.count).toBe(20 - tables.length);
    for (const c of chairs) {
      const t = tables.reduce((m, x) => (Math.hypot(x.pos.x - c.pos.x, x.pos.y - c.pos.y) < Math.hypot(m.pos.x - c.pos.x, m.pos.y - c.pos.y) ? x : m));
      const f = front(c), to = { x: t.pos.x - c.pos.x, y: t.pos.y - c.pos.y }, l = Math.hypot(to.x, to.y);
      expect((f.x * to.x + f.y * to.y) / l).toBeGreaterThan(0.99);
    }
    // Chairs of different tables keep a walkway between them.
    for (const a of tables) for (const b of tables) if (a !== b) expect(Math.max(Math.abs(a.pos.x - b.pos.x), Math.abs(a.pos.y - b.pos.y))).toBeGreaterThanOrEqual(0.9 + 2 * 0.52 + 0.85);
    const [host] = of(placed, "host stand");
    expect(Math.hypot(host.pos.x - 5, host.pos.y)).toBeLessThan(2);
  });

  it("tiny room: keeps essentials, drops the low-priority extras and says so", () => {
    const r = room(rect(2.6, 3), [{ at: { x: 1.3, y: 0 }, width: 0.8 }]);
    const { placed, dropped } = layoutRoom([
      item("exam table", 0.7, 1.9, 0.8, "wall", { key: "exam" }),
      item("sofa", 2.1, 0.9, 0.85, "wall", { priority: 3 }),
      item("cabinet", 0.9, 0.45, 0.9, "wall", { priority: 2 }),
      item("bookshelf", 0.9, 0.35, 1.8, "wall", { priority: 3 }),
    ], r);
    sane(placed, r);
    expect(of(placed, "exam table")).toHaveLength(1);
    expect(dropped.map((d) => d.name)).toContain("sofa");
  });

  it("an anchor that doesn't fit takes its dependents with it", () => {
    const r = room(rect(2, 2));
    const { placed, dropped } = layoutRoom([
      item("conference table", 3, 1.2, 0.75, "center", { key: "ct" }),
      item("chair", 0.5, 0.55, 0.9, "around", { of: "ct", count: 6 }),
      item("plant", 0.5, 0.5, 1.2, "corner", { priority: 3 }),
    ], r);
    expect(of(placed, "chair")).toHaveLength(0);
    expect(dropped).toEqual([{ name: "conference table", count: 1 }]); // its chairs go unmentioned
    expect(of(placed, "plant")).toHaveLength(1);
  });

  it("L-shaped room: nothing cuts across the inside corner", () => {
    const L = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2.5 }, { x: 2.5, y: 2.5 }, { x: 2.5, y: 6 }, { x: 0, y: 6 }];
    const r = room(L, [{ at: { x: 6, y: 1.2 }, width: 0.9 }]);
    const { placed } = layoutRoom([
      item("sofa", 2.1, 0.9, 0.85, "wall", { key: "s" }),
      item("dining table", 1.8, 0.9, 0.75, "center", { key: "dt" }),
      item("dining chair", 0.45, 0.5, 0.9, "around", { of: "dt", count: 4 }),
      item("bookshelf", 0.9, 0.35, 1.8, "wall", { count: 2, priority: 2 }),
      item("plant", 0.5, 0.5, 1.2, "corner", { priority: 3 }),
    ], r);
    sane(placed, r);
    expect(placed.length).toBeGreaterThanOrEqual(8);
  });

  it("rotated room: wall items still sit flat against a wall", () => {
    const a = Math.PI / 6, rot = (p: Pt) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a) + 10, y: p.x * Math.sin(a) + p.y * Math.cos(a) - 4 });
    const r = room(rect(4, 3.5).map(rot), [{ at: rot({ x: 2, y: 0 }), width: 0.9 }]);
    const { placed } = layoutRoom([
      item("bed", 1.6, 2.1, 0.6, "wall", { key: "bed", wall: "far-from-door" }),
      item("nightstand", 0.5, 0.4, 0.55, "beside", { of: "bed", count: 2 }),
    ], r);
    sane(placed, r);
    expect(placed).toHaveLength(3);
    for (const p of placed) expect(backGap(p, r.polygon)).toBeLessThan(0.05);
  });

  it("works around furniture that's already there, and shrinks items under a low ceiling", () => {
    const r = room(rect(3, 3), [], 2.2);
    const existing = [{ pos: { x: 1.5, y: 2.6 }, size: { w: 2.9, d: 0.7, h: 0.9 }, rotY: 180 }];
    const { placed } = layoutRoom([item("wardrobe", 1.2, 0.6, 2.4, "wall")], r, existing);
    sane(placed, r);
    const [w] = placed;
    expect(w.size.h).toBeLessThan(2.151);
    expect(overlap(cornersOf(w), corners({ x: 1.5, y: 0, z: -2.6 }, existing[0].size, 180))).toBe(false);
  });

  it("salon: styling chairs each in front of their own mirror, in a row on one wall", () => {
    const r = room(rect(6, 4), [{ at: { x: 0, y: 2 }, width: 0.9 }]);
    const { placed } = layoutRoom([
      item("mirror", 0.6, 0.05, 1.2, "wall", { key: "m", count: 3, wall: "far-from-door" }),
      item("styling chair", 0.65, 0.7, 1.0, "front", { of: "m" }),
    ], r);
    sane(placed, r);
    const mirrors = of(placed, "mirror"), chairs = of(placed, "styling chair");
    expect(mirrors).toHaveLength(3);
    expect(chairs).toHaveLength(3);
    expect(new Set(mirrors.map((m) => Math.round(m.rotY))).size).toBe(1); // same wall
  });

  it("dependents whose anchor is missing: beside/facing stand on a wall, front/around are dropped", () => {
    const r = room(rect(4, 4));
    const { placed, dropped } = layoutRoom([
      item("nightstand", 0.5, 0.4, 0.55, "beside", { of: "ghost" }),
      item("chair", 0.5, 0.55, 0.9, "around", { of: "ghost", count: 2 }),
      item("a", 0.5, 0.5, 0.5, "front", { key: "a", of: "b" }),
      item("b", 0.5, 0.5, 0.5, "front", { key: "b", of: "a" }),
    ], r);
    expect(of(placed, "nightstand")).toHaveLength(1);
    expect(dropped).toEqual(expect.arrayContaining([{ name: "chair", count: 2 }, { name: "a", count: 1 }, { name: "b", count: 1 }]));
  });

  it("stops at the item budget", () => {
    const r = room(rect(10, 10));
    const { placed, dropped, capped } = layoutRoom([item("plant", 0.5, 0.5, 1.2, "wall", { count: 6 })], r, [], 4);
    expect(capped).toBe(true);
    expect(placed).toHaveLength(4);
    expect(dropped).toEqual([]); // not "no room": the budget ran out
  });

  it("repeats leave a slot for every other kind: a big grid doesn't starve the host stand", () => {
    const r = room(rect(14, 10), [{ at: { x: 7, y: 0 }, width: 1 }]);
    const out = layoutRoom([
      item("four top table", 0.9, 0.9, 0.75, "grid", { key: "t", count: 20 }),
      item("chair", 0.45, 0.5, 0.9, "around", { of: "t", count: 4 }),
      item("host stand", 0.6, 0.5, 1.1, "wall", { wall: "near-door", priority: 2 }),
    ], r, [], 30);
    expect(out.capped).toBe(true);
    expect(out.placed.length).toBeLessThanOrEqual(30);
    expect(of(out.placed, "host stand")).toHaveLength(1);
    expect(of(out.placed, "chair")).toHaveLength(of(out.placed, "four top table").length * 4); // whole tables only
    expect(out.dropped).toEqual([]);
  });

  it("no outline: everything is dropped", () => {
    expect(layoutRoom([item("bed", 1.6, 2.1, 0.6, "wall")], room([])).dropped).toEqual([{ name: "bed", count: 1 }]);
  });

  it("noisy scan outline: a wall split into short, slightly jogged segments still takes a bed", () => {
    // 4 x 4 room whose walls are each split into 1 m pieces with 1 cm jogs, like real scan outlines.
    const jag: Pt[] = [];
    const sides: [Pt, Pt][] = [[{ x: 0, y: 0 }, { x: 4, y: 0 }], [{ x: 4, y: 0 }, { x: 4, y: 4 }], [{ x: 4, y: 4 }, { x: 0, y: 4 }], [{ x: 0, y: 4 }, { x: 0, y: 0 }]];
    for (const [a, b] of sides) for (let k = 0; k < 4; k++) {
      const t = k / 4, j = k % 2 ? 0.01 : 0, nx = -(b.y - a.y) / 4, ny = (b.x - a.x) / 4; // inward jog
      jag.push({ x: a.x + (b.x - a.x) * t + nx * j, y: a.y + (b.y - a.y) * t + ny * j });
    }
    const r = room(jag, [{ at: { x: 2, y: 0 }, width: 0.9 }]);
    const { placed } = layoutRoom([item("bed", 1.6, 2.1, 0.6, "wall", { key: "bed", wall: "far-from-door" }), item("nightstand", 0.5, 0.4, 0.55, "beside", { of: "bed", count: 2 })], r);
    sane(placed, r);
    expect(of(placed, "bed")).toHaveLength(1);
    expect(backGap(of(placed, "bed")[0], r.polygon)).toBeLessThan(0.07);
    expect(of(placed, "nightstand")).toHaveLength(2);
    // A 1 cm step in the middle of the far wall.
    const step = room([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 2.5, y: 4 }, { x: 2.5, y: 3.99 }, { x: 0, y: 3.99 }], [{ at: { x: 2.5, y: 0 }, width: 0.9 }]);
    const [bed] = layoutRoom([item("bed", 1.6, 2.1, 0.6, "wall", { wall: "far-from-door" })], step).placed;
    sane([bed], step);
    expect(bed.pos.y).toBeGreaterThan(2.5);
    expect(Math.abs(bed.pos.x - 2.5)).toBeLessThan(0.3);
  });

  it("behind: a reception desk stands off its wall with the receptionist's chair between, facing the same way", () => {
    const r = room(rect(6, 4), [{ at: { x: 1, y: 0 }, width: 0.9 }]);
    const { placed } = layoutRoom([
      item("reception desk", 2, 0.8, 1.1, "wall", { key: "rd", wall: "near-door" }),
      item("office chair", 0.65, 0.65, 1.1, "behind", { of: "rd" }),
      item("waiting chair", 0.5, 0.55, 0.9, "wall", { count: 3, priority: 2 }),
    ], r);
    sane(placed, r);
    const [desk] = of(placed, "reception desk"), [chair] = of(placed, "office chair");
    expect(chair.rotY).toBeCloseTo(desk.rotY);
    expect(backGap(desk, r.polygon)).toBeGreaterThanOrEqual(0.65);
    const f = front(desk);
    expect((chair.pos.x - desk.pos.x) * f.x + (chair.pos.y - desk.pos.y) * f.y).toBeLessThan(0);
  });

  it("a center piece in a big room goes in the middle, not the first corner far enough from the walls", () => {
    const r = room(rect(16, 14));
    const [t] = layoutRoom([item("conference table", 3, 1.2, 0.75, "center")], r).placed;
    expect(Math.hypot(t.pos.x - 8, t.pos.y - 7)).toBeLessThan(0.5);
  });
});
