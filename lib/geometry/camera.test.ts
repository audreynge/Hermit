import { describe, expect, it } from "vitest";
import { BASE_Z, fit, MAX_Z, MIN_Z, pan, toFeet, zoomAt } from "./camera";

describe("camera", () => {
  it("zooming keeps the foot under the cursor in place and clamps to 10%-400%", () => {
    const c = { x: 5, y: -3, z: BASE_Z };
    const before = toFeet(c, 300, 200);
    const z = zoomAt(c, 1.7, 300, 200);
    const after = toFeet(z, 300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(c, 1000, 0, 0).z).toBe(MAX_Z);
    expect(zoomAt(c, 0.0001, 0, 0).z).toBe(MIN_Z);
  });

  it("pans by screen pixels and fits a box centred in the view", () => {
    expect(pan({ x: 0, y: 0, z: 10 }, 50, -20)).toEqual({ x: 5, y: -2, z: 10 });
    const c = fit({ x: 10, y: 10, x2: 60, y2: 40 }, 800, 600);
    const centre = toFeet(c, 400, 300);
    expect(centre.x).toBeCloseTo(35);
    expect(centre.y).toBeCloseTo(25);
    expect(toFeet(c, 48, 0).x).toBeLessThanOrEqual(10 + 1e-9); // whole box visible
    expect(fit(null, 800, 600)).toEqual({ x: 0, y: 0, z: BASE_Z });
  });
});
