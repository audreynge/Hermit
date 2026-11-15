import { Box3, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { fitModel } from "./fit";
import { glbBounds, glbHeaderLength } from "./glb";

// Applies a Fit to the source bounds the way the scene does (rotate, scale, offset) and returns the result.
function rendered(b: { min: number[]; max: number[] }, target: { w: number; d: number; h: number }) {
  const f = fitModel({ min: { x: b.min[0], y: b.min[1], z: b.min[2] }, max: { x: b.max[0], y: b.max[1], z: b.max[2] } }, target)!;
  const m = new Matrix4().compose(new Vector3(f.position.x, f.position.y, f.position.z), new Quaternion().setFromEuler(new Euler(f.rotation.x, f.rotation.y, f.rotation.z, "XYZ")), new Vector3(f.scale, f.scale, f.scale));
  const box = new Box3(new Vector3(...b.min), new Vector3(...b.max)).applyMatrix4(m);
  return { f, size: box.getSize(new Vector3()), box };
}

describe("fitModel", () => {
  it("handles centimeter models with an offset base (the Sketchfab trash can)", () => {
    const { f, size, box } = rendered({ min: [-178.5, 1.444, -179.4], max: [190.8, 302.4, 178.6] }, { w: 0.4, d: 0.4, h: 0.65 });
    expect(size.y).toBeCloseTo(0.65, 5);
    expect(box.min.y).toBeCloseTo(0, 5); // stands on the floor
    expect(Math.abs((box.min.x + box.max.x) / 2)).toBeLessThan(1e-6); // centered on its spot
    expect(f.fitted.w).toBeCloseTo(size.x, 5);
    expect(f.error).toBeLessThan(0.4); // a squat bin: wider than a typical one, so ranking prefers slimmer models
  });

  it("turns a normalized wheelchair so its long side runs front-to-back", () => {
    // 1.34 wide, 1.98 tall, 2.0 deep in a 2-unit cube.
    const { size } = rendered({ min: [-0.67, -0.99, -1], max: [0.67, 0.99, 1] }, { w: 0.65, d: 1.05, h: 0.9 });
    expect(size.y).toBeCloseTo(0.9, 5);
    expect(size.z).toBeGreaterThan(size.x);
  });

  it("stands up a model exported lying down (Z-up bookshelf)", () => {
    // Authored with its height along z: 0.9 wide (x), 0.35 deep (y), 1.8 tall (z).
    const { f, size } = rendered({ min: [0, 0, 0], max: [0.9, 0.35, 1.8] }, { w: 0.9, d: 0.35, h: 1.8 });
    expect(size.y).toBeCloseTo(1.8, 5);
    expect(f.error).toBeLessThan(0.05);
  });

  it("swaps width and depth when the model faces sideways", () => {
    const { size } = rendered({ min: [0, 0, 0], max: [0.9, 0.85, 2.1] }, { w: 2.1, d: 0.9, h: 0.85 });
    expect(size.x).toBeCloseTo(2.1, 5);
    expect(size.z).toBeCloseTo(0.9, 5);
  });

  it("keeps the authored orientation when it's about as good", () => {
    const { f } = rendered({ min: [0, 0, 0], max: [1, 1, 1] }, { w: 1, d: 1, h: 1 });
    expect(f.rotation).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("reports a large error when proportions can't match (a flat scene for a tall item)", () => {
    const { f } = rendered({ min: [0, 0, 0], max: [10, 0.1, 10] }, { w: 0.4, d: 0.4, h: 0.65 });
    expect(f.error).toBeGreaterThan(0.69);
  });

  it("returns null for degenerate bounds", () => {
    expect(fitModel({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 1, z: 1 } }, { w: 1, d: 1, h: 1 })).toBeNull();
  });
});

// A minimal GLB: header + JSON chunk (the binary chunk isn't needed for bounds).
function glb(json: object): Uint8Array {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(20 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true);
  v.setUint32(12, body.length, true); v.setUint32(16, 0x4e4f534a, true);
  out.set(body, 20);
  return out;
}

describe("glbBounds", () => {
  const accessors = [{ min: [-1, 0, -1], max: [1, 2, 1] }];
  const meshes = [{ primitives: [{ attributes: { POSITION: 0 } }] }];

  it("applies nested node transforms (scale under a translated parent)", () => {
    const b = glbBounds(glb({ scene: 0, scenes: [{ nodes: [0] }], nodes: [{ translation: [0, 5, 0], children: [1] }, { scale: [100, 100, 100], mesh: 0 }], meshes, accessors }))!;
    expect(b.min).toEqual({ x: -100, y: 5, z: -100 });
    expect(b.max).toEqual({ x: 100, y: 205, z: 100 });
  });

  it("unions several meshes and honors a node matrix", () => {
    const b = glbBounds(glb({ scenes: [{ nodes: [0, 1] }], nodes: [{ mesh: 0 }, { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1] }], meshes, accessors }))!;
    expect(b.min.x).toBe(-1);
    expect(b.max.x).toBe(11);
  });

  it("needs the whole JSON chunk and rejects non-GLB data", () => {
    const full = glb({ scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes, accessors });
    expect(glbHeaderLength(full.subarray(0, 20))).toBe(full.length);
    expect(glbBounds(full.subarray(0, 30))).toBeNull();
    expect(glbBounds(new TextEncoder().encode("<html>not a model</html>"))).toBeNull();
    expect(glbBounds(glb({ scenes: [{ nodes: [] }] }))).toBeNull();
  });
});
