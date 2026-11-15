import { describe, expect, it } from "vitest";
import { pointInPolygon } from "../geometry/polygon";
import { clampSize, ftIn, matchesTerms, typicalSize } from "./catalog";
import { applyFurnishOps, corners, dimensionLines, fromMeasurement, hitItem, keepInside, keepRectInside, place, scaleFor, settle, underCeiling, type Placed, type View } from "./ops";

// A synthetic kitchen rectangle: plan x 4.35..7.89, y -2.85..0.47 (world z = -y).
const KITCHEN = [{ x: 4.35, y: -2.85 }, { x: 7.89, y: -2.85 }, { x: 7.89, y: 0.47 }, { x: 4.35, y: 0.47 }];
const view = (over: Partial<View> = {}): View => ({
  camera: { x: 7.09, y: 1.41, z: 1.05 }, forward: { x: -1, z: 0 }, floorY: 0, room: { id: "k", label: "kitchen", polygon: KITCHEN }, ...over,
});
const inRoom = (p: { x: number; z: number }) => pointInPolygon({ x: p.x, y: -p.z }, KITCHEN);
const add = (items: Placed[], op: object, v = view()) => applyFurnishOps(items, [{ op: "add", ...op }], v);

describe("applyFurnishOps: add", () => {
  it("places an item at every anchor inside the room, on the floor", () => {
    for (const at of ["point", "front", "center", "wall"] as const) {
      const r = add([], { name: "stove", at }, view({ point: { x: 5, y: 0.8, z: 2 } }));
      expect(r.rejected).toEqual([]);
      expect(inRoom(r.value[0].pos), at).toBe(true);
      expect(r.value[0].pos.y).toBe(0);
    }
  });

  it("puts a clicked point that lies outside the room back inside", () => {
    const r = add([], { name: "sofa", at: "point" }, view({ point: { x: 20, y: 0, z: -9 } }));
    expect(inRoom(r.value[0].pos)).toBe(true);
  });

  it("backs a wall item onto the nearest wall, facing into the room", () => {
    const [s] = add([], { name: "fridge", at: "wall" }).value;
    // Camera at x 7.09 looking -x: front point x≈5.4 → nearest wall is z = -0.47 or 2.85; the item sits ~d/2 off it.
    const offWall = Math.min(Math.abs(-s.pos.z - 0.47), Math.abs(-s.pos.z + 2.85), Math.abs(s.pos.x - 4.35), Math.abs(s.pos.x - 7.89));
    expect(offWall).toBeCloseTo(s.size.d / 2 + 0.03, 2);
  });

  it("uses typical sizes, flags unknown ones as approximate, clamps given ones", () => {
    const r = add([], { name: "stove" });
    expect(r.value[0].size).toEqual(typicalSize("stove").size);
    expect(r.value[0].approxSize).toBe(false);
    expect(add([], { name: "espresso grinder" }).value[0].approxSize).toBe(true);
    expect(add([], { name: "big thing", size: { w: 40, d: 0, h: -1 } }).value[0].size).toEqual({ w: 6, d: 0.1, h: 0.1 });
  });

  it("adds counted copies side by side with unique ids and selects the last", () => {
    const r = add([], { name: "bar stool", count: 3 });
    expect(r.value.map((p) => p.id)).toEqual(["f1", "f2", "f3"]);
    expect(new Set(r.value.map((p) => `${p.pos.x.toFixed(2)},${p.pos.z.toFixed(2)}`)).size).toBe(3);
    expect(r.selected).toBe("f3");
    expect(r.value.every((x) => inRoom(x.pos))).toBe(true);
  });

  it("new items don't land on top of existing ones", () => {
    let items: Placed[] = [];
    for (let i = 0; i < 12; i++) items = add(items, { name: "chair" }, view({ room: undefined })).value;
    const pts = items.map((p) => p.pos);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z)).toBeGreaterThan(0.5);
  });

  it("front uses the visible floor point when the browser gives one", () => {
    const r = add([], { name: "chair" }, view({ ahead: { x: 6, y: 0.3, z: 1 } }));
    expect(r.value[0].pos).toEqual({ x: 6, y: 0, z: 1 });
  });

  it("works with no room polygon (unaligned sweep)", () => {
    const r = add([], { name: "chair", at: "center" }, view({ room: undefined }));
    expect(r.value[0].pos).toEqual({ x: 7.09 - (1.2 + 0.55 / 2), y: 0, z: 1.05 });
  });
});

describe("applyFurnishOps: edits and rejects", () => {
  const base = add([], { name: "sofa" }).value;
  it("moves, rotates, recolors, swaps and removes by id", () => {
    let items = applyFurnishOps(base, [{ op: "move", id: "f1", at: "point" }], view({ point: { x: 5, y: 0, z: 1 } })).value;
    expect(items[0].pos).toEqual({ x: 5, y: 0, z: 1 });
    items = applyFurnishOps(items, [{ op: "rotate", id: "f1", degrees: -180 }], view()).value;
    expect(items[0].rotY).toBe((base[0].rotY + 180) % 360);
    items = applyFurnishOps(items, [{ op: "recolor", id: "f1", color: "navy" }], view()).value;
    expect(items[0].color).toBe("#1f2f5a");
    items = applyFurnishOps(items, [{ op: "recolor", id: "f1", material: "leather" }], view()).value;
    expect(items[0]).toMatchObject({ material: "leather", color: undefined });
    items = applyFurnishOps(items, [{ op: "swap", id: "f1", name: "sectional" }], view()).value;
    expect(items[0]).toMatchObject({ name: "sectional", terms: ["sectional"], model: undefined });
    const r = applyFurnishOps(items, [{ op: "remove", id: "f1" }], view({ selected: "f1" }));
    expect(r.value).toEqual([]);
    expect(r.selected).toBeUndefined();
  });

  it("rejects unknown ids, bad colors and materials, malformed ops and too many ops, each with a reason", () => {
    const r = applyFurnishOps(base, [
      { op: "remove", id: "f9" }, { op: "recolor", id: "f1", color: "blurple" }, { op: "recolor", id: "f1", material: "cheese" },
      { op: "teleport", id: "f1" }, { op: "recolor", id: "f1" }, { op: "add", name: "<script>" },
    ], view());
    expect(r.applied).toEqual([]);
    expect(r.rejected).toHaveLength(6);
    expect(r.rejected.every((x) => x.reason.length > 5)).toBe(true);
    const many = applyFurnishOps([], Array.from({ length: 12 }, (_, i) => ({ op: "add", name: `chair ${i}` })), view());
    expect(many.value).toHaveLength(10);
    expect(many.rejected).toHaveLength(2);
  });

  it("never mutates its input", () => {
    const copy = structuredClone(base);
    applyFurnishOps(base, [{ op: "rotate", id: "f1", degrees: 45 }, { op: "remove", id: "f1" }], view());
    expect(base).toEqual(copy);
  });
});

describe("helpers", () => {
  it("keepInside pulls points in from outside and from too close to a wall", () => {
    expect(pointInPolygon(keepInside({ x: 100, y: 100 }, 0.5, KITCHEN), KITCHEN)).toBe(true);
    const p = keepInside({ x: 4.4, y: -1 }, 0.5, KITCHEN);
    expect(p.x).toBeCloseTo(4.85, 5);
  });
  it("place faces the camera for front items", () => {
    // Camera looks -x, so the item faces +x: yaw 90°.
    expect(place({ w: 1, d: 1, h: 1 }, "front", view()).rotY).toBeCloseTo(90, 5);
  });
  it("scaleFor matches height unless the footprint would overflow", () => {
    expect(scaleFor({ x: 0.45, y: 0.674, z: 0.55 }, typicalSize("stove").size)).toBeCloseTo(0.91 / 0.674, 3);
    expect(scaleFor({ x: 2, y: 0.5, z: 1 }, { w: 1, d: 1, h: 1 })).toBe(0.5);
  });
  it("matchesTerms needs every word of one term", () => {
    expect(matchesTerms("Kitchen Stove", ["commercial range", "stove"])).toBe(true);
    expect(matchesTerms("Hostel", ["host stand", "podium"])).toBe(false);
    expect(matchesTerms("Hotel", ["host stand"])).toBe(false);
    expect(matchesTerms("Bar Stools", ["bar stool"])).toBe(true);
  });
  it("clampSize bounds every dimension to 0.1–6 m", () => {
    expect(clampSize({ w: NaN, d: 7, h: 0.01 })).toEqual({ w: 0.1, d: 6, h: 0.1 });
  });
});

describe("hitItem", () => {
  const item = (id: string, x: number, z: number, rotY = 0, size = { w: 2, d: 0.5, h: 1 }): Placed => ({ id, name: id, terms: [id], size, approxSize: false, pos: { x, y: 0, z }, rotY });
  const eye = { x: 0, y: 1.5, z: 0 };
  const toward = (x: number, y: number, z: number) => { const l = Math.hypot(x - eye.x, y - eye.y, z - eye.z); return { x: (x - eye.x) / l, y: (y - eye.y) / l, z: (z - eye.z) / l }; };
  it("hits the box the item occupies and picks the nearest", () => {
    const items = [item("far", 0, -6), item("near", 0, -3)];
    expect(hitItem(eye, toward(0, 0.5, -3), items)).toBe("near");
    expect(hitItem(eye, toward(0, 0.5, -6), [items[0]])).toBe("far");
  });
  it("misses beside, above and behind the camera", () => {
    const items = [item("a", 0, -3)];
    expect(hitItem(eye, toward(3, 0.5, -3), items)).toBeNull();
    expect(hitItem(eye, toward(0, 1.4, -3), items)).toBeNull(); // passes over the 1 m top
    expect(hitItem(eye, toward(0, 0.5, 3), items)).toBeNull();
  });
  it("respects rotation: a long thin item turned 90° is hit along its new long side", () => {
    // 2 m wide along x; turned 90°, it runs along z. A ray to (0.8, 0.5, -3) misses it turned, hits it straight.
    expect(hitItem(eye, toward(0.8, 0.5, -3), [item("a", 0, -3, 0)])).toBe("a");
    expect(hitItem(eye, toward(0.8, 0.5, -3), [item("a", 0, -3, 90)])).toBeNull();
  });
});

describe("walls, rooms and ceilings", () => {
  const WHEELCHAIR = { w: 0.65, d: 1.05, h: 0.9 };
  const allIn = (pos: { x: number; z: number }, size: typeof WHEELCHAIR, rotY: number, poly = KITCHEN) => corners({ x: pos.x, y: 0, z: pos.z }, size, rotY).every((c) => pointInPolygon(c, poly));

  it("a wheelchair centered 10 cm from a wall ends fully inside, with clearance", () => {
    // Kitchen wall at plan x = 4.35; center 10 cm in → most of the chair would be in the wall.
    const p = settle({ x: 4.45, y: 0, z: 1 }, WHEELCHAIR, 0, view());
    expect(allIn(p, WHEELCHAIR, 0)).toBe(true);
    expect(p.x - WHEELCHAIR.w / 2).toBeGreaterThanOrEqual(4.35 + 0.029);
  });

  it("checks the rotated footprint: a sofa turned 90° near a wall is pushed by its length, not its depth", () => {
    const SOFA = { w: 2.1, d: 0.9, h: 0.85 };
    // Against the x = 4.35 wall: unturned, the 2.1 m length runs along x (needs half the length); turned 90°, only the depth.
    const along = settle({ x: 4.6, y: 0, z: 1.2 }, SOFA, 0, view());
    expect(allIn(along, SOFA, 0)).toBe(true);
    expect(along.x).toBeCloseTo(4.35 + 1.05 + 0.03, 2);
    const turned = settle({ x: 4.6, y: 0, z: 1.2 }, SOFA, 90, view());
    expect(allIn(turned, SOFA, 90)).toBe(true);
    expect(turned.x).toBeCloseTo(4.35 + 0.45 + 0.03, 2);
  });

  it("works in a corner of an L-shaped room and never loops forever on an item too big for the room", () => {
    const L = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }];
    const p = keepRectInside({ x: 3.9, y: 1.95 }, { w: 1, d: 1, h: 1 }, 0, L);
    expect(corners({ x: p.x, y: 0, z: -p.y }, { w: 1, d: 1, h: 1 }, 0).every((c) => pointInPolygon(c, L))).toBe(true);
    expect(keepRectInside({ x: 1, y: 1 }, { w: 20, d: 20, h: 1 }, 0, L)).toBeDefined();
  });

  it("keeps an item in the room it is in, not the camera's room", () => {
    const NEXT = [{ x: 7.89, y: -2.85 }, { x: 11, y: -2.85 }, { x: 11, y: 0.47 }, { x: 7.89, y: 0.47 }];
    const v = view({ rooms: [{ id: "k", label: "kitchen", polygon: KITCHEN }, { id: "n", label: "office", polygon: NEXT }] });
    const p = settle({ x: 9.5, y: 0, z: 1 }, WHEELCHAIR, 0, v);
    expect(pointInPolygon({ x: p.x, y: -p.z }, NEXT)).toBe(true);
  });

  it("caps height under the ceiling, proportionally", () => {
    const c = underCeiling({ w: 1, d: 0.5, h: 3 }, 2.45);
    expect([c.w, c.d, c.h].map((n) => +n.toFixed(6))).toEqual([0.8, 0.4, 2.4]);
    expect(underCeiling({ w: 1, d: 0.5, h: 1 }, 2.45)).toEqual({ w: 1, d: 0.5, h: 1 });
    const r = applyFurnishOps([], [{ op: "add", name: "tree", size: { w: 1, d: 1, h: 3 } }], view({ room: { id: "k", label: "kitchen", polygon: KITCHEN, ceiling: 2.45 } }));
    expect(r.value[0].size.h).toBeCloseTo(2.4, 5);
  });

  it("resizes proportionally from one dimension or a factor, using the rendered size", () => {
    const [chair] = add([], { name: "wheelchair" }).value;
    const fitted = { ...chair, fitted: { w: 0.6, d: 1.0, h: 0.9 } };
    const r = applyFurnishOps([fitted], [{ op: "resize", id: chair.id, w: 0.762 }], view()).value[0]; // 30 inches wide
    expect(r.fitted!.w).toBeCloseTo(0.762, 5);
    expect(r.fitted!.h / r.fitted!.w).toBeCloseTo(0.9 / 0.6, 5);
    expect(r.size.h / r.size.w).toBeCloseTo(chair.size.h / chair.size.w, 5);
    expect(applyFurnishOps([fitted], [{ op: "resize", id: chair.id, scale: 1.2 }], view()).value[0].fitted!.h).toBeCloseTo(1.08, 5);
    expect(applyFurnishOps([fitted], [{ op: "resize", id: chair.id }], view()).rejected).toHaveLength(1);
  });

  it("formats feet and inches", () => {
    expect(ftIn(0.762)).toBe("2′ 6″");
    expect(ftIn(0.9144)).toBe("3′");
    expect(ftIn(0.2)).toBe("8″");
  });
});

describe("Matterport measurements", () => {
  const stove = (): Placed => ({ id: "f1", name: "stove", terms: ["stove"], size: { w: 0.76, d: 0.66, h: 0.91 }, approxSize: false, pos: { x: 6, y: 0, z: 1 }, rotY: 0, fitted: { w: 0.7, d: 0.66, h: 0.91 } });

  it("draws width, depth, height and wall-gap lines labeled in feet and inches", () => {
    const lines = dimensionLines(stove(), view());
    expect(lines.map((l) => l.label)).toEqual(["W 2′ 4″", "D 2′ 2″", "H 3′", expect.stringMatching(/to wall$/)]);
    const [w, , h] = lines;
    expect(Math.hypot(w.points[1].x - w.points[0].x, w.points[1].z - w.points[0].z)).toBeCloseTo(0.7, 5);
    expect(h.points[1].y - h.points[0].y).toBeCloseTo(0.91, 5);
  });

  it("matches a horizontal measurement: width = its length, proportional, along the line, centered, inside", () => {
    // A 30-inch gap measured along z (a counter run), camera on the +x side.
    const m = fromMeasurement(stove(), { x: 5, y: 0.9, z: 0.5 }, { x: 5, y: 0.9, z: 1.262 }, view({ camera: { x: 7, y: 1.4, z: 1 } }))!;
    const r = applyFurnishOps([stove()], m.ops, view({ camera: { x: 7, y: 1.4, z: 1 }, point: m.point })).value[0];
    expect(r.fitted!.w).toBeCloseTo(0.762, 4);
    expect(r.fitted!.h / r.fitted!.w).toBeCloseTo(0.91 / 0.7, 4);
    // Width along z means local x → world z: yaw ±90; its front faces the camera (+x).
    expect(Math.sin((r.rotY * Math.PI) / 180)).toBeCloseTo(1, 4);
    expect(r.pos.z).toBeCloseTo(0.881, 3);
    expect(corners(r.pos, r.fitted!, r.rotY).every((c) => pointInPolygon(c, KITCHEN))).toBe(true);
  });

  it("a vertical measurement sets the height; tiny lines are ignored", () => {
    expect(fromMeasurement(stove(), { x: 5, y: 0, z: 1 }, { x: 5, y: 0.8, z: 1.05 }, view())!.ops).toEqual([{ op: "resize", id: "f1", h: expect.closeTo(0.8, 5) }]);
    expect(fromMeasurement(stove(), { x: 5, y: 0, z: 1 }, { x: 5.01, y: 0, z: 1 }, view())).toBeNull();
  });
});
