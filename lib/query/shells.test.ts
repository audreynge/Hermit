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
    expect(searchShells(spec({ sizeSqft: [2000, 3000] }), [s("short", { sqft: 1650 })]).results).toHaveLength(0);
    expect(searchShells(spec({ sizeSqft: [2000, 3000] }), [s("near", { sqft: 1800 })]).results[0].reasons.join(" ")).toMatch(/below the 2,000 sf minimum/);
  });

  it("ranks a scanned like-for-like space with an active listing first", () => {
    const r = searchShells(spec({ sizeSqft: [2000, 3000] }), shells).results;
    expect(r[0].shell.id).toBe("medical-scan");
    expect(r[0].reasons.join(" ")).toMatch(/prior use/i);
    expect(r.findIndex((x) => x.shell.id === "medical-record")).toBeGreaterThan(r.findIndex((x) => x.shell.id === "office-scan") - 2);
  });

  it("counts what it rejected and keeps every match (no cap unless asked)", () => {
    const many = Array.from({ length: 80 }, (_, i) => s(`o${i}`, { sid: `s${i}` }));
    const out = searchShells(spec(), [...many, s("la2", { city: "los_angeles" })]);
    expect(out.results).toHaveLength(80);
    expect(searchShells(spec(), many, 50).results).toHaveLength(50);
    expect(out.rejected).toBe(1);
  });

  it("lets enterprise use types search industrial shells and requires home mode for homes", () => {
    const ind = s("ind", { mode: "enterprise", useTags: ["warehouse"], sqft: 20000 });
    expect(searchShells(spec({ mode: "enterprise", useType: "warehouse" }), [ind]).results).toHaveLength(1);
    const homes = [s("h3", { mode: "home", beds: 3, sid: "a", listing: { listingId: 2, status: "active", price: 400000 } }), s("h1", { mode: "home", beds: 1, sid: "b" })];
    const r = searchShells(spec({ mode: "home", useType: "home", beds: 3, budgetTotal: 450000 }), homes).results;
    expect(r.map((x) => x.shell.id)).toEqual(["h3"]);
  });

  it("prefers listings that match lease vs buy", () => {
    const lease = s("lease", { sid: "l", listing: { listingId: 1, status: "active", kind: "lease" } });
    const sale = s("sale", { sid: "b", listing: { listingId: 2, status: "active", kind: "sale" } });
    const r = searchShells(spec({ transaction: "buy" }), [lease, sale]).results;
    expect(r[0].shell.id).toBe("sale");
    expect(r[0].reasons).toContain("For sale");
  });

  it("screens out homes whose record has fewer bathrooms than needed", () => {
    const homes = [s("b1", { mode: "home", baths: 1, sid: "a" }), s("b2", { mode: "home", baths: 2, sid: "b" }), s("b?", { mode: "home", sid: "c" })];
    const out = searchShells(spec({ mode: "home", useType: "home", baths: 2 }), homes);
    expect(out.results.map((x) => x.shell.id)).toEqual(["b2", "b?"]);
    expect(out.stages.find((st) => st.key === "baths")!.removed[0].reason).toBe("Has 1 bathroom; you need 2");
  });

  it("lifts a scan that is itself a medical suite, and scores size from the nearest edge of the range", () => {
    // The x37 case: a medical scan measured 3,742 sf for a 1,500-3,500 sf ask used to sink below office suites.
    const med = s("med", { sid: "m", kind: "medical", scanClass: "healthcare", useTags: ["medical", "office"], measuredSqft: 3742 });
    const offices = Array.from({ length: 8 }, (_, i) => s(`o${i}`, { sid: `o${i}`, kind: "suite", useTags: ["medical", "office"], scanClass: "workspace", sqft: 2500, listing: { listingId: i, status: "active" } }));
    const r = searchShells(spec({ sizeSqft: [1500, 3500] }), [...offices, med]).results;
    expect(r.findIndex((x) => x.shell.id === "med")).toBeLessThan(8);
    expect(r.find((x) => x.shell.id === "med")!.reasons).toContain("The scan is a medical suite");
  });

  it("quotes Matterport's classification only when it matches the use", () => {
    const work = searchShells(spec(), [s("w", { sid: "w", useTags: ["medical"], scanClass: "workspace" })]).results[0];
    expect(work.reasons.join(" ")).not.toMatch(/Matterport classifies/);
    expect(work.reasons).toContain("Prior use matches (medical)");
    const care = searchShells(spec(), [s("h", { sid: "h", useTags: ["medical"], scanClass: "healthcare" })]).results[0];
    expect(care.reasons).toContain("Matterport classifies the scan as healthcare");
  });

  it("keeps a shell with unknown size but says so", () => {
    const r = searchShells(spec({ sizeSqft: [2000, 3000] }), [s("nosize", { sid: "q" })]).results;
    expect(r[0].reasons.join(" ")).toMatch(/size unknown/i);
  });
});
