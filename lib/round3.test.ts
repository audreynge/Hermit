import { describe, expect, it } from "vitest";
import { concerns } from "./crew/skeptic";
import { openingPlan } from "./crew/planner";
import { nextQuestion } from "./interview/next";
import { breakEven, buyEstimate, readPnl } from "./money";
import { competitors, customers, neighbors } from "./neighborhood/summarize";
import type { SiteFile } from "./neighborhood/types";
import { inside, parseFurnish, place } from "./spec/place";
import { chipOn, toggleChip } from "./uses/chips";
import type { Evaluation } from "./agent/report";
import type { RequirementSpec } from "./types";

const site = (over: Partial<SiteFile> = {}): SiteFile => ({
  sid: "S", lat: 29.7, lon: -95.4, city: "houston", retrieved: "2026-11-15",
  traffic: { aadt: 22180, road: "TxDOT station X", km: 0.3, source: "TxDOT" },
  pois: [
    { lat: 0, lon: 0, tags: { highway: "bus_stop" }, km: 0.2 }, { lat: 0, lon: 0, tags: { public_transport: "platform", bus: "yes" }, km: 0.3 },
    { lat: 0, lon: 0, tags: { railway: "station" }, km: 0.35 }, { lat: 0, lon: 0, tags: { shop: "hairdresser" }, name: "Cuts", km: 0.5 },
    { lat: 0, lon: 0, tags: { shop: "beauty" }, km: 0.7 }, { lat: 0, lon: 0, tags: { office: "company" }, km: 0.4 },
  ],
  osmSource: "OSM", blockGroup: null, demographics: { income: 78400, age2544: 0.41, source: "ACS" }, ...over,
});

describe("plain-language neighborhood answers", () => {
  it("turns counts into sentences a customer would say", () => {
    const c = customers(site());
    expect(c.lines[0]).toBe("About 22,000 cars a day pass the busiest counted road nearby, about 0.2 mi away.");
    expect(c.lines[1]).toBe("3 transit stops within a 5-minute walk, including 1 rail.");
    expect(c.proxy).toBe(true);
  });
  it("counts competitors for the use and says none are within 3 blocks", () => {
    const a = competitors(site(), "salon");
    expect(a.lines[0]).toBe("2 salons within a 10-minute walk.");
    expect(a.lines[1]).toBe("None within 3 blocks of this spot.");
  });
  it("says what's missing instead of inventing demographics", () => {
    expect(neighbors(site({ demographics: null })).missing).toMatch(/Census API key/);
    expect(neighbors(site()).lines[0]).toBe("Neighbors earn around $78,000 a year (median household).");
    expect(customers(null).missing).toBeTruthy();
  });
});

describe("money", () => {
  it("turns rent into customers a day", () => {
    const be = breakEven({ price: 55, daysPerWeek: 6, rent: 4200, utilities: 300, other: 0 })!;
    expect(be.perDayRounded).toBe(4); // 4,500 / (55 × 26) ≈ 3.15 → 4
    expect(breakEven({ price: 0, daysPerWeek: 6, rent: 1, utilities: 0, other: 0 })).toBeNull();
  });
  it("estimates a 10%-down purchase and reads a P&L CSV", () => {
    const b = buyEstimate(500_000);
    expect(b.down).toBe(50_000);
    expect(Math.round(b.monthly)).toBe(3181);
    expect(readPnl("month,revenue,expenses\nJan,10000,6000\nFeb,12000,8000")).toEqual({ rows: 2, revenue: 11000, expenses: 7000 });
  });
});

describe("furniture placement", () => {
  const room = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
  it("places pieces inside the walls and reports what doesn't fit", () => {
    const { placed, missed } = place("r", room, [], "chair", 3, "north");
    expect(placed).toHaveLength(3);
    for (const p of placed) for (const c of [{ x: p.x, y: p.y }, { x: p.x + p.w, y: p.y + p.h }]) expect(inside(c, room)).toBe(true);
    expect(Math.min(...placed.map((p) => 3 - (p.y + p.h)))).toBeLessThan(0.5); // hugging the north wall
    expect(missed).toBe(0);
    expect(place("r", room, [], "bed", 20).missed).toBeGreaterThan(0);
  });
  it("parses a request without an LLM", () => {
    expect(parseFurnish("add 3 salon chairs along the north wall of Room 2", [{ id: "a", name: "Room 2" }])).toEqual([{ op: "add", type: "styling chair", count: 3, roomId: "a", wall: "north" }]);
  });
});

describe("crew additions", () => {
  const spec: RequirementSpec = { mode: "business", city: "houston", useType: "salon", rooms: [], needs: {}, priorities: {}, input: "chat", moveInBy: "asap" };
  const e = { graph: null, fit: { unknowns: [] }, work: { weeksToOpen: [4, 20] } } as unknown as Evaluation;
  it("the Skeptic cites numbers against the top pick", () => {
    const c = concerns(spec, e, site({ pois: [] }));
    expect(c.map((x) => x.text)).toEqual(expect.arrayContaining([expect.stringMatching(/No bus or rail stop mapped/), expect.stringMatching(/up to 20 weeks/), expect.stringMatching(/No 3D scan/)]));
  });
  it("the Planner names who to call for a salon license", () => {
    const p = openingPlan(spec, { work: [], unknowns: [] });
    expect(p.steps.some((s) => /TDLR/.test(s.who?.who ?? ""))).toBe(true);
    expect(p.total[0]).toBeGreaterThan(0);
  });
  it("the interview asks for the two money inputs before must-haves", () => {
    const base = { ...spec, city: "houston" as const, sizeSqft: [1000, 2000] as [number, number], moveInBy: "3-6m", rooms: [{ label: "styling floor", count: 1, hard: false }], needs: { wheelchair: false, parking: false } };
    expect(nextQuestion(base, [], ["rooms", "accessibility", "parking"])?.field).toBe("price");
    expect(nextQuestion({ ...base, avgPrice: 55 }, [], ["rooms", "accessibility", "parking"])?.field).toBe("days");
    expect(nextQuestion({ ...base, avgPrice: 55, daysOpen: 6 }, [], ["rooms", "accessibility", "parking"])?.field).toBe("musts");
  });
  it("must-have chips map onto needs and back", () => {
    const s = toggleChip("Step-free / wheelchair access", { ...spec, needs: {} });
    expect(s.needs).toEqual({ wheelchair: true, stepFree: true });
    expect(chipOn("Step-free / wheelchair access", s)).toBe(true);
    expect(toggleChip("Step-free / wheelchair access", s).needs).toEqual({});
  });
});

import { buildoutCheck } from "./reason/buildout";
import { exclusiveScan } from "./reason/exclusive";
import { gradePacket, emptyProfile } from "./packet";
import type { RoomGraph } from "./types";

describe("deal-killers before the tour", () => {
  const g = { sid: "G", name: "G", totalAreaSqft: 1200, rooms: [{ id: "b", label: "bathroom", rawTags: ["bathroom"], areaSqft: 50, polygon: [], floorId: "f" }], edges: [], objects: [], panoCount: 3, floorCount: 1, description: "A bright cafe with a range hood over the line." } as RoomGraph;
  it("tags what the scan shows and marks the rest unverified", () => {
    const b = Object.fromEntries(buildoutCheck("bakery cafe", g).map((x) => [x.item, x.status]));
    expect(b).toMatchObject({ "Restrooms": "seen", "Kitchen hood": "mentioned", "Walk-in cooler": "unverified", "Grease interceptor": "unverified" });
  });
  it("flags a same-category business on the block and always asks about exclusives", () => {
    const s = site({ pois: [{ lat: 0, lon: 0, tags: { amenity: "cafe" }, name: "Bean There", km: 0.02 }, { lat: 0, lon: 0, tags: { amenity: "cafe" }, km: 0.5 }] });
    const x = exclusiveScan(s, "bakery cafe");
    expect(x.conflicts).toEqual([{ name: "Bean There", what: "cafe", meters: 20, where: "next door" }]);
    expect(x.question).toMatch(/exclusive/);
  });
  it("grades the packet like a landlord and clears flags as the owner fills it in", () => {
    const r = { work: [{ item: "New restroom with plumbing tie-in" }], buildout: [], conflicts: [], unknowns: [] } as never;
    const blank = gradePacket(emptyProfile({ useType: "salon" }), r, { monthlyRent: 4000, furnished: 0, questions: 0 });
    expect(blank.flags.map((f) => f.text)).toContain("No reserve listed. Landlords screen for this.");
    expect(blank.grade).toBe("D");
    const full = gradePacket({ ...emptyProfile({ useType: "salon" }), business: "Shear Joy", concept: "Walk-in cuts and color for busy downtown workers", years: "8 years", trackRecord: "Senior stylist at two salons", cash: 60000, reserveMonths: 6, financing: "Savings plus SBA microloan", guarantee: "capped" }, r, { monthlyRent: 4000, furnished: 5, questions: 0 });
    expect(full.grade).toBe("A");
  });
  it("counts daytime workers as a foot-traffic proxy", () => {
    expect(customers(site({ workers: { jobs: 12345, retailFood: 900, source: "LEHD" } })).lines).toContain("About 12,300 people work within a 10-minute walk, so there's a weekday lunch crowd.");
  });
});
