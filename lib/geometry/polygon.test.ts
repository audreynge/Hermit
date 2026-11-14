import { describe, expect, it } from "vitest";
import { centroid, ringFromEdges, shoelaceArea, SQFT_PER_SQM } from "./polygon";

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
