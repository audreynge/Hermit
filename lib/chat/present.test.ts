import { describe, expect, it } from "vitest";
import { accessLine, compareRows, displayName, draftEmail, highlights, searchCounts, summarizeResults, thinkingSteps, traceSummary } from "./present";
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
  score: [], crew: [], triangulation: [],
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

  it("only calls a space ready when little work is known and most rooms are there", () => {
    const pricey = report({ costRange: [18000, 54000] });
    expect(highlights(pricey, spec)[1]).toBe("Previously used as a clinic");
    const a = report().fit.assignment.map((x, i) => (i < 2 ? x : { ...x, roomId: null }));
    expect(highlights(report({ fit: { ...report().fit, assignment: a } }), spec)[1]).toBe("Previously used as a clinic");
  });

  it("only mentions parking when the user asked about it", () => {
    const noParking = { ...spec, needs: {} };
    const r = report({ rules: [{ rule: "parking", status: "pass", detail: "40 recorded stalls", citation: "x", evidence: [] }] });
    expect(highlights(r, noParking).join(" ")).not.toMatch(/parking/i);
    expect(highlights(r, noParking)[2]).toBe("Listed for lease now");
  });

  it("leads with wheelchair access when the user needs it", () => {
    const wc = { ...spec, needs: { wheelchair: true } };
    const hit = (rule: string, status: "pass" | "fail" | "warn" | "unknown", detail: string) => ({ rule, status, detail, citation: "", evidence: [] });
    const with_ = (...rules: ReturnType<typeof hit>[]) => highlights(report({ rules }), wc);
    expect(with_(hit("door_width", "fail", "Bathroom: ~24.0 in clear"))[0]).toBe("1 door too narrow for the chair (bathroom)");
    expect(with_(hit("door_hinges", "warn", "Office: ~26.5 in clear"), hit("door_hinges", "warn", "Bedroom: x"))[0]).toBe("Chair fits with offset hinges on 2 doors (office, bedroom)");
    expect(with_(hit("wheelchair_route", "pass", "ok"))[0]).toBe("Wheelchair reaches every main room");
    expect(with_(hit("door_width", "unknown", "No measured door"))[0]).toMatch(/not measured/);
    expect(with_(hit("door_width", "fail", "Bathroom: x"))).toHaveLength(3);
    expect(highlights(report({ rules: [hit("door_width", "fail", "Bathroom: x")] }), spec)[0]).not.toMatch(/door/); // not asked for
    expect(accessLine(report({ rules: [hit("wheelchair_route", "pass", "ok")] }), wc)?.ok).toBe(true);
    expect(with_(hit("front_door", "fail", "Front door: ~22 in clear"), hit("door_width", "fail", "Bathroom: x"))[0]).toBe("Front door too narrow for the chair");
    expect(with_(hit("other_floor", "fail", "Bedroom, bathroom (40 sf): on another floor"))[0]).toBe("Bedroom, bathroom (40 sf) on another floor: needs a stair lift");
    expect(accessLine(report({ rules: [hit("door_hinges", "warn", "Office: x")] }), wc)?.ok).toBe(false); // shown with a warning icon, not a check
  });

  it("says when size is outside the range instead of pretending it fits", () => {
    const h = highlights(report({ floorplan: { ...report().floorplan!, totalAreaSqft: 3000 } }), spec);
    expect(h[0]).toMatch(/3,000 sq ft.*1,200.1,800/);
    const below = highlights(report({ floorplan: { ...report().floorplan!, totalAreaSqft: 1155 } }), spec);
    expect(below[0]).toBe("1,155 sq ft (you asked for 1,200–1,800)");
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
    expect(s.paragraphs).toHaveLength(1);
    expect(s.paragraphs[0]).toMatch(/2 strong matches.*Houston.*Suite 1202/);
    expect(s.paragraphs[0]).not.toMatch(/240|%/);
    expect(s.paragraphs[0]).toMatch(/1,650 sq ft/);
    expect(s.followUp).toMatch(/compare the layouts/);
    expect(s.followUp).toMatch(/email/);
    expect(s.followUp.match(/\?/g)).toHaveLength(1);
  });

  it("mentions the size once when the best match is outside the range", () => {
    const s = summarizeResults([report({ floorplan: { ...report().floorplan!, totalAreaSqft: 1520 } })], { ...spec, sizeSqft: [2000, 3000] }, { considered: 3, dropped: 0 });
    expect(s.paragraphs[0].match(/1,520 sq ft/g)).toHaveLength(1);
    expect(s.paragraphs[0]).toMatch(/1,520 sq ft \(you asked for 2,000–3,000\)/);
  });

  it("states an out-of-range size once, with what was asked for", () => {
    const s = summarizeResults([report({ floorplan: undefined, listing: undefined, sqft: 2400 })], spec, { considered: 10, dropped: 0 });
    expect(s.paragraphs[0]).toMatch(/it's 2,400 sq ft \(you asked for 1,200–1,800\)/);
    expect(s.paragraphs[0].match(/2,400/g)).toHaveLength(1);
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
    { type: "tool", id: "2", tool: "search_shells", args: {}, resultId: "r1", summary: "2659 indexed → 2291 rejected by hard filters → 368 kept", ms: 3 },
    { type: "tool", id: "3", tool: "screen_sites", args: {}, resultId: "r2", summary: "screened 20", ms: 1 },
    { type: "drop", id: "4", shellId: "X", reason: "zoning: Zone R3 is residential", evidence: [] },
    { type: "tool", id: "5", tool: "evaluate_candidates", args: {}, resultId: "r3", summary: "evaluated 8", ms: 4 },
    { type: "escalate", id: "6", shellId: "A", question: "Is there a sink in the rooms assigned to the requested spaces?", outcome: "not observed" },
  ];

  it("turns real trace events into topical thinking steps", () => {
    const labels = thinkingSteps(events, spec).map((s) => s.label);
    expect(labels[0]).toBe("Searched spaces in Houston");
    expect(labels.join(" ")).not.toMatch(/2,?659/);
    expect(labels).toEqual(expect.arrayContaining(["Checked zoning rules", "Checked electrical power", "Looked at parking from above", "Measured the rooms"]));
    expect(labels.every((l) => l.split(" ").length <= 7)).toBe(true);
    expect(labels.some((l) => /Ruled out/.test(l))).toBe(true);
    expect(labels.some((l) => /Looked for a sink/.test(l))).toBe(true);
  });

  it("organizes regulation research by government level", () => {
    const ev: TraceEvent[] = [{ type: "tool", id: "r", tool: "research_regulations", args: {}, resultId: "x", summary: "3 rules (city 1, state 1, federal 1)", ms: 1 }];
    const labels = thinkingSteps(ev, spec).map((s) => s.label);
    expect(labels).toEqual(["City: Houston permitting", "State: Texas licensing", "Federal: ADA"]);
  });

  it("only mentions checks the spec asked for", () => {
    const labels = thinkingSteps(events, { ...spec, needs: {} }).map((s) => s.label);
    expect(labels).not.toContain("Checked electrical power");
  });
});

describe("traceSummary", () => {
  it("condenses the run into three steps with counts", () => {
    const ev: TraceEvent[] = [
      { type: "tool", id: "1", tool: "search_shells", args: {}, resultId: "r", summary: "2659 indexed → 2291 rejected by hard filters → 368 kept", ms: 1 },
      { type: "tool", id: "2", tool: "evaluate_candidates", args: {}, resultId: "r", summary: "", ms: 1 },
      { type: "report", id: "3", reports: [report(), report()] },
    ];
    expect(traceSummary(ev)).toEqual(["Found 368 spaces that pass your filters", "Evaluated fit (layout, size, use)", "Ranked 2 matching spaces"]);
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

  it("names the layout-matching step when the agent compared a drawing", () => {
    const ev = [{ type: "tool", id: "t", tool: "match_layout", args: {}, resultId: "r", summary: "compared your 5-room layout with 368 scanned floor plans; most similar 85% (X)", ms: 3 }] as TraceEvent[];
    expect(traceSummary(ev)).toEqual(["Matched your layout against 368 floor plans"]);
    expect(thinkingSteps(ev, { city: "houston", mode: "business", rooms: [], needs: {} } as never)[0].label).toBe("Compared your drawing to floor plans");
  });

  it("leads card highlights with layout similarity when the user drew a plan", () => {
    const r = { reasons: [], fit: { assignment: [] }, rules: [], similarity: { score: 81, scale: 1, breakdown: { program: 80, adjacency: null, size: 90, shape: 70 }, pairs: [] } } as unknown as ShellReport;
    expect(highlights(r, { needs: {} } as RequirementSpec)[0]).toBe("Floor plan 81% like your drawing");
  });
});

describe("searchCounts", () => {
  const tool = (summary: string): TraceEvent => ({ type: "tool", id: "1", tool: "search_shells", args: {}, resultId: "r", summary, ms: 1 });
  it("reads the stage path with thousands separators and numbers inside labels", () => {
    expect(searchCounts([tool("2,659 scans indexed → 2,074 in Houston → 433 commercial spaces (not apartment amenities) → 350 2,000–3,000 sf (or size unknown) → 345 built for salon or a close use; 345 kept")]))
      .toEqual({ indexed: 2659, considered: 345, kept: 345 });
  });
  it("still reads older recorded runs", () => {
    expect(searchCounts([tool("2659 indexed → 2291 rejected by hard filters → 368 kept")])).toEqual({ indexed: 2659, considered: 368, kept: 368 });
  });
});
