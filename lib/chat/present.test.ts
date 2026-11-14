import { describe, expect, it } from "vitest";
import { compareRows, displayName, draftEmail, highlights, summarizeResults, thinkingSteps, traceSummary } from "./present";
import type { RequirementSpec, ShellReport, TraceEvent } from "../types";

const spec: RequirementSpec = {
  mode: "business", city: "houston", useType: "medical clinic", sizeSqft: [1200, 1800], transaction: "lease",
  rooms: [{ label: "exam room", count: 3, hard: false }, { label: "reception", count: 1, hard: false }],
  needs: { parking: true, heavyPower: true }, priorities: {}, input: "chat",
};

const report = (over: Partial<ShellReport> = {}): ShellReport => ({
  shellId: "A", rank: 1, name: "Suite 1202 · MEDPLACE", address: "1 Main St, Houston, TX", verdict: "Strong fit", summary: "",
  reasons: ["Prior use matches (medical)", "Matterport scan available"], matchScore: 92,
  fit: { score: 94, assignment: [{ req: "exam room #1", roomId: "a", cost: 0 }, { req: "exam room #2", roomId: "b", cost: 0 }, { req: "exam room #3", roomId: "c", cost: 0 }, { req: "reception", roomId: "d", cost: 0 }], edits: [], breakdown: {}, hardFails: [], unknowns: [] },
  rules: [{ rule: "onsite_parking", status: "pass", detail: "40 on-site stalls recorded.", citation: "x", evidence: [] }],
  work: [], weeksToOpen: [1, 4], costRange: [0, 0], unknowns: [], draftMessage: "Hi Pat,\n\nI'm looking for space…", badge: "scan-verified", sources: [],
  floorplan: { sid: "A", name: "A", totalAreaSqft: 1650, rooms: [], edges: [], objects: [], panoCount: 9, floorCount: 1 },
  listing: { listingId: 1, status: "active", kind: "lease", contact: { name: "Pat Lee", email: "pat@example.com" } },
  ...over,
});

describe("highlights", () => {
  it("gives three plain-language reasons grounded in the evidence", () => {
    const h = highlights(report(), spec);
    expect(h).toHaveLength(3);
    expect(h[0]).toBe("Right size for 3 exam rooms + support spaces");
    expect(h[1]).toBe("Clinic-ready layout (minimal build-out)");
    expect(h.join(" ")).toMatch(/on-site parking/i);
  });

  it("only mentions parking when the user asked about it", () => {
    const noParking = { ...spec, needs: {} };
    const r = report({ rules: [{ rule: "parking", status: "pass", detail: "40 recorded stalls", citation: "x", evidence: [] }] });
    expect(highlights(r, noParking).join(" ")).not.toMatch(/parking/i);
    expect(highlights(r, noParking)[2]).toBe("Listed for lease now");
  });

  it("says when size is outside the range instead of pretending it fits", () => {
    const h = highlights(report({ floorplan: { ...report().floorplan!, totalAreaSqft: 3000 } }), spec);
    expect(h[0]).toMatch(/3,000 sq ft.*1,200.1,800/);
  });
});

describe("naming", () => {
  it("strips listing size suffixes from display names", () => {
    expect(displayName("2450 Fondren, Suite 200 - 2,855 SF · Piney Point")).toBe("2450 Fondren, Suite 200");
    expect(displayName("Suite 300B - 1867SF")).toBe("Suite 300B");
    expect(draftEmail(report({ name: "Suite 375 - 1600SF · X" })).subject).toBe("Inquiry about Suite 375 at 1 Main St, Houston, TX");
  });

  it("leads with the main room when describing a layout", () => {
    const s = { ...spec, rooms: [{ label: "reception", count: 1, hard: false }, { label: "exam room", count: 2, hard: false }] };
    expect(highlights(report(), s)[0]).toBe("Right size for 2 exam rooms + support spaces");
  });
});

describe("summarizeResults", () => {
  it("writes the chat reply naming the best fit and offering next steps", () => {
    const s = summarizeResults([report(), report({ shellId: "B", name: "Suite 400", matchScore: 87 })], spec, { considered: 240, dropped: 6 });
    expect(s.paragraphs[0]).toMatch(/240 .*Houston/);
    expect(s.paragraphs[1]).toMatch(/2 strong matches.*Suite 1202.*92%/);
    expect(s.paragraphs[1]).toMatch(/1,650 sq ft/);
    expect(s.followUp).toMatch(/compare the layouts/);
    expect(s.followUp).toMatch(/email/);
  });

  it("explains an empty result and suggests what to relax", () => {
    const s = summarizeResults([], spec, { considered: 40, dropped: 12 });
    expect(s.paragraphs.join(" ")).toMatch(/couldn't find/i);
    expect(s.followUp).toMatch(/size|budget|requirement/i);
  });
});

describe("thinkingSteps", () => {
  const events: TraceEvent[] = [
    { type: "plan", id: "1", text: "plan" },
    { type: "tool", id: "2", tool: "search_shells", args: {}, resultId: "r1", summary: "2659 indexed → 2291 rejected by hard filters → top 50 kept", ms: 3 },
    { type: "tool", id: "3", tool: "screen_sites", args: {}, resultId: "r2", summary: "screened 20", ms: 1 },
    { type: "drop", id: "4", shellId: "X", reason: "zoning: Zone R3 is residential", evidence: [] },
    { type: "tool", id: "5", tool: "evaluate_candidates", args: {}, resultId: "r3", summary: "evaluated 8", ms: 4 },
    { type: "escalate", id: "6", shellId: "A", question: "Is there a sink in the rooms assigned to the requested spaces?", outcome: "not observed" },
  ];

  it("turns real trace events into topical thinking steps", () => {
    const labels = thinkingSteps(events, spec).map((s) => s.label);
    expect(labels[0]).toMatch(/Searching 2,659 spaces in Houston/);
    expect(labels).toEqual(expect.arrayContaining(["Checking local zoning laws", "Checking electrical requirements", "Counting parking", "Measuring rooms in 3D scans"]));
    expect(labels.some((l) => /Ruled out/.test(l))).toBe(true);
    expect(labels.some((l) => /Looking for a sink/.test(l))).toBe(true);
  });

  it("shows regulation research with what it found per jurisdiction", () => {
    const ev: TraceEvent[] = [{ type: "tool", id: "r", tool: "research_regulations", args: {}, resultId: "x", summary: "3 rules (city 1, state 1, federal 1)", ms: 1 }];
    const labels = thinkingSteps(ev, spec).map((s) => s.label);
    expect(labels).toEqual(["Researching Houston and Texas rules for a medical clinic", "Found 1 city rule", "Found 1 state rule", "Found 1 federal rule"]);
  });

  it("only mentions checks the spec asked for", () => {
    const labels = thinkingSteps(events, { ...spec, needs: {} }).map((s) => s.label);
    expect(labels).not.toContain("Checking electrical requirements");
  });
});

describe("traceSummary", () => {
  it("condenses the run into three steps with counts", () => {
    const ev: TraceEvent[] = [
      { type: "tool", id: "1", tool: "search_shells", args: {}, resultId: "r", summary: "2659 indexed → 2291 rejected by hard filters → top 50 kept", ms: 1 },
      { type: "tool", id: "2", tool: "evaluate_candidates", args: {}, resultId: "r", summary: "", ms: 1 },
      { type: "report", id: "3", reports: [report(), report()] },
    ];
    expect(traceSummary(ev)).toEqual(["Searched 50 candidates", "Evaluated fit (layout, size, use)", "Ranked 2 matching spaces"]);
  });
});

describe("draftEmail", () => {
  it("addresses the listing contact with a subject and the drafted body", () => {
    const e = draftEmail(report());
    expect(e).toMatchObject({ to: "pat@example.com", subject: "Inquiry about Suite 1202 at 1 Main St, Houston, TX" });
    expect(e.body).toMatch(/^Hi Pat/);
    expect(e.mailto).toMatch(/^mailto:pat@example\.com\?subject=Inquiry/);
  });

  it("leaves the recipient blank when no contact is on record", () => {
    expect(draftEmail(report({ listing: undefined })).to).toBe("");
  });
});

describe("compareRows", () => {
  it("lines up the matches on the same measures", () => {
    const rows = compareRows([report(), report({ shellId: "B", name: "Suite 400", matchScore: 80, weeksToOpen: [8, 20], costRange: [20000, 60000] })]);
    expect(rows.map((r) => r.label)).toEqual(["Match", "Size", "Rooms already built", "Weeks to open", "Known work", "Parking"]);
    expect(rows[0].values).toEqual(["92%", "80%"]);
    expect(rows[3].values).toEqual(["1–4", "8–20"]);
  });
});
