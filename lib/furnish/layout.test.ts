import { describe, expect, it } from "vitest";
import { corners } from "./ops";
import { layoutRoom } from "./layout";
import { pointInPolygon } from "../geometry/polygon";

const room = { id: "r1", label: "office", polygon: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 0, y: 6 }], ceiling: 2.7 };

describe("layoutRoom", () => {
  it("fills a room with non-overlapping pieces that stay inside the walls", () => {
    const { placed, skipped } = layoutRoom(room, [
      { name: "desk", terms: ["desk"], size: { w: 1.4, d: 0.7, h: 0.75 }, count: 6, at: "wall" },
      { name: "conference table", terms: ["table"], size: { w: 2.4, d: 1.1, h: 0.75 }, count: 1, at: "center" },
      { name: "bookshelf", terms: ["bookshelf"], size: { w: 0.9, d: 0.35, h: 1.8 }, count: 2, at: "wall" },
    ], [], 0);
    expect(placed).toHaveLength(9);
    expect(skipped).toEqual([]);
    for (const p of placed) for (const c of corners(p.pos, p.size, p.rotY)) expect(pointInPolygon(c, room.polygon)).toBe(true);
    const ids = new Set(placed.map((p) => p.id));
    expect(ids.size).toBe(placed.length);
  });

  it("reports what doesn't fit instead of stacking it", () => {
    const tiny = { ...room, polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }] };
    const { placed, skipped } = layoutRoom(tiny, [{ name: "sofa", terms: ["sofa"], size: { w: 2.2, d: 0.9, h: 0.8 }, count: 3, at: "wall" }], [], 0);
    expect(placed.length + skipped.length).toBe(3);
    expect(skipped.length).toBeGreaterThan(0);
  });
});

describe("doors", () => {
  it("keeps every piece clear of a doorway", () => {
    const door = { at: { x: 4, y: 0 }, widthM: 0.9 };
    const { placed } = layoutRoom(room, [{ name: "cabinet", terms: ["cabinet"], size: { w: 0.9, d: 0.5, h: 1.8 }, count: 12, at: "wall" }], [], 0, [door]);
    expect(placed.length).toBeGreaterThan(4);
    for (const p of placed) for (const c of corners(p.pos, p.size, p.rotY)) expect(Math.hypot(c.x - door.at.x, c.y - door.at.y)).toBeGreaterThan(0.45 + 0.6 - 0.01);
  });
});

describe("walkways", () => {
  it("doesn't line a 1.4 m corridor with wall pieces", () => {
    const corridor = { id: "h", label: "hallway", polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1.4 }, { x: 0, y: 1.4 }] };
    const { placed } = layoutRoom(corridor, [{ name: "bench", terms: ["bench"], size: { w: 1.2, d: 0.45, h: 0.45 }, count: 4, at: "wall" }], [], 0);
    expect(placed).toHaveLength(0);
  });
});
