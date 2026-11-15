import { describe, expect, it } from "vitest";
import { buildReport, type Evaluation } from "./report";
import type { RequirementSpec, RuleHit, Shell } from "../types";

const shell: Shell = {
  id: "H1", mode: "home", city: "houston", name: "101 Sample Lane", address: "101 Sample Lane, Houston, TX",
  propertyType: "Residential", subtype: "Residential", useTags: ["home"], sprinkler: "unknown", heavyPower: null,
  driveInBays: null, loadingDocks: null, parkingSpaces: null, zoning: null, elevator: null,
};
const spec: RequirementSpec = { mode: "home", city: "houston", useType: "home", rooms: [], needs: { wheelchair: true, chairWidthIn: 25 }, priorities: {}, input: "survey" };
const hit = (rule: string, status: RuleHit["status"], detail: string): RuleHit => ({ rule, status, detail, citation: "", evidence: [] });
const evaluation = (rules: RuleHit[]): Evaluation => ({
  shell, searchScore: 50, searchReasons: [], graph: null, rules, finalScore: 60, escalations: [], lines: [], verdicts: [],
  fit: { score: 60, assignment: [], edits: [], breakdown: {}, hardFails: [], unknowns: [] },
  work: { items: [], weeksToOpen: [1, 4], costRange: [0, 0] },
});

describe("buildReport inquiry for a wheelchair user", () => {
  it("states the chair and asks about each narrow door by room and measured width", () => {
    const r = buildReport(spec, evaluation([
      hit("door_width", "fail", "Bathroom: widest door in (from office) is ~24.0 in clear, 1.0 in short of a 25 in chair."),
      hit("door_hinges", "warn", "Office: widest door in (from bedroom) is ~24.5 in clear, 0.5 in short of a 25 in chair. Offset hinges would let it in."),
    ]), 1);
    expect(r.draftMessage).toMatch(/wheelchair user \(the chair is 25 in wide\)/);
    expect(r.draftMessage).toMatch(/- The bathroom door looks about 24\.0 in clear in the 3D tour\. .*widened\?/);
    expect(r.draftMessage).toMatch(/- The office door looks about 24\.5 in clear .*offset\) hinges on it\?/);
    expect(r.unknowns.filter((u) => u.topic === "door")).toHaveLength(2);
  });

  it("says nothing about wheelchairs when the user didn't ask", () => {
    const r = buildReport({ ...spec, needs: {} }, evaluation([]), 1);
    expect(r.draftMessage).not.toMatch(/wheelchair/);
  });
});

describe("buildReport room counts", () => {
  const biz: RequirementSpec = { mode: "business", city: "houston", useType: "dental clinic", rooms: [{ label: "exam room", count: 2, hard: false }, { label: "restroom", count: 2, hard: false }], needs: {}, priorities: {}, input: "survey" };
  const g = { sid: "S", name: "S", totalAreaSqft: 600, rooms: ["a", "b", "w", "v"].map((id) => ({ id, label: id < "c" ? "exam room" : "bathroom", rawTags: [], areaSqft: 100, polygon: [], floorId: "f" })), edges: [], objects: [], panoCount: 1, floorCount: 1 };
  const withFit = (assignment: { req: string; roomId: string | null; cost: number }[], unknowns: string[] = []): Evaluation =>
    ({ ...evaluation([]), shell: { ...shell, mode: "business" }, graph: g, finalScore: 85, fit: { score: 85, assignment, edits: [], breakdown: {}, hardFails: [], unknowns } });

  it("never says Likely fits while a restroom is unconfirmed", () => {
    const r = buildReport(biz, withFit([{ req: "exam room #1", roomId: "a", cost: 0 }, { req: "exam room #2", roomId: "b", cost: 0 }, { req: "restroom #1", roomId: "w", cost: 0 }, { req: "restroom #2", roomId: null, cost: 70 }], ["restroom #2: not identifiable in scan S"]), 1);
    expect(r.verdict).toBe("Rooms to confirm");
    expect(r.summary).toMatch(/^3 of 4 rooms already built\. No build-out found in the scan\. About \d+ to \d+ weeks to open/);
  });

  it("says Likely fits only when every count is met", () => {
    const r = buildReport(biz, withFit([{ req: "exam room #1", roomId: "a", cost: 0 }, { req: "exam room #2", roomId: "b", cost: 0 }, { req: "restroom #1", roomId: "w", cost: 0 }, { req: "restroom #2", roomId: "v", cost: 0 }]), 1);
    expect(r.verdict).toBe("Likely fits");
    expect(r.reasons[0]).toBe("2 of 2 exam rooms, 2 of 2 restrooms already built");
  });
});
