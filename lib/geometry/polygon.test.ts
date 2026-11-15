import { describe, expect, it } from "vitest";
import { centroid, nearestOnBoundary, pointInPolygon, ringFromEdges, shoelaceArea, SQFT_PER_SQM } from "./polygon";

describe("shoelaceArea", () => {
  it("measures a 4x3 rectangle regardless of winding", () => {
    const cw = [{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 0 }];
    expect(shoelaceArea(cw)).toBe(12);
    expect(shoelaceArea([...cw].reverse())).toBe(12);
  });

  it("returns 0 for degenerate input", () => {
    expect(shoelaceArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
});

describe("ringFromEdges", () => {
  it("chains unordered, arbitrarily oriented wall segments into one ring", () => {
    const edges = [
      [{ x: 4, y: 3 }, { x: 4, y: 0 }],
      [{ x: 0, y: 0 }, { x: 4, y: 0 }],
      [{ x: 0, y: 3 }, { x: 0, y: 0 }],
      [{ x: 4, y: 3 }, { x: 0, y: 3 }],
    ];
    const ring = ringFromEdges(edges);
    expect(ring).toHaveLength(4);
    expect(shoelaceArea(ring)).toBeCloseTo(12);
  });

  it("tolerates float noise between segment endpoints", () => {
    const edges = [
      [{ x: 0, y: 0 }, { x: 2, y: 0 }],
      [{ x: 2.0004, y: 0.0003 }, { x: 2, y: 2 }],
      [{ x: 2, y: 2 }, { x: 0, y: 2 }],
      [{ x: 0, y: 2.0002 }, { x: 0, y: 0 }],
    ];
    expect(shoelaceArea(ringFromEdges(edges))).toBeCloseTo(4, 2);
  });
});

describe("centroid", () => {
  it("is the center of a rectangle", () => {
    expect(centroid([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }])).toEqual({ x: 2, y: 1 });
  });
});

it("converts square meters to square feet", () => {
  expect(10 * SQFT_PER_SQM).toBeCloseTo(107.64, 2);
});

describe("pointInPolygon / nearestOnBoundary", () => {
  const L = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }];
  it("handles a concave L shape", () => {
    expect(pointInPolygon({ x: 1, y: 1 }, L)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 3 }, L)).toBe(false); // the notch
    expect(pointInPolygon({ x: 5, y: 1 }, L)).toBe(false);
  });
  it("finds the closest boundary point", () => {
    const n = nearestOnBoundary({ x: 1, y: -1 }, L);
    expect(n.pt).toEqual({ x: 1, y: 0 });
    expect(n.dist).toBe(1);
  });
});

describe("ringFromEdges on open-plan rooms", () => {
  it("traces the full outline past T-junctions and interior wall stubs", () => {
    // An L-shaped 10x10 room missing its 5x5 top-right corner, with a wall stub poking in from the bottom and the
    // segments listed out of order: a chain walk dead-ends at the stub's T-junction.
    const P = (x: number, y: number) => ({ x, y });
    const segs = [
      [P(0, 0), P(4, 0)], [P(4, 0), P(4, 3)], [P(4, 0), P(10, 0)], [P(10, 0), P(10, 5)],
      [P(5, 10), P(0, 10)], [P(10, 5), P(5, 5)], [P(5, 5), P(5, 10)], [P(0, 10), P(0, 0)],
    ];
    expect(shoelaceArea(ringFromEdges(segs))).toBeCloseTo(75, 5);
  });
});
