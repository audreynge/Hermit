import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { Size } from "./catalog";
import { axisPenalty, fitModel } from "./fit";
import { parseFurnish } from "./offline";
import { applyFurnishOps, dims, hitItem, type Placed, type View } from "./ops";
import { migrate, orient, pose, quarter, tipped } from "./orient";

const size = { w: 2, d: 1, h: 0.5 }; // a low, wide piece: easy to tell the axes apart

// Renders an item's local box (x ±w/2, y 0..h, z ±d/2) the way the scene does: node at pose().position, turned by
// pose().rotation in "YXZ" order. Returns the world bounding box.
function rendered(s: Size, tilt: { pitch?: number; roll?: number }, pos = { x: 3, y: 1, z: -2 }, rotY = 0) {
  const t = pose(s, tilt, pos, rotY);
  const m = new Matrix4().compose(new Vector3(t.position.x, t.position.y, t.position.z), new Quaternion().setFromEuler(new Euler(t.rotation.x, t.rotation.y, t.rotation.z, "YXZ")), new Vector3(1, 1, 1));
  return new Box3(new Vector3(-s.w / 2, 0, -s.d / 2), new Vector3(s.w / 2, s.h, s.d / 2)).applyMatrix4(m);
}
// Where a local point (in the item's own frame) ends up, for checking which way the item tips.
function worldOf(local: Vector3, tilt: { pitch?: number; roll?: number }, rotY = 0) {
  const t = pose(size, tilt, { x: 0, y: 0, z: 0 }, rotY);
  return local.clone().applyEuler(new Euler(t.rotation.x, t.rotation.y, t.rotation.z, "YXZ")).add(new Vector3(t.position.x, t.position.y, t.position.z));
}

describe("quarter", () => {
  it("snaps any angle to a quarter turn in [0, 360)", () => {
    expect([0, 90, 180, 270, 360, -90, 100, 200, 450, undefined, NaN].map(quarter)).toEqual([0, 90, 180, 270, 0, 270, 90, 180, 90, 0, 0]);
  });
});

describe("orient (the tipped box)", () => {
  it("leaves an upright item alone", () => {
    expect(orient(size)).toEqual({ size, offset: { x: 0, y: 0, z: 0 } });
  });
  it("flipped upright (180° about x) keeps its extents and is lifted by its height", () => {
    const o = orient(size, 180, 0);
    expect(o.size).toEqual(size);
    expect(o.offset.y).toBeCloseTo(0.5);
  });
  it("tipped forward (90° about x) trades depth for height", () => {
    const o = orient(size, 90, 0).size;
    expect(o.w).toBeCloseTo(2); expect(o.d).toBeCloseTo(0.5); expect(o.h).toBeCloseTo(1);
  });
  it("tipped onto its side (90° about z) trades width for height", () => {
    const o = orient(size, 0, 90).size;
    expect(o.w).toBeCloseTo(0.5); expect(o.d).toBeCloseTo(1); expect(o.h).toBeCloseTo(2);
  });
  it("a flip and a flip back is the identity", () => {
    expect(tipped(tipped({}, "x", 180), "x", 180)).toEqual({ pitch: 0, roll: 0 });
    expect(tipped({ pitch: 90, roll: 270 }, "z", 90)).toEqual({ pitch: 90, roll: 0 });
    expect(tipped({ pitch: 0 }, "x", -90)).toEqual({ pitch: 270, roll: 0 });
  });
});

describe("pose (what the scene renders)", () => {
  for (const [pitch, roll] of [[0, 0], [90, 0], [180, 0], [270, 0], [0, 90], [0, 180], [0, 270], [90, 90], [180, 270], [270, 180]]) {
    for (const rotY of [0, 90, 37]) {
      it(`sits on the floor, centered on its spot (pitch ${pitch}, roll ${roll}, yaw ${rotY})`, () => {
        const b = rendered(size, { pitch, roll }, { x: 3, y: 1, z: -2 }, rotY);
        expect(b.min.y).toBeCloseTo(1, 6); // on the floor: not through it, not floating
        expect((b.min.x + b.max.x) / 2).toBeCloseTo(3, 6);
        expect((b.min.z + b.max.z) / 2).toBeCloseTo(-2, 6);
        expect(b.max.y - b.min.y).toBeCloseTo(orient(size, pitch, roll).size.h, 6);
        if (rotY === 0) { // and the rendered box is exactly the tipped size the footprint uses
          const o = orient(size, pitch, roll).size;
          expect(b.max.x - b.min.x).toBeCloseTo(o.w, 6); expect(b.max.z - b.min.z).toBeCloseTo(o.d, 6);
        }
      });
    }
  }
  it("flip upright puts the top at the bottom", () => {
    expect(worldOf(new Vector3(0, size.h, 0), { pitch: 180 }).y).toBeCloseTo(0);
    expect(worldOf(new Vector3(0, 0, 0), { pitch: 180 }).y).toBeCloseTo(size.h);
  });
  it("tip forward sends the top toward the item's front (local +z, turned by the yaw)", () => {
    const top = worldOf(new Vector3(0, size.h, 0), { pitch: 90 });
    expect(top.z).toBeGreaterThan(0.1);
    const turned = worldOf(new Vector3(0, size.h, 0), { pitch: 90 }, 90); // yaw 90: the front faces world +x
    expect(turned.x).toBeGreaterThan(0.1);
  });
});

const room = { id: "r", label: "office", polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], ceiling: 2.4 };
const view: View = { camera: { x: 2, y: 1.5, z: -2 }, forward: { x: 0, z: -1 }, floorY: 0.2, room, rooms: [room] };
const shelf: Placed = { id: "f1", name: "bookshelf", terms: ["bookshelf"], size: { w: 1, d: 0.4, h: 2 }, approxSize: false, pos: { x: 3.6, y: 0.2, z: -2 }, rotY: 0 };
const tip = (p: Placed, axis: "x" | "z", degrees: number, v = view) => applyFurnishOps([p], [{ op: "tip", id: p.id, axis, degrees }], v);

describe("tip op", () => {
  it("flips upright in one step and back, keeping everything else", () => {
    const once = tip(shelf, "x", 180).value[0];
    expect(once).toMatchObject({ pitch: 180, roll: 0, rotY: 0, size: shelf.size });
    expect(dims(once)).toEqual(dims(shelf));
    const twice = tip(once, "x", 180).value[0];
    expect(twice.pitch).toBe(0);
    expect(twice.pos).toEqual(once.pos);
  });

  it("re-settles a tipped item inside its room using its tipped footprint, at its height", () => {
    // On its side the shelf is 2 m wide; at x = 3.6 it would poke 0.6 m through the east wall.
    const p = tip(shelf, "z", 90).value[0];
    expect(p.roll).toBe(90);
    expect(dims(p).w).toBeCloseTo(2); expect(dims(p).h).toBeCloseTo(1);
    expect(p.pos.x + dims(p).w / 2).toBeLessThanOrEqual(4);
    expect(p.pos.x - dims(p).w / 2).toBeGreaterThanOrEqual(0);
    expect(p.pos.y).toBeCloseTo(0.2); // still on the floor: the scene lifts the tipped box by its own offset
  });

  it("keeps an item standing on another piece at that height (a lamp on a table)", () => {
    const lamp: Placed = { id: "f2", name: "table lamp", terms: ["lamp"], size: { w: 0.3, d: 0.3, h: 0.5 }, approxSize: false, pos: { x: 2, y: 0.95, z: -2 }, rotY: 30, planned: true };
    const p = tip(lamp, "x", 180).value[0];
    expect(p.pos.y).toBeCloseTo(0.95);
    const b = rendered(p.size, p, p.pos, p.rotY);
    expect(b.min.y).toBeCloseTo(0.95, 6); // its bottom on the table top, flipped or not
  });

  it("scales a piece down if standing it up would poke through the ceiling", () => {
    const lying: Placed = { ...shelf, size: { w: 1, d: 3, h: 0.4 }, pos: { x: 2, y: 0.2, z: -2 } };
    const p = tip(lying, "x", 90).value[0]; // 3 m deep → 3 m tall, under a 2.4 m ceiling
    expect(dims(p).h).toBeLessThanOrEqual(2.35 + 1e-9);
  });

  it("picking hits the tipped box where it's drawn", () => {
    const p = tip(shelf, "z", 90).value[0]; // 2 m wide, 1 m tall
    const at = (y: number) => hitItem({ x: p.pos.x, y, z: p.pos.z + 5 }, { x: 0, y: 0, z: -1 }, [p]);
    expect(at(0.2 + 0.5)).toBe("f1");
    expect(at(0.2 + 1.5)).toBeNull(); // above it now that it lies on its side
  });

  it("rejects tips that aren't quarter turns", () => {
    const r = tip(shelf, "x", 45);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });

  it("swapping to another model drops the old model's tip", () => {
    const flipped = tip(shelf, "x", 180).value[0];
    const p = applyFurnishOps([flipped], [{ op: "swap", id: "f1", name: "cabinet" }], view).value[0];
    expect(p).toMatchObject({ pitch: 0, roll: 0 });
  });
});

describe("tip by chat (offline parser)", () => {
  const sofa: Placed = { id: "f2", name: "sofa", terms: ["sofa"], size: { w: 2, d: 0.9, h: 0.8 }, approxSize: false, pos: { x: 0, y: 0, z: 0 }, rotY: 0 };
  const flip = { ops: [{ op: "tip", id: "f2", axis: "x", degrees: 180 }] };
  it("maps flip wording to the flip, not a spin", () => {
    for (const t of ["the sofa is upside down", "it's upside down", "flip it upright", "Flip it upright please", "stand it up", "flip it over", "flip the sofa", "turn it right side up", "set it upright"]) {
      expect(parseFurnish(t, [sofa], "f2"), t).toEqual(flip);
    }
  });
  it("still spins for turning around", () => {
    expect(parseFurnish("turn it around", [sofa], "f2")).toEqual({ ops: [{ op: "rotate", id: "f2", degrees: 180 }] });
    expect(parseFurnish("flip it around", [sofa], "f2")).toEqual({ ops: [{ op: "rotate", id: "f2", degrees: 180 }] });
    expect(parseFurnish("rotate it 90 degrees", [sofa], "f2")).toEqual({ ops: [{ op: "rotate", id: "f2", degrees: 90 }] });
  });
  it("tips forward, back and onto its side", () => {
    expect(parseFurnish("tip it forward", [sofa], "f2")).toEqual({ ops: [{ op: "tip", id: "f2", axis: "x", degrees: 90 }] });
    expect(parseFurnish("tip it back", [sofa], "f2")).toEqual({ ops: [{ op: "tip", id: "f2", axis: "x", degrees: -90 }] });
    expect(parseFurnish("lay it on its side", [sofa], "f2")).toEqual({ ops: [{ op: "tip", id: "f2", axis: "z", degrees: 90 }] });
  });
  it("doesn't take an upright piano or a stand-up desk for a flip", () => {
    expect(parseFurnish("add an upright piano", [sofa], "f2")).toMatchObject({ ops: [{ op: "add" }] });
    expect(parseFurnish("add a stand up desk", [sofa], "f2")).toMatchObject({ ops: [{ op: "add" }] });
  });
});

describe("migrate (saved furniture)", () => {
  const old = { id: "f1", name: "chair", terms: ["chair"], size: { w: 0.5, d: 0.5, h: 0.9 }, approxSize: false, pos: { x: 0, y: 0, z: 0 }, rotY: 30 };
  it("gives saves from before tipping pitch and roll 0, keeping the yaw", () => {
    expect(migrate<Placed>([old])[0]).toEqual({ ...old, pitch: 0, roll: 0 });
  });
  it("keeps saved tips, snapped to quarter turns", () => {
    expect(migrate<Placed>([{ ...old, pitch: 180, roll: 90 }])[0]).toMatchObject({ pitch: 180, roll: 90, rotY: 30 });
    expect(migrate<Placed>([{ ...old, pitch: 170, roll: -90 }])[0]).toMatchObject({ pitch: 180, roll: 270 });
  });
  it("survives junk: nothing saved, not a list, or entries that aren't 3D items", () => {
    expect(migrate(null)).toEqual([]);
    expect(migrate({ a: 1 })).toEqual([]);
    expect(migrate([null, 3, { id: "p1", roomId: "r", type: "desk", x: 1, y: 2, w: 1, h: 1 }, { ...old, rotY: "x" }])).toEqual([{ ...old, rotY: 0, pitch: 0, roll: 0 }]);
  });
  it("round-trips through JSON (what localStorage holds)", () => {
    const flipped = tip({ ...shelf, pos: { x: 2, y: 0.2, z: -2 } }, "x", 180).value[0];
    expect(migrate<Placed>(JSON.parse(JSON.stringify([flipped])))[0]).toEqual(flipped);
  });
});

describe("auto-upright on load", () => {
  const upright = (b: { x: number; y: number; z: number }, target: Size) => {
    const f = fitModel({ min: { x: 0, y: 0, z: 0 }, max: b }, target)!;
    const m = new Matrix4().makeRotationFromEuler(new Euler(f.rotation.x, f.rotation.y, f.rotation.z, "XYZ"));
    return new Box3(new Vector3(0, 0, 0), new Vector3(b.x, b.y, b.z)).applyMatrix4(m).getSize(new Vector3());
  };
  it("penalizes only clear cases: a tall item lying down, a flat one on its edge", () => {
    expect(axisPenalty({ w: 0.6, d: 0.4, h: 1.8 }, { x: 0.6, y: 0.4, z: 1.8 })).toBeGreaterThan(0);
    expect(axisPenalty({ w: 0.6, d: 0.4, h: 1.8 }, { x: 0.6, y: 1.8, z: 0.4 })).toBe(0);
    expect(axisPenalty({ w: 2, d: 3, h: 0.02 }, { x: 2, y: 3, z: 0.02 })).toBeGreaterThan(0);
    expect(axisPenalty({ w: 0.5, d: 0.5, h: 0.5 }, { x: 0.5, y: 0.2, z: 0.9 })).toBe(0); // neither: the footprint decides
    expect(axisPenalty({ w: 1, d: 2, h: 0.5 }, { x: 0.9, y: 1.0, z: 2.0 })).toBe(0); // a bed with a tall headboard stays a bed
  });
  it("stands a floor lamp exported on its side upright", () => {
    expect(upright({ x: 1.6, y: 0.4, z: 0.4 }, { w: 0.4, d: 0.4, h: 1.6 }).y).toBeCloseTo(1.6, 5);
  });
  it("stands a tall cabinet up even when its proportions don't match the catalog (the footprint alone kept it lying down)", () => {
    // Longest axis x; lying with 1.0 up, its footprint matched the 1.2 × 1.5 target better than standing did.
    expect(upright({ x: 1.9, y: 1.0, z: 0.6 }, { w: 1.2, d: 1.5, h: 2.0 }).y).toBeCloseTo(1.9, 5);
  });
  it("lays a rug exported standing on its edge flat", () => {
    expect(upright({ x: 2, y: 3, z: 0.02 }, { w: 2, d: 3, h: 0.02 }).y).toBeCloseTo(0.02, 5);
  });
});
