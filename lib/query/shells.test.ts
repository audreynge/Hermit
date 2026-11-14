import { describe, expect, it } from "vitest";
import { searchShells } from "./shells";
import type { RequirementSpec, Shell } from "../types";

const base: Shell = {
  id: "x", mode: "business", city: "houston", name: "n", address: "a", propertyType: "Office", subtype: "Unknown",
  useTags: ["office"], sprinkler: "unknown", heavyPower: null, driveInBays: null, loadingDocks: null,
  parkingSpaces: null, zoning: null, elevator: null, constructionStatus: "Existing",
};
const s = (id: string, over: Partial<Shell>): Shell => ({ ...base, id, ...over });
const spec = (over: Partial<RequirementSpec> = {}): RequirementSpec => ({
  mode: "business", city: "houston", useType: "dental clinic", rooms: [], needs: {}, priorities: {}, input: "survey", ...over,
});

describe("searchShells", () => {
  const shells = [
    s("medical-scan", { sid: "m1", useTags: ["medical"], sqft: 2500, listing: { listingId: 1, status: "active" } }),
    s("office-scan", { sid: "o1", sqft: 2400 }),
    s("medical-record", { useTags: ["medical"], sqft: 2600 }),
    s("la", { city: "los_angeles", useTags: ["medical"], sid: "z" }),
    s("tiny", { sid: "t", useTags: ["medical"], sqft: 300 }),
    s("proposed", { sid: "p", useTags: ["medical"], constructionStatus: "Proposed" }),
    s("home", { mode: "home", useTags: ["home"], sid: "h" }),
  ];

  it("filters city, mode, non-existing construction, and incompatible size", () => {
    const ids = searchShells(spec({ sizeSqft: [2000, 3000] }), shells).results.map((r) => r.shell.id);
    expect(ids).not.toContain("la");
    expect(ids).not.toContain("home");
    expect(ids).not.toContain("proposed");
    expect(ids).not.toContain("tiny");
  });

  it("ranks a scanned like-for-like space with an active listing first", () => {
    const r = searchShells(spec({ sizeSqft: [2000, 3000] }), shells).results;
    expect(r[0].shell.id).toBe("medical-scan");
    expect(r[0].reasons.join(" ")).toMatch(/prior use/i);
    expect(r.findIndex((x) => x.shell.id === "medical-record")).toBeGreaterThan(r.findIndex((x) => x.shell.id === "office-scan") - 2);
  });

  it("counts what it rejected and caps results", () => {
    const many = Array.from({ length: 80 }, (_, i) => s(`o${i}`, { sid: `s${i}` }));
    const out = searchShells(spec(), [...many, s("la2", { city: "los_angeles" })]);
    expect(out.results).toHaveLength(50);
    expect(out.rejected).toBe(1);
  });

  it("lets enterprise use types search industrial shells and requires home mode for homes", () => {
    const ind = s("ind", { mode: "enterprise", useTags: ["warehouse"], sqft: 20000 });
    expect(searchShells(spec({ mode: "enterprise", useType: "warehouse" }), [ind]).results).toHaveLength(1);
    const homes = [s("h3", { mode: "home", beds: 3, sid: "a", listing: { listingId: 2, status: "active", price: 400000 } }), s("h1", { mode: "home", beds: 1, sid: "b" })];
    const r = searchShells(spec({ mode: "home", useType: "home", beds: 3, budgetTotal: 450000 }), homes).results;
    expect(r.map((x) => x.shell.id)).toEqual(["h3"]);
  });

  it("keeps a shell with unknown size but says so", () => {
    const r = searchShells(spec({ sizeSqft: [2000, 3000] }), [s("nosize", { sid: "q" })]).results;
    expect(r[0].reasons.join(" ")).toMatch(/size unknown/i);
  });
});
