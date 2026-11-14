import { describe, expect, it } from "vitest";
import type { RoomGraph } from "../types";
import { fromLayout } from "../spec/parse";
import { blocksSig, compare, graphSig, layoutScale, type LayoutBlock } from "./layout";

const FT = 0.3048;
const clinic: LayoutBlock[] = [
  { label: "reception", x: 0, y: 0, w: 30, h: 12 },
  { label: "office", x: 0, y: 12, w: 12, h: 10 },
  { label: "office", x: 12, y: 12, w: 12, h: 10 },
  { label: "hallway", x: 24, y: 12, w: 6, h: 10 },
  { label: "bathroom", x: 0, y: 22, w: 8, h: 8 },
];

// A scan whose rooms are exactly the drawn blocks (meters, Matterport convention), with doors between touching rooms.
function scanOf(blocks: LayoutBlock[], k = 1, labels?: string[]): RoomGraph {
  const rooms = blocks.map((b, i) => ({
    id: `r${i}`, label: labels?.[i] ?? b.label, rawTags: [], areaSqft: b.w * b.h * k * k, floorId: "f",
    polygon: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => ({ x: x * k * FT, y: y * k * FT })),
  }));
  const edges = [[0, 1], [0, 2], [1, 2], [1, 4], [2, 3]].map(([a, b]) => ({ a: `r${a}`, b: `r${b}`, kind: "door" as const }));
  return { sid: "S", name: "t", totalAreaSqft: rooms.reduce((s, r) => s + r.areaSqft, 0), rooms, edges, objects: [], panoCount: 1, floorCount: 1 };
}

describe("layout similarity", () => {
  it("scores an identical scan near 100 and pairs every drawn room", () => {
    const s = compare(blocksSig(clinic), graphSig(scanOf(clinic)));
    expect(s.score).toBeGreaterThanOrEqual(95);
    expect(s.pairs.map((p) => p.mine).sort()).toEqual([0, 1, 2, 4]); // hallway (index 3) is circulation, not a room
  });

  it("ranks a same-program scan above one with the wrong rooms", () => {
    const right = compare(blocksSig(clinic), graphSig(scanOf(clinic)));
    const wrong = compare(blocksSig(clinic), graphSig(scanOf(clinic, 1, ["garage", "garage", "utility", "hallway", "garage"])));
    expect(right.score - wrong.score).toBeGreaterThan(30);
  });

  it("scale makes a double-size scan the better match", () => {
    const big = graphSig(scanOf(clinic, Math.SQRT2));
    expect(compare(blocksSig(clinic, 2), big, 2).score).toBeGreaterThan(compare(blocksSig(clinic, 1), big).score);
  });

  it("derives scale from the requested size, clamped", () => {
    const area = 30 * 12 + 2 * 120 + 6 * 10 + 64; // hallway counts: it is part of the footprint fromLayout() sizes
    expect(layoutScale({ layout: clinic, sizeSqft: [area * 1.5, area * 3] })).toBeCloseTo(1.5);
    expect(layoutScale({ layout: clinic, sizeSqft: [area * 100, area * 200] })).toBe(4);
    expect(layoutScale({ layout: clinic })).toBe(1);
  });

  it("an unscaled drawing with a hallway matches at exactly 100%", () => {
    const spec = fromLayout(clinic.map((b, i) => ({ ...b, id: String(i) })), { mode: "business", city: "houston", useType: "clinic" });
    expect(layoutScale(spec)).toBe(1);
  });
});
