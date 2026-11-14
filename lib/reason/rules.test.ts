import { describe, expect, it } from "vitest";
import { checkRules, laZoneClass, useCategory } from "./rules";
import type { RequirementSpec, RoomGraph, Shell } from "../types";

const shell = (over: Partial<Shell> = {}): Shell => ({
  id: "S1", mode: "business", city: "los_angeles", name: "Suite 1", address: "1 Main St",
  propertyType: "Office", subtype: "Office_Medical", useTags: ["medical"], sqft: 2000,
  sprinkler: "unknown", heavyPower: null, driveInBays: null, loadingDocks: null,
  parkingSpaces: null, zoning: null, elevator: null, ...over,
});
const spec = (over: Partial<RequirementSpec> = {}): RequirementSpec => ({
  mode: "business", city: "los_angeles", useType: "dental clinic", rooms: [], needs: {}, priorities: {}, input: "survey", ...over,
});
const get = (hits: ReturnType<typeof checkRules>, rule: string) => hits.find((h) => h.rule === rule);

describe("useCategory", () => {
  it("maps free text to a rules category", () => {
    expect(useCategory("pediatric dental clinic")).toBe("medical");
    expect(useCategory("hair salon")).toBe("salon");
    expect(useCategory("3PL warehouse")).toBe("warehouse");
    expect(useCategory("something odd")).toBe("office");
    expect(useCategory("fitness studio")).toBe("fitness");
    expect(useCategory("yoga studio")).toBe("fitness");
    expect(useCategory("medical clinic")).toBe("medical");
  });
});

describe("laZoneClass", () => {
  it("reads CoStar LA zoning strings", () => {
    expect(laZoneClass("LAM2-1")).toEqual(["industrial", "commercial"]);
    expect(laZoneClass("LAC2")).toEqual(["commercial"]);
    expect(laZoneClass("[Q]C2-1VL")).toEqual(["commercial"]);
    expect(laZoneClass("LAR3")).toEqual(["residential"]);
    expect(laZoneClass("weird")).toEqual([]);
  });
});

describe("checkRules", () => {
  it("treats a null CoStar field as unknown, never pass", () => {
    const h = get(checkRules(spec({ needs: { heavyPower: true } }), shell()), "electrical");
    expect(h?.status).toBe("unknown");
    expect(h?.citation).toMatch(/^https?:/);
  });

  it("passes and fails heavy power from the record", () => {
    expect(get(checkRules(spec({ needs: { heavyPower: true } }), shell({ heavyPower: true })), "electrical")?.status).toBe("pass");
    expect(get(checkRules(spec({ needs: { heavyPower: true } }), shell({ heavyPower: false })), "electrical")?.status).toBe("fail");
  });

  it("fails ESFR when the record says wet sprinklers", () => {
    const h = get(checkRules(spec({ needs: { esfr: true } }), shell({ sprinkler: "wet" })), "fire");
    expect(h?.status).toBe("fail");
    expect(h?.evidence[0].ref).toMatch(/sprinklerType/);
  });

  it("fails too few drive-in bays", () => {
    expect(get(checkRules(spec({ needs: { driveInBays: 2 } }), shell({ driveInBays: 1 })), "drive_in_bays")?.status).toBe("fail");
  });

  it("screens LA zoning by use class and leaves Houston as a deed-restriction question", () => {
    expect(get(checkRules(spec(), shell({ zoning: "LAR3" })), "zoning")?.status).toBe("fail");
    expect(get(checkRules(spec(), shell({ zoning: "LAC2" })), "zoning")?.status).toBe("pass");
    const hou = get(checkRules(spec({ city: "houston" }), shell({ city: "houston" })), "zoning");
    expect(hou?.status).toBe("unknown");
    expect(hou?.detail).toMatch(/deed restriction/i);
  });

  it("estimates parking need from use and area", () => {
    const h = get(checkRules(spec({ city: "houston" }), shell({ city: "houston", parkingSpaces: 3 })), "parking");
    expect(h?.status).toBe("warn");
    expect(h?.detail).toMatch(/8/);
  });

  it("fails step-free access in a multi-story building with no elevator", () => {
    const h = get(checkRules(spec({ needs: { stepFree: true } }), shell({ stories: 3, elevator: false })), "accessibility");
    expect(h?.status).toBe("fail");
  });

  it("reports HVAC load as a range with installed capacity unknown", () => {
    const h = get(checkRules(spec(), shell({ sqft: 3000 })), "hvac");
    expect(h?.status).toBe("unknown");
    expect(h?.detail).toMatch(/10.*12 tons/);
  });

  it("does not call a property available without an active listing", () => {
    expect(get(checkRules(spec(), shell()), "availability")?.status).toBe("unknown");
    const active = shell({ listing: { listingId: 9, status: "active" } });
    expect(get(checkRules(spec(), active), "availability")?.status).toBe("pass");
  });

  it("flags a listing-vs-measured area gap over 10% in home mode", () => {
    const g = { sid: "x", totalAreaSqft: 1500 } as RoomGraph;
    const h = get(checkRules(spec({ mode: "home", useType: "home" }), shell({ mode: "home", sqft: 2000, sqftSource: "listing" }), g), "measured_size");
    expect(h?.status).toBe("warn");
    expect(h?.detail).toMatch(/25%/);
  });

  it("screens on-site parking, ground floor and transit from what the record can show", () => {
    expect(get(checkRules(spec({ needs: { parking: true } }), shell({ parkingSpaces: 0 })), "onsite_parking")?.status).toBe("fail");
    expect(get(checkRules(spec({ needs: { parking: true } }), shell({ parkingSpaces: 12 })), "onsite_parking")?.status).toBe("pass");
    expect(get(checkRules(spec({ needs: { parking: true } }), shell()), "onsite_parking")?.status).toBe("unknown");
    expect(get(checkRules(spec({ needs: { groundFloor: true } }), shell({ stories: 1 })), "ground_floor")?.status).toBe("pass");
    expect(get(checkRules(spec({ needs: { groundFloor: true } }), shell({ stories: 8 })), "ground_floor")?.status).toBe("unknown");
    const t = get(checkRules(spec({ needs: { transit: true } }), shell()), "transit");
    expect(t?.status).toBe("unknown");
    expect(t?.detail).toMatch(/not checked/i);
  });

  it("fails a home with fewer bedrooms than required", () => {
    const h = get(checkRules(spec({ mode: "home", useType: "home", beds: 3 }), shell({ mode: "home", beds: 2 })), "bedrooms");
    expect(h?.status).toBe("fail");
  });
});
