import { describe, expect, it } from "vitest";
import { layoutSummary, parseBudget, SIZE_OPTIONS, surveyToSpec, USE_OPTIONS, withLayout } from "./survey";

describe("surveyToSpec", () => {
  it("maps a small-business survey onto a spec", () => {
    const s = surveyToSpec({ city: "houston", transaction: "lease", useType: "medical", size: "1000-2500", budget: "$5,000 / month", accessibility: true, requirements: ["parking", "ground", "transit"], moveIn: "1-3m" });
    expect(s).toMatchObject({
      mode: "business", city: "houston", useType: "medical clinic", sizeSqft: [1000, 2500], budgetMonthly: 5000, transaction: "lease",
      needs: { wheelchair: true, stepFree: true, parking: true, groundFloor: true, transit: true }, moveInBy: "1-3m", input: "survey",
    });
  });

  it("picks the search mode from the use type", () => {
    expect(surveyToSpec({ useType: "warehouse", transaction: "lease", accessibility: false, requirements: [] }).mode).toBe("enterprise");
    expect(surveyToSpec({ useType: "home", transaction: "buy", accessibility: false, requirements: [] }).mode).toBe("home");
  });

  it("keeps preference-only chips as preferences", () => {
    const s = surveyToSpec({ useType: "medical", transaction: "lease", accessibility: false, requirements: ["flexible", "patient", "ada"] });
    expect(s.preferences).toEqual(["flexible", "patient"]);
    expect(s.needs.wheelchair).toBe(true);
  });

  it("leaves city unset when the survey skips it so chat can ask", () => {
    expect(surveyToSpec({ transaction: "lease", accessibility: false, requirements: [] }).city).toBeUndefined();
  });

  it("offers small-business uses first and a size ladder", () => {
    expect(USE_OPTIONS[0].value).toBe("medical");
    expect(USE_OPTIONS.map((u) => u.value)).toContain("salon");
    expect(SIZE_OPTIONS.at(-1)?.range[0]).toBe(10000);
  });
});

describe("parseBudget", () => {
  it("reads monthly rents and purchase prices", () => {
    expect(parseBudget("$5,000 / month", "lease")).toEqual({ budgetMonthly: 5000 });
    expect(parseBudget("$1,000,000", "buy")).toEqual({ budgetTotal: 1000000 });
    expect(parseBudget("4500", "lease")).toEqual({ budgetMonthly: 4500 });
    expect(parseBudget("1.2m", "buy")).toEqual({ budgetTotal: 1200000 });
    expect(parseBudget("", "lease")).toEqual({});
  });
});

describe("withLayout", () => {
  const blocks = [
    { id: "a", kind: "room" as const, label: "exam room", x: 0, y: 0, w: 10, h: 10 },
    { id: "b", kind: "room" as const, label: "exam room", x: 10, y: 0, w: 10, h: 10 },
    { id: "s", kind: "object" as const, label: "sink", x: 2, y: 2, w: 2, h: 2 },
  ];
  it("adds the layout's rooms, infers the use and size only when the survey left them blank", () => {
    const d = withLayout(surveyToSpec({ transaction: "lease", accessibility: false, requirements: [] }), blocks);
    expect(d).toMatchObject({ useType: "medical clinic", input: "layout", sizeSqft: [200, 400] });
    expect(d.rooms[0]).toMatchObject({ label: "exam room", count: 2, fixtures: ["sink"] });
    const kept = withLayout(surveyToSpec({ useType: "office", size: "1000-2500", transaction: "lease", accessibility: false, requirements: [] }), blocks);
    expect(kept).toMatchObject({ useType: "office", sizeSqft: [1000, 2500] });
    expect(layoutSummary("Clinic A", d, blocks)).toBe("Use my layout “Clinic A”: 2 exam rooms with sinks (about 200 sq ft).");
  });
});
