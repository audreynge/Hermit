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
    expect(get(checkRules(spec(), shell()), "availability")?.status).toBe("warn");
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
  it("gives one front-door verdict instead of blocking every room, and flags rooms on another floor", () => {
    const sq = (x: number, w: number) => [{ x, y: 0 }, { x: x + w, y: 0 }, { x: x + w, y: 3 }, { x, y: 3 }];
    const room = (id: string, label: string, x: number, floorId = "f") => ({ id, label, rawTags: [], areaSqft: 100 + x, polygon: sq(x, 3), floorId });
    const base = {
      sid: "M2", totalAreaSqft: 600,
      rooms: [room("l", "living", 0), room("ba", "bathroom", 3), room("ba2", "bathroom", 6), room("up", "bedroom", 9, "f2")],
      edges: [{ a: "l", b: "ba", kind: "door", widthIn: 34 }, { a: "l", b: "ba2", kind: "door", widthIn: 24 }],
    };
    const wc = spec({ needs: { wheelchair: true } });
    const front = checkRules(wc, shell(), { ...base, entries: [{ roomId: "l", widthIn: 24 }] } as unknown as RoomGraph);
    expect(front.filter((h) => /^(door_|front_|other_)/.test(h.rule)).map((h) => `${h.rule}:${h.status}`)).toEqual(["front_door:fail"]);
    expect(get(front, "front_door")?.detail).toMatch(/^Front door: .*~22\.0 in clear/);
    const inside = checkRules(wc, shell(), { ...base, entries: [{ roomId: "l", widthIn: 36 }] } as unknown as RoomGraph);
    expect(get(inside, "other_floor")?.detail).toMatch(/^Bedroom: on another floor/);
    expect(get(inside, "door_width")?.detail).toMatch(/^Bathroom \(106 sf\): /); // two bathrooms: named by size
    expect(get(inside, "wheelchair_route")).toBeUndefined();
  });

  it("turns the wheelchair route check into door, hinge and turning-space verdicts", () => {
    const sq = (x: number, w: number, h: number) => [{ x, y: 0 }, { x: x + w, y: 0 }, { x: x + w, y: h }, { x, y: h }];
    const room = (id: string, label: string, x: number, w: number) => ({ id, label, rawTags: [], areaSqft: w * 30, polygon: sq(x, w, 3), floorId: "f" });
    const g = {
      sid: "M1", totalAreaSqft: 800, entries: [{ roomId: "l", widthIn: 36 }],
      rooms: [room("l", "living", 0, 5), room("b", "bedroom", 5, 4), room("ba", "bathroom", 9, 1.3), room("c", "storage", 10.3, 1)],
      edges: [{ a: "l", b: "b", kind: "door", widthIn: 28.5 }, { a: "l", b: "ba", kind: "door", widthIn: 26 }, { a: "b", b: "c", kind: "door" }],
    } as unknown as RoomGraph;
    const hits = checkRules(spec({ needs: { wheelchair: true } }), shell(), g);
    expect(get(hits, "door_hinges")?.detail).toMatch(/^Bedroom:.*Offset/);
    expect(get(hits, "door_width")).toMatchObject({ status: "fail", detail: expect.stringMatching(/^Bathroom:.*24\.0 in clear/) });
    expect(hits.some((h) => h.detail.includes("Storage"))).toBe(false); // storage is not an essential room
    expect(get(hits, "turning_space")?.status).toBe("fail"); // 1.3 m wide bathroom < 60 in
    expect(get(hits, "wheelchair_route")).toBeUndefined();
    expect(get(checkRules(spec(), shell(), g), "door_width")).toBeUndefined(); // only when a wheelchair is needed
    const noWidths = { ...g, edges: g.edges.map(({ widthIn, ...e }) => e) } as RoomGraph;
    expect(get(checkRules(spec({ needs: { wheelchair: true } }), shell(), noWidths), "door_width")?.status).toBe("unknown");
    // A 25 in chair fits the bedroom door as scanned (26.5 in clear); the bathroom (24 in) now only needs hinges.
    const manual = checkRules(spec({ needs: { wheelchair: true, chairWidthIn: 25 } }), shell(), g);
    expect(get(manual, "door_hinges")?.detail).toMatch(/^Bathroom:.*your 25 in chair/);
    expect(get(manual, "door_width")).toBeUndefined();
    expect(get(hits, "door_hinges")?.detail).toMatch(/your width wasn't given/);
  });
});
