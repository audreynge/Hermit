import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { axisPenalty, fitModel } from "./fit";
import { migrate } from "./footprint";
import { parseFurnish } from "./offline";
import { applyFurnishOps, dims, orient, quarter, type Placed, type View } from "./ops";
import { pose } from "./scene";

const size = { w: 2, d: 1, h: 0.5 }; // a low, wide piece: easy to tell the axes apart

// Renders an item's local box (x ±w/2, y 0..h, z ±d/2) the way the scene does: node at pose().position, turned by
// pose().rotation in "YXZ" order. Returns the world bounding box.
function rendered(p: Pick<Placed, "size" | "pitch" | "roll">, pos = { x: 3, y: 1, z: -2 }, rotY = 0) {
  const t = pose(p, pos, rotY);
  const m = new Matrix4().compose(new Vector3(t.position.x, t.position.y, t.position.z), new Quaternion().setFromEuler(new Euler(t.rotation.x, t.rotation.y, t.rotation.z, "YXZ")), new Vector3(1, 1, 1));
  return new Box3(new Vector3(-p.size.w / 2, 0, -p.size.d / 2), new Vector3(p.size.w / 2, p.size.h, p.size.d / 2)).applyMatrix4(m);
}

describe("quarter", () => {
  it("snaps any angle to a quarter turn in [0, 360)", () => {
    expect([0, 90, 180, 270, 360, -90, 100, 200, undefined].map(quarter)).toEqual([0, 90, 180, 270, 0, 270, 90, 180, 0]);
  });
});

describe("orient", () => {
  it("leaves an upright item alone", () => {
    expect(orient(size)).toEqual({ size, offset: { x: 0, y: 0, z: 0 } });
  });
  it("flipped upright (180° about x) keeps its extents and is lifted by its height", () => {
    const o = orient(size, 180, 0);
    expect(o.size).toEqual(size);
    expect(o.offset.y).toBeCloseTo(0.5);
  });
  it("tipped forward (90° about x) trades depth for height", () => {
    const o = orient(size, 90, 0);
    expect(o.size.w).toBeCloseTo(2); expect(o.size.d).toBeCloseTo(0.5); expect(o.size.h).toBeCloseTo(1);
  });
  it("tipped sideways (90° about z) trades width for height", () => {
    const o = orient(size, 0, 90);
    expect(o.size.w).toBeCloseTo(0.5); expect(o.size.d).toBeCloseTo(1); expect(o.size.h).toBeCloseTo(2);
  });
});

describe("pose (what the scene renders)", () => {
  for (const [pitch, roll] of [[0, 0], [90, 0], [180, 0], [270, 0], [0, 90], [0, 270], [90, 90], [180, 270]]) {
    for (const rotY of [0, 90, 37]) {
      it(`stands on the floor, centered on its spot (pitch ${pitch}, roll ${roll}, yaw ${rotY})`, () => {
        const b = rendered({ size, pitch, roll }, { x: 3, y: 1, z: -2 }, rotY);
        expect(b.min.y).toBeCloseTo(1, 6); // on the floor, not through it or floating
        expect((b.min.x + b.max.x) / 2).toBeCloseTo(3, 6);
        expect((b.min.z + b.max.z) / 2).toBeCloseTo(-2, 6);
        if (rotY === 0) { // and the rendered box matches the tipped size the footprint uses
          const o = orient(size, pitch, roll).size;
          expect(b.max.x - b.min.x).toBeCloseTo(o.w, 6); expect(b.max.y - b.min.y).toBeCloseTo(o.h, 6); expect(b.max.z - b.min.z).toBeCloseTo(o.d, 6);
        }
      });
    }
  }
});

describe("tip op", () => {
  const room = { id: "r", label: "office", polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }] };
  const view: View = { camera: { x: 2, y: 1.5, z: -2 }, forward: { x: 0, z: -1 }, floorY: 0.2, room, rooms: [room] };
  const item: Placed = { id: "f1", name: "bookshelf", terms: ["bookshelf"], size: { w: 1, d: 0.4, h: 2 }, approxSize: false, pos: { x: 3.6, y: 0.2, z: -2 }, rotY: 0 };

  it("flips upright in one step and back", () => {
    const once = applyFurnishOps([item], [{ op: "tip", id: "f1", axis: "x", degrees: 180 }], view).value[0];
    expect(once.pitch).toBe(180);
    expect(applyFurnishOps([once], [{ op: "tip", id: "f1", axis: "x", degrees: 180 }], view).value[0].pitch).toBe(0);
  });

  it("re-settles a tipped item inside the room using its tipped footprint, on the floor", () => {
    // Tipped onto its side the shelf is 2 m wide; at x = 3.6 it would poke 0.6 m through the east wall.
    const r = applyFurnishOps([item], [{ op: "tip", id: "f1", axis: "z", degrees: 90 }], view);
    const p = r.value[0];
    expect(p.roll).toBe(90);
    expect(dims(p).w).toBeCloseTo(2);
    expect(p.pos.x + dims(p).w / 2).toBeLessThanOrEqual(4);
    expect(p.pos.y).toBeCloseTo(0.2);
  });

  it("rejects tips that aren't quarter turns", () => {
    const r = applyFurnishOps([item], [{ op: "tip", id: "f1", axis: "x", degrees: 45 }], view);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
  });
});

describe("tip by chat (offline parser)", () => {
  const sofa: Placed = { id: "f2", name: "sofa", terms: ["sofa"], size: { w: 2, d: 0.9, h: 0.8 }, approxSize: false, pos: { x: 0, y: 0, z: 0 }, rotY: 0 };
  it("turns 'it's upside down' into a flip, not a spin", () => {
    expect(parseFurnish("the sofa is upside down", [sofa], "f2")).toEqual({ ops: [{ op: "tip", id: "f2", axis: "x", degrees: 180 }] });
    expect(parseFurnish("flip it upright", [sofa], "f2")).toEqual({ ops: [{ op: "tip", id: "f2", axis: "x", degrees: 180 }] });
    expect(parseFurnish("turn it around", [sofa], "f2")).toEqual({ ops: [{ op: "rotate", id: "f2", degrees: 180 }] });
  });
});

describe("migrate", () => {
  it("gives old saves pitch and roll 0 and snaps odd angles", () => {
    const old = { id: "f1", name: "chair", terms: ["chair"], size: { w: 0.5, d: 0.5, h: 0.9 }, approxSize: false, pos: { x: 0, y: 0, z: 0 }, rotY: 30 };
    expect(migrate([old])[0]).toMatchObject({ rotY: 30, pitch: 0, roll: 0 });
    expect(migrate([{ ...old, pitch: 170, roll: -90 }])[0]).toMatchObject({ pitch: 180, roll: 270 });
  });
});

describe("auto-upright on load", () => {
  it("penalizes a tall item standing on a short axis, and a flat one standing on a long axis", () => {
    expect(axisPenalty({ w: 0.6, d: 0.4, h: 1.8 }, { x: 0.6, y: 0.4, z: 1.8 })).toBeGreaterThan(0);
    expect(axisPenalty({ w: 0.6, d: 0.4, h: 1.8 }, { x: 0.6, y: 1.8, z: 0.4 })).toBe(0);
    expect(axisPenalty({ w: 2, d: 3, h: 0.02 }, { x: 2, y: 3, z: 0.02 })).toBeGreaterThan(0);
    expect(axisPenalty({ w: 0.5, d: 0.5, h: 0.5 }, { x: 0.5, y: 0.2, z: 0.9 })).toBe(0); // neither: let the fit decide
  });

  it("stands a floor lamp exported on its side upright", () => {
    // Lamp lying along x: 1.6 long, 0.4 x 0.4 shade. Target: 0.4 x 0.4, 1.6 tall.
    const f = fitModel({ min: { x: 0, y: 0, z: 0 }, max: { x: 1.6, y: 0.4, z: 0.4 } }, { w: 0.4, d: 0.4, h: 1.6 })!;
    const m = new Matrix4().makeRotationFromEuler(new Euler(f.rotation.x, f.rotation.y, f.rotation.z, "XYZ"));
    const s = new Box3(new Vector3(0, 0, 0), new Vector3(1.6, 0.4, 0.4)).applyMatrix4(m).getSize(new Vector3());
    expect(s.y).toBeCloseTo(1.6, 5);
  });

  it("lays a rug exported standing on its edge flat", () => {
    const f = fitModel({ min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 3, z: 0.02 } }, { w: 2, d: 3, h: 0.02 })!;
    const m = new Matrix4().makeRotationFromEuler(new Euler(f.rotation.x, f.rotation.y, f.rotation.z, "XYZ"));
    const s = new Box3(new Vector3(0, 0, 0), new Vector3(2, 3, 0.02)).applyMatrix4(m).getSize(new Vector3());
    expect(s.y).toBeCloseTo(0.02, 5);
  });
});
