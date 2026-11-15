import { describe, expect, it } from "vitest";
import type { PanoCheck, RequirementSpec, RoomGraph, ShellReport } from "../types";
import { tidyReport, tidyUnknowns } from "../agent/report";
import { fitLead, fitRows, fitShort, openLine, sizeText, summaryLine } from "./rooms";

const room = (id: string, label: string) => ({ id, label, areaSqft: 100 }) as RoomGraph["rooms"][number];
const report = {
  fit: { score: 70, edits: [], breakdown: {}, hardFails: [], unknowns: [], assignment: [
    { req: "exam room #1", roomId: "r1", cost: 15 }, { req: "exam room #2", roomId: "r2", cost: 15 },
    { req: "bathroom", roomId: "r3", cost: 0 }, { req: "reception", roomId: "r4", cost: 0 }, { req: "lab", roomId: null, cost: 70 },
  ] },
  floorplan: { rooms: [room("r1", "other"), room("r2", "other"), room("r3", "bathroom"), room("r4", "reception")] } as RoomGraph,
} as Pick<ShellReport, "fit" | "floorplan">;
const spec = { mode: "business", city: "houston", useType: "clinic", rooms: [{ label: "exam room", count: 2, hard: false, fixtures: ["sink"] }, { label: "reception", count: 1, hard: false }], needs: {}, priorities: {}, input: "text" } as RequirementSpec;
const sink = (roomId: string, result: PanoCheck["result"] = "seen") => ({ sid: "S", roomId, feature: "sink", result, note: "A sink on the counter.", confidence: 0.8, model: "gemini" }) as PanoCheck;

describe("Will it fit?", () => {
  it("separates rooms already built from rooms that could become them", () => {
    const rows = fitRows(report);
    expect(rows.built).toEqual(["bathroom", "reception"]);
    expect(rows.convert).toEqual([{ req: "exam room #1", from: "an unlabeled room" }, { req: "exam room #2", from: "an unlabeled room" }]);
    expect(rows.toBuild).toEqual(["lab"]);
    expect(fitLead(rows)).toBe("2 of 5 rooms already built. 2 more could be made from rooms that are here. 1 would need to be built new.");
  });

  it("never calls a matched room built when the scan can't say what it is", () => {
    const rows = fitRows({ ...report, floorplan: undefined });
    expect(rows.built).toEqual([]);
    expect(rows.convert).toHaveLength(4);
  });

  it("counts an unlabeled room with the sink seen in its photo as set up for the exam room, in one phrase", () => {
    const rows = fitRows({ ...report, checks: [sink("r1"), sink("r2")] }, spec);
    expect(rows.setUp.map((s) => s.req)).toEqual(["exam room #1", "exam room #2"]);
    expect(fitShort(rows)).toBe("2 of 5 rooms already built, plus 2 set up as exam rooms (sinks seen)");
    expect(fitLead(rows)).toBe("2 of 5 rooms already built, plus 2 set up as exam rooms (sinks seen). 1 would need to be built new.");
    // A sink that isn't seen doesn't count.
    expect(fitRows({ ...report, checks: [sink("r1"), sink("r2", "unclear")] }, spec).setUp).toHaveLength(1);
  });

  it("calls a room the scan couldn't label a question, not something to build", () => {
    const rows = fitRows({ ...report, fit: { ...report.fit, unknowns: ["lab: not identifiable in scan S"] } });
    expect(rows.unsure).toEqual(["lab"]);
    expect(fitLead(rows)).toMatch(/1 couldn't be told from the scan, so it's a question for the landlord\.$/);
  });
});

describe("one number everywhere", () => {
  it("labels measured vs listing size", () => {
    expect(sizeText({ floorplan: { totalAreaSqft: 2322.4 } as RoomGraph, listing: { listingId: 1, status: "active", kind: "lease", availableSqft: 3022 } })).toBe("about 2,322 sq ft measured (listing says 3,022)");
    expect(sizeText({ floorplan: { totalAreaSqft: 2322 } as RoomGraph, sqft: 2400 })).toBe("about 2,322 sq ft measured");
    expect(sizeText({ sqft: 3022 })).toBe("3,022 sq ft (record, not measured)");
  });

  it("says the opening time the same way, and the summary uses the opening plan", () => {
    expect(openLine([4, 6])).toBe("About 4 to 6 weeks to open, including signing the lease.");
    const s = summaryLine({ ...report, checks: [sink("r1"), sink("r2")], work: [], costRange: [0, 0], unknowns: [], address: "1 Main St, Houston, TX", useTags: ["medical"] }, spec);
    expect(s).toBe("2 of 5 rooms already built, plus 2 set up as exam rooms (sinks seen). No build-out found in the scan. About 4 to 6 weeks to open, including signing the lease.");
  });
});

describe("landlord questions", () => {
  const asks = [
    { topic: "unverified build-out", question: "Do the exam rooms have their own sinks?" },
    { topic: "accessibility", question: "Is there a step-free entry and an accessible restroom on this floor?" },
    { topic: "zoning", question: "Are there deed restrictions or zoning conditions that would limit our use?" },
    { topic: "parking", question: "Where do patients or customers park? The aerial shows no marked surface lot around the building." },
    { topic: "code", question: "Houston has no use zoning; check deed restrictions and the plat for this lot — can you confirm?" },
    { topic: "access", question: "Is the entry step-free, and is there an accessible restroom (60 in turning space) in the suite?" },
  ];

  it("drops the sink question once the photos show sinks in every exam room, and asks zoning and step-free once", () => {
    const out = tidyUnknowns(asks, { ...report, checks: [sink("r1"), sink("r2")] }, spec).map((u) => u.question);
    expect(out).toEqual([asks[1].question, asks[2].question, asks[3].question]);
    // Not seen: the sink question stays.
    expect(tidyUnknowns(asks, report, spec)[0].question).toBe("Do the exam rooms have their own sinks?");
  });

  it("merges rooms Hermit couldn't look at into one question, and keeps the draft in step", () => {
    const raw = [
      { topic: "looked closer", question: "Is there a sink in exam room #1? Hermit didn't get to look at that room's photos." },
      { topic: "looked closer", question: "Is there a sink in exam room #2? Hermit didn't get to look at that room's photos." },
      asks[0],
    ];
    const out = tidyUnknowns(raw, report, spec);
    expect(out).toEqual([{ topic: "looked closer", question: "Do exam rooms #1 and #2 have sinks? Hermit couldn't look closer at those rooms this time." }]);
    const r = { ...report, unknowns: raw, rules: [], checks: [], draftMessage: `Hi,\n\nI'm looking for space for a clinic in Houston (about 1,500–3,500 sf) and Suite 1 looks promising: 0 of 2 exam rooms, 1 of 1 restroom already built; 2 unlabeled rooms could become exam rooms already look built.\n\nCould you help with a few questions?\n- ${raw[0].question}\n- ${raw[1].question}\n- ${raw[2].question}\n- Is the space available?\n\nThanks!` } as unknown as ShellReport;
    const t = tidyReport(r, spec);
    expect(t.draftMessage).toContain("(about 1,500–3,500 sq ft) and Suite 1 looks promising: in the 3D tour, 2 of 5 rooms already built.\n");
    expect(t.draftMessage).toContain(`- ${out[0].question}\n- Is the space available?`);
    expect(t.draftMessage).not.toContain("own sinks");
    expect(tidyReport(t, spec).draftMessage).toBe(t.draftMessage);
  });
});
