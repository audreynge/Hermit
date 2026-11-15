import { describe, expect, it } from "vitest";
import type { RequirementSpec } from "@/lib/types";
import { specItems } from "./SpecChecklist";

const base: RequirementSpec = { mode: "business", city: "houston", useType: "dental clinic", rooms: [], needs: {}, priorities: {}, input: "text" };

describe("specItems", () => {
  it("restates use, size, top room and budget, capped at four", () => {
    const s = { ...base, sizeSqft: [2000, 2800] as [number, number], budgetMonthly: 7000,
      rooms: [{ label: "exam room", count: 4, hard: false }, { label: "reception", count: 1, hard: false }, { label: "bathroom", count: 2, hard: true }] };
    expect(specItems(s)).toEqual(["Dental clinic use", "2,000 – 2,800 sq ft", "4 exam rooms", "≤ $7,000/month"]);
  });
  it("skips the replay placeholder use and reads an open-ended size", () => {
    expect(specItems({ ...base, useType: "space", sizeSqft: [0, 1500] })).toEqual(["Up to 1,500 sq ft"]);
  });
});
