import { describe, expect, it } from "vitest";
import { parseBudget, SIZE_OPTIONS, surveyToSpec, USE_OPTIONS } from "./survey";

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
