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
