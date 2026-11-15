import { describe, expect, it } from "vitest";
import { parkingHit } from "./rules";
import { triangulate } from "./triangulate";
import type { AerialCount, RequirementSpec, Shell } from "../types";

const shell = (parkingSpaces: number | null): Shell => ({
  id: "S", sid: "S", mode: "business", city: "houston", name: "Suite 1", address: "1 Main St", lat: 29.7, lon: -95.4, propertyId: 7,
  propertyType: "Office", subtype: "Office_Medical", useTags: ["medical"], sqft: 2000, sprinkler: "unknown", heavyPower: null,
  driveInBays: null, loadingDocks: null, parkingSpaces, zoning: null, elevator: null,
});
const aerial = (n: number | null, confidence = 0.8, hi = n, garageLikely = false): AerialCount => ({
  sid: "S", provider: "vexcel", scope: "around-building", stalls: { n, lo: n, hi, confidence }, rooftopUnits: { n: 2, confidence: 0.8 },
  garageLikely, boxes: [], image: "aerial/S.jpg", model: "t", source: "t", retrieved: "2026-11-15",
});
const hit = (rec: number | null, a: AerialCount | null, need = 10) => parkingHit("onsite_parking", shell(rec), a, need, true, "cite");

describe("parkingHit", () => {
  it("passes on a record that meets the need, citing it", () => {
    const h = hit(12, null);
    expect(h.status).toBe("pass");
    expect(h.evidence[0].ref).toBe("property 7.parking.totalSpaces");
  });
  it("passes on a counted aerial when the record has no count", () => {
    const h = hit(null, aerial(14));
    expect(h.status).toBe("pass");
    expect(h.evidence.some((e) => e.source === "Vexcel ortho (counted)" && e.ref === "aerial:S")).toBe(true);
  });
  it("fails when the aerial is short and there is no record", () => {
    expect(hit(null, aerial(4))).toMatchObject({ status: "fail", detail: "Room for about 4 cars around the building on the Vexcel aerial; you need 10." });
  });
  it("warns when the record and the aerial disagree", () => {
    expect(hit(40, aerial(2)).status).toBe("warn");
    expect(hit(3, aerial(25)).status).toBe("warn");
  });
  it("reads a zero count as no marked lot seen: never a fail on the aerial alone", () => {
    expect(hit(null, aerial(0)).status).toBe("unknown");
    expect(hit(40, aerial(0))).toMatchObject({ status: "warn" });
    expect(hit(40, aerial(0)).detail).toMatch(/no marked surface lot/);
  });
  it("stays unknown when the aerial couldn't be counted, and says a garage can't be counted", () => {
    expect(hit(null, aerial(null, 0.2)).status).toBe("unknown");
    expect(hit(null, aerial(30, 0.2)).status).toBe("unknown");
    expect(hit(null, null).status).toBe("unknown");
    expect(hit(null, aerial(2, 0.8, 2, true)).detail).toMatch(/A garage can't be counted from the air\./);
  });
  it("only warns for the code-minimum screen, never fails", () => {
    expect(parkingHit("parking", shell(null), aerial(1), 10, false, "c").status).toBe("warn");
  });
});

describe("triangulate parking", () => {
  const spec: RequirementSpec = { mode: "business", city: "houston", useType: "clinic", rooms: [], needs: { parkingStalls: 10 }, priorities: {}, input: "survey" };
  it("fills real aerial cells for parking and rooftop units; footprint stays absent", () => {
    const rows = triangulate(spec, shell(40), null, aerial(30));
    const p = rows.find((r) => r.claim === "Room for 10 cars")!;
    expect(p.cells.aerial.state).toBe("agree");
    expect(p.verdict).toBe("confirmed");
    expect(rows.find((r) => r.claim === "Rooftop AC units")!.cells.aerial.note).toBe("2 rooftop units counted");
    expect(triangulate(spec, shell(null), null, null).find((r) => r.claim === "Room for 10 cars")!.verdict).toBe("unknown");
  });
});
