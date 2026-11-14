import { describe, expect, it } from "vitest";
import { minCostAssignment } from "./hungarian";

const total = (m: number[][], a: number[]) => a.reduce((s, c, r) => s + (c >= 0 ? m[r][c] : 0), 0);

describe("minCostAssignment", () => {
  it("finds the optimal square assignment where greedy fails", () => {
    const m = [
      [4, 1, 3],
      [2, 0, 5],
      [3, 2, 2],
    ];
    const a = minCostAssignment(m);
    expect(total(m, a)).toBe(5);
    expect(new Set(a).size).toBe(3);
  });

  it("handles more columns than rows", () => {
    const m = [
      [9, 1, 9, 9],
      [9, 9, 9, 2],
    ];
    expect(minCostAssignment(m)).toEqual([1, 3]);
  });

  it("leaves extra rows unassigned (-1) when columns run out", () => {
    const m = [[5], [1], [3]];
    const a = minCostAssignment(m);
    expect(a.filter((c) => c === 0)).toHaveLength(1);
    expect(a[1]).toBe(0);
    expect(a.filter((c) => c === -1)).toHaveLength(2);
  });

  it("returns [] for no rows", () => {
    expect(minCostAssignment([])).toEqual([]);
  });
});
