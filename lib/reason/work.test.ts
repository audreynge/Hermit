import { describe, expect, it } from "vitest";
import { estimateWork } from "./work";
import type { FitResult, RequirementSpec, RuleHit, Shell } from "../types";

const spec = (over: Partial<RequirementSpec> = {}): RequirementSpec => ({
  mode: "business", city: "los_angeles", useType: "dental clinic", rooms: [], needs: {}, priorities: {}, input: "survey", ...over,
});
const shell = { id: "S", sqft: 10000 } as Shell;
const fitWith = (edits: string[]): FitResult => ({ score: 80, assignment: [], edits, breakdown: {}, hardFails: [], unknowns: [] });
const fail = (rule: string, detail = ""): RuleHit => ({ rule, status: "fail", detail, citation: "x", evidence: [] });

describe("estimateWork", () => {
  it("prices a missing restroom using the bathroom row", () => {
    const w = estimateWork(spec(), shell, fitWith(["Build bathroom"]), []);
    expect(w.items[0]).toMatchObject({ item: expect.stringMatching(/restroom/i), low: 25000, high: 60000, reason: "fit" });
  });

  it("scales an ESFR retrofit by area", () => {
    const w = estimateWork(spec({ needs: { esfr: true } }), shell, fitWith([]), [fail("fire")]);
    expect(w.items[0]).toMatchObject({ low: 30000, high: 60000, reason: "code" });
  });

  it("adds permit time on top of the longest build item", () => {
    const w = estimateWork(spec(), shell, fitWith(["Build bathroom", "Divide 900 sf open room for office"]), []);
    expect(w.weeksToOpen[0]).toBe(6 + 4);
    expect(w.weeksToOpen[1]).toBeGreaterThanOrEqual(16 + 8);
  });

  it("needs no permit when nothing is built", () => {
    const w = estimateWork(spec(), shell, fitWith([]), []);
    expect(w.items).toEqual([]);
    expect(w.weeksToOpen).toEqual([1, 4]);
    expect(w.costRange).toEqual([0, 0]);
  });

  it("reports an optional TI allowance separately instead of netting it out as savings", () => {
    const w = estimateWork(spec({ tiPerSqft: 2 }), { ...shell, sqft: 1000 }, fitWith(["Build bathroom"]), []);
    expect(w.costRange).toEqual([25000, 60000]);
    expect(w.tiAllowance).toBe(2000);
  });

  it("prices one drive-in door per missing bay", () => {
    const w = estimateWork(spec({ needs: { driveInBays: 3 } }), { ...shell, driveInBays: 1 } as Shell, fitWith([]), [fail("drive_in_bays")]);
    expect(w.items[0]).toMatchObject({ qty: 2, low: 30000, high: 80000 });
  });
});
