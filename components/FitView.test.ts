import { describe, expect, it } from "vitest";
import { designMatch, labelPoint } from "./FitView";

describe("labelPoint", () => {
  it("puts an L-shaped room's label inside the room, away from the walls", () => {
    // L: 100x20 bar along the bottom plus a 20x100 bar up the left side; the bbox center (50,50) is outside.
    const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 100 }, { x: 0, y: 100 }];
    const p = labelPoint(L);
    expect(p.x < 20 || p.y < 20).toBe(true);
    expect(p.r).toBeGreaterThan(5);
  });
});

describe("designMatch", () => {
  it("matches the nth drawn room of a type to the nth requirement of that type, ignoring hallways", () => {
    const b = (id: string, label: string, w = 10) => ({ id, label, x: 0, y: 0, w, h: 10 });
    const m = designMatch([b("1", "office"), b("2", "office"), b("3", "hallway", 5), b("4", "lab")], [
      { req: "office #1", roomId: "r1", cost: 0 }, { req: "office #2", roomId: null, cost: 70 }, { req: "lab", roomId: "r2", cost: 0 },
    ]);
    expect(m).toEqual({ matched: ["Office 1", "Lab"], build: ["Office 2"], sqft: 350 });
  });
});
