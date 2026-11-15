import { describe, expect, it } from "vitest";
import { shouldHydrate } from "../lib/db/catalog";
import type { RoomGraph, Shell } from "../lib/types";
import { coverage, coverageTable, mergeShells, planRoomGraphs, polygonRooms } from "./merge-catalog";

const shell = (o: Partial<Shell>): Shell => ({
  id: "x", mode: "business", city: "houston", name: "n", address: "", propertyType: "Unknown", subtype: "Unknown", useTags: [],
  sprinkler: "unknown", heavyPower: null, driveInBays: null, loadingDocks: null, parkingSpaces: null, zoning: null, elevator: null, ...o,
});
const graph = (polys: number[]): RoomGraph => ({
  sid: "g", name: "g", totalAreaSqft: 0, edges: [], objects: [], panoCount: 0, floorCount: 1,
  rooms: polys.map((n, i) => ({ id: `r${i}`, label: "office", rawTags: [], areaSqft: 100, floorId: "f", polygon: Array.from({ length: n }, (_, k) => ({ x: k, y: k })) })),
});

describe("mergeShells", () => {
  const remote = [
    shell({ id: "A", sid: "A", propertyType: "GeneralRetail", subtype: "GeneralRetail_StorefrontRetailOrOffice", parkingSpaces: 35, address: "7440 Cypress", lat: 1, lon: 2, roomCount: 21 }),
    shell({ id: "prop-1", propertyType: "Office" }),
    shell({ id: "B", sid: "B" }),
  ];
  const local = [
    shell({ id: "A", sid: "A", kind: "medical", scanClass: "healthcare", measuredSqft: 3742, defurnished: false, splat: false, floorCount: 1, roomCount: 20, panoCount: 20, address: "7400 FM-1960", lat: 9, lon: 9, parkingSpaces: null }),
    shell({ id: "B", sid: "B", kind: "suite", lat: 3, lon: 4 }),
    shell({ id: "C", sid: "C", kind: "unit", mode: "home" }),
  ];
  const { shells, stats } = mergeShells(remote, local);
  const byId = new Map(shells.map((s) => [s.id, s]));

  it("keeps CoStar fields from Postgres and fills scan fields from the local index", () => {
    const a = byId.get("A")!;
    expect(a.propertyType).toBe("GeneralRetail");
    expect(a.parkingSpaces).toBe(35);
    expect(a.address).toBe("7440 Cypress");
    expect(a.roomCount).toBe(21); // Postgres value wins when present
    expect(a).toMatchObject({ kind: "medical", scanClass: "healthcare", measuredSqft: 3742, defurnished: false, splat: false, floorCount: 1, panoCount: 20 });
    expect([a.lat, a.lon]).toEqual([1, 2]);
  });

  it("fills lat/lon only when Postgres lacks them", () => {
    expect([byId.get("B")!.lat, byId.get("B")!.lon]).toEqual([3, 4]);
  });

  it("keeps Postgres-only and local-only rows", () => {
    expect(byId.get("prop-1")!.propertyType).toBe("Office");
    expect(byId.get("C")!.kind).toBe("unit");
    expect(shells).toHaveLength(4);
    expect(stats).toMatchObject({ both: 2, remoteOnly: 1, localOnly: 1, idConflicts: [] });
  });

  it("falls back to id when the Postgres row has no sid", () => {
    const { shells: s, stats: st } = mergeShells([shell({ id: "D", propertyType: "Office" })], [shell({ id: "D", sid: "D", kind: "office" })]);
    expect(s).toEqual([expect.objectContaining({ id: "D", propertyType: "Office", kind: "office" })]);
    expect(st.both).toBe(1);
  });

  it("does not mutate its inputs", () => {
    expect(remote[0].kind).toBeUndefined();
  });
});

describe("room graphs", () => {
  it("counts only rooms with a real polygon", () => {
    expect(polygonRooms(graph([4, 0, 2, 3]))).toBe(2);
    expect(polygonRooms(null)).toBe(0);
  });

  it("writes only sids with no local file and compares overlaps", () => {
    const local = new Map([["a", graph([4])], ["b", graph([4, 4])], ["c", graph([4])]]);
    const remote = new Map([["a", graph([4, 4])], ["b", graph([4])], ["c", graph([3])], ["d", graph([4])]]);
    expect(planRoomGraphs(local, remote)).toEqual({ write: ["d"], overlap: { localBetter: ["b"], remoteBetter: ["a"], equal: ["c"] } });
  });
});

describe("hydrate rule (lib/db/catalog.ts)", () => {
  it("hydrates only a sample-sized local catalog, and only when Postgres has more", () => {
    expect(shouldHydrate(0, 2659)).toBe(true);
    expect(shouldHydrate(8, 2659)).toBe(true);
    expect(shouldHydrate(8, 0)).toBe(false);
    expect(shouldHydrate(15001, 2659)).toBe(false);
    expect(shouldHydrate(2659, 15001)).toBe(false);
  });
});

describe("coverage", () => {
  it("counts known values and room graphs", () => {
    const c = coverage([
      shell({ id: "1", sid: "1", sprinkler: "wet", heavyPower: false, parkingSpaces: 0, zoning: "C2", subtype: "Medical", propertyType: "Office", kind: "medical", measuredSqft: 10, lat: 1, lon: 2 }),
      shell({ id: "2", sid: "2", lat: 1 }),
      shell({ id: "3" }),
    ], new Set(["1", "3"]));
    expect(c).toEqual({ rows: 3, sprinkler: 1, heavyPower: 1, parkingSpaces: 1, zoning: 1, listing: 0, subtype: 1, propertyType: 1, kind: 1, measuredSqft: 1, "lat/lon": 1, "has room graph": 1 });
    expect(coverageTable(c, c)).toContain("| rows");
  });
});
