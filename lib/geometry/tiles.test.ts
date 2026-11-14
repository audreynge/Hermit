import { expect, it } from "vitest";
import { tileFor } from "./tiles";

it("maps lon/lat to slippy-map tile and in-tile fraction", () => {
  const t = tileFor(34.05, -118.46, 18);
  expect(t.x).toBe(44812);
  expect(t.y).toBe(104674);
  expect(t.fx).toBeGreaterThanOrEqual(0);
  expect(t.fx).toBeLessThan(1);
  expect(tileFor(0, 0, 1)).toMatchObject({ x: 1, y: 1, fx: 0, fy: 0 });
});
