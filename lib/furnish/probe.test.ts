import { describe, expect, it } from "vitest";
import { classify, inFootprint, samplePoints, type Footprint, type Sample } from "./probe";

const FLOOR = 0.2;
const table: Footprint = { pos: { x: 3, y: FLOOR, z: -1 }, size: { w: 1.6, d: 0.9, h: 0.75 }, rotY: 30 };
const pts = samplePoints(table, FLOOR);
// Each sample point gets the hit its ray returned.
const probe = (hit: (at: Sample["at"], i: number) => Sample["hit"]): Sample[] => pts.map((at, i) => ({ at, hit: hit(at, i) }));

describe("samplePoints", () => {
  it("gives 13 floor-height points, all inside the rotated footprint", () => {
    expect(pts).toHaveLength(13);
    for (const p of pts) {
      expect(p.y).toBe(FLOOR);
      expect(inFootprint(p, table, 0)).toBe(true);
    }
  });

  it("keeps corners off the edge so a wall-flush piece doesn't sample the wall", () => {
    for (const p of pts) expect(inFootprint(p, table, -0.05)).toBe(true);
  });

  it("knows a point just outside the rotated footprint from one inside", () => {
    expect(inFootprint({ x: 3, y: 0, z: -1 }, table)).toBe(true);
    expect(inFootprint({ x: 3 + 1.2, y: 0, z: -1 }, table)).toBe(false); // 1.04 m along the turned width axis, past 0.8 + 0.05
  });
});

describe("classify", () => {
  it("passes a spot where every ray reaches the floor", () => {
    expect(classify(FLOOR, table, probe((at) => at))).toEqual({ blocked: false, unknown: 0 });
  });

  it("blocks a spot under a kitchen counter", () => {
    // Counter top at 0.9 m over the whole footprint: the ray stops a little toward the camera, still inside.
    const r = classify(FLOOR, table, probe((at) => ({ x: at.x + 0.1, y: FLOOR + 0.9, z: at.z })));
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/0\.9 m/);
  });

  it("ignores one stray raised hit", () => {
    expect(classify(FLOOR, table, probe((at, i) => (i === 0 ? { ...at, y: FLOOR + 0.9 } : at))).blocked).toBe(false);
  });

  it("calls an occluded spot unknown, not blocked", () => {
    // A wall between the camera and the spot: every ray stops 2 m away, well outside the footprint.
    const r = classify(FLOOR, table, probe((at) => ({ x: at.x + 2, y: FLOOR + 1.2, z: at.z })));
    expect(r).toEqual({ blocked: false, unknown: 13 });
  });

  it("leaves points behind the camera or with no hit unknown", () => {
    expect(classify(FLOOR, table, probe(() => undefined))).toEqual({ blocked: false, unknown: 13 });
    expect(classify(FLOOR, table, probe((at, i) => (i < 5 ? null : at)))).toEqual({ blocked: false, unknown: 5 });
  });
});
