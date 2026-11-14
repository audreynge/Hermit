import { describe, expect, it } from "vitest";
import { labelPoint } from "./FitView";

describe("labelPoint", () => {
  it("puts an L-shaped room's label inside the room, away from the walls", () => {
    // L: 100x20 bar along the bottom plus a 20x100 bar up the left side; the bbox center (50,50) is outside.
    const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 100 }, { x: 0, y: 100 }];
    const p = labelPoint(L);
    expect(p.x < 20 || p.y < 20).toBe(true);
    expect(p.r).toBeGreaterThan(5);
  });
});
