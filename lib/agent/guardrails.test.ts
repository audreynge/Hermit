import { describe, expect, it } from "vitest";
import { runAgent, type AgentDeps } from "./loop";
import { Run } from "./tools";
import type { AerialCount, PanoCheck, RequirementSpec, Room, RoomGraph, Shell, TraceEvent } from "../types";

const shell = (id: string, over: Partial<Shell> = {}): Shell => ({
  id, sid: id, mode: "business", city: "houston", name: `Suite ${id}`, address: `${id} Main St, Houston, TX`, lat: 29.7, lon: -95.4,
  propertyId: 100, propertyType: "Office", subtype: "Office_Medical", useTags: ["medical"], sqft: 2500, sqftSource: "listing space",
  sprinkler: "wet", heavyPower: null, driveInBays: null, loadingDocks: null, parkingSpaces: 40, zoning: null, elevator: true,
  constructionStatus: "Existing", listing: { listingId: 1, status: "active" }, ...over,
});
const room = (id: string, label: string, areaSqft: number): Room => ({ id, label, rawTags: [label], areaSqft, polygon: [], floorId: "f" });
const clinic = (sid: string): RoomGraph => {
  const rooms = [room(`${sid}e1`, "exam room", 120), room(`${sid}e2`, "exam room", 120), room(`${sid}b`, "bathroom", 50), room(`${sid}r`, "reception", 200), room(`${sid}o`, "office", 100), room(`${sid}s`, "storage", 50)];
  return { sid, name: sid, totalAreaSqft: rooms.reduce((s, r) => s + r.areaSqft, 0), rooms, edges: [], objects: [], panoCount: 10, floorCount: 1 };
};
const spec = (over: Partial<RequirementSpec> = {}): RequirementSpec => ({ mode: "business", city: "houston", useType: "pediatric clinic", rooms: [], needs: {}, priorities: {}, input: "survey", ...over });
const aerial = (sid: string, n: number | null, confidence = 0.8, over: Partial<AerialCount> = {}): AerialCount => ({
  sid, provider: "vexcel", scope: "around-building", stalls: { n, lo: n, hi: n, confidence }, rooftopUnits: { n: 3, confidence: 0.8 }, garageLikely: false,
  boxes: [], image: `aerial/${sid}.jpg`, model: "test", source: "test count", retrieved: "2026-11-15", ...over,
});
const check = (sid: string, roomId: string, result: PanoCheck["result"], note = "A sink with a cabinet."): PanoCheck => ({
  sid, roomId, feature: "sink", result, panoId: `p_${roomId}`, face: 2, confidence: result === "seen" ? 0.8 : result === "not_seen" ? 0.6 : 0.3, note, model: "test", retrieved: "2026-11-15",
});

function deps(shells: Shell[], over: Partial<AgentDeps> = {}): AgentDeps {
  return { shells: () => shells, graph: (sid) => clinic(sid), aerial: () => null, panoCheck: () => null, look: null, ...over };
}
async function go(s: RequirementSpec, d: AgentDeps) {
  const events: TraceEvent[] = [];
  const reports = await runAgent(s, (e) => events.push(e), d, { client: null, gemini: null, openai: null });
  return { events, reports };
}
const of = <T extends TraceEvent["type"]>(ev: TraceEvent[], t: T) => ev.filter((e) => e.type === t) as Extract<TraceEvent, { type: T }>[];

describe("parking from the record and the Vexcel aerial", () => {
  it("drops a space when the aerial is short and the record has no count, naming the space", async () => {
    const { events, reports } = await go(spec({ needs: { parkingStalls: 10 } }), deps([shell("A", { parkingSpaces: null }), shell("B"), shell("C")], { aerial: (sid) => (sid === "A" ? aerial("A", 4) : null) }));
    const drop = of(events, "drop").find((d) => d.shellId === "A");
    expect(drop?.reason).toBe("Suite A, A Main St: room for about 4 cars around the building on the Vexcel aerial; you need 10.");
    expect(drop?.evidence[0]).toMatchObject({ source: "Vexcel ortho (counted)", ref: "aerial:A" });
    expect(reports.map((r) => r.shellId)).not.toContain("A");
  });

  it("warns and asks, without dropping, when the record and the aerial disagree", async () => {
    const { events, reports } = await go(spec({ needs: { parkingStalls: 10 } }), deps([shell("A", { parkingSpaces: 40 })], { aerial: () => aerial("A", 3) }));
    expect(of(events, "drop")).toHaveLength(0);
    const r = reports[0];
    const hit = r.rules.find((h) => h.rule === "onsite_parking")!;
    expect(hit.status).toBe("warn");
    expect(hit.detail).toMatch(/records disagree: 40 recorded stalls \(CoStar\), but room for about 3 cars/);
    expect(r.unknowns.some((u) => /disagree.*How many stalls come with the space/.test(u.question))).toBe(true);
    expect(r.aerial?.stalls.n).toBe(3);
    const tri = r.triangulation!.find((t) => t.claim === "Room for 10 cars")!;
    expect(tri.verdict).toBe("conflict");
    expect(r.triangulation!.find((t) => t.claim === "Rooftop AC units")?.cells.aerial.state).toBe("agree");
    expect(r.crew!.find((v) => v.agent === "surveyor")?.status).toBe("warn");
  });

  it("treats a zero count as no marked lot seen: a question, never a drop", async () => {
    const { events, reports } = await go(spec({ needs: { parkingStalls: 10 } }), deps([shell("A", { parkingSpaces: null })], { aerial: () => aerial("A", 0) }));
    expect(of(events, "drop")).toHaveLength(0);
    expect(reports[0].rules.find((h) => h.rule === "onsite_parking")?.status).toBe("unknown");
    expect(reports[0].unknowns.some((u) => u.question === "Where do patients or customers park? The aerial shows no marked surface lot around the building.")).toBe(true);
  });

  it("never passes on an aerial that couldn't be counted", async () => {
    const { reports } = await go(spec({ needs: { parkingStalls: 10 } }), deps([shell("A", { parkingSpaces: null })], { aerial: () => aerial("A", null, 0.2) }));
    expect(reports[0].rules.find((h) => h.rule === "onsite_parking")?.status).toBe("unknown");
  });
});

describe("Hermit looked closer", () => {
  const sink = (result: PanoCheck["result"], note?: string) => deps([shell("A")], { panoCheck: (sid, roomId, f) => (f === "sink" && /e\d$/.test(roomId) ? check(sid, roomId, result, note) : null) });

  it("seen resolves the sink: no work item, photo evidence, and a plain outcome", async () => {
    const { events, reports } = await go(spec(), sink("seen"));
    const esc = of(events, "escalate")[0];
    expect(esc.result).toBe("seen");
    expect(esc.outcome).toBe("Looked closer at Suite A, A Main St: a sink is visible in exam rooms #1 and #2.");
    expect(esc.evidence?.[0]).toMatchObject({ source: "Matterport scan photo", ref: "pano:p_Ae1 face 2" });
    const r = reports[0];
    expect(r.checks?.filter((c) => c.result === "seen")).toHaveLength(2);
    expect(r.work.some((w) => /Add sink to exam room/.test(w.item))).toBe(false);
    expect(r.inside?.sweepId).toBe("p_Ae1");
  });

  it("not_seen keeps the work item to add the sink", async () => {
    const { events, reports } = await go(spec(), sink("not_seen", "There is no sink in this room."));
    expect(of(events, "escalate")[0].outcome).toBe("Looked closer at Suite A, A Main St: no sink in exam rooms #1 and #2.");
    expect(reports[0].work.map((w) => w.item)).toEqual(expect.arrayContaining(["Add sink to exam room #1", "Add sink to exam room #2"]));
  });

  it("unclear becomes a landlord question", async () => {
    const { events, reports } = await go(spec(), sink("unclear", "No scan photo was taken inside this room."));
    const esc = of(events, "escalate")[0];
    expect(esc.result).toBe("unclear");
    expect(esc.outcome).toMatch(/couldn't tell if exam rooms #1 and #2 have a sink \(no scan photo was taken inside this room\)/);
    expect(reports[0].unknowns).toEqual(expect.arrayContaining([{ topic: "looked closer", question: "Is there a sink in exam room #1? No scan photo was taken inside this room." }]));
  });

  it("falls back to 'not looked at' when the live photo check fails, and stops asking", async () => {
    let calls = 0;
    const look = async () => { calls++; throw new Error("Gemini 402: credits depleted"); };
    const { events, reports } = await go(spec(), deps([shell("A"), shell("B")], { look }));
    expect(calls).toBe(1);
    const esc = of(events, "escalate");
    expect(esc[0].outcome).toBe("Looked closer at Suite A, A Main St: exam rooms #1 and #2 weren't looked at (the photo check couldn't run).");
    expect(esc[0].result).toBe("unclear");
    expect(of(events, "error").some((e) => /Live photo check unavailable \(Gemini 402\)/.test(e.message))).toBe(true);
    expect(reports.length).toBeGreaterThan(0);
  });

  it("calls the live photo check when nothing is cached, at most twice per run", async () => {
    let calls = 0;
    const look = async (sid: string, roomId: string) => { calls++; return [check(sid, roomId, "seen")]; };
    const { events } = await go(spec(), deps([shell("A"), shell("B")], { look }));
    expect(calls).toBeLessThanOrEqual(2);
    expect(of(events, "escalate").some((e) => e.result === "seen")).toBe(true);
  });

  it("swaps the top pick on photo evidence and quotes it", async () => {
    // A ranks first on search (class A); its exam rooms couldn't be seen. B's sinks are visible.
    const panoCheck = (sid: string, roomId: string, f: string) => (f !== "sink" || !/e\d$/.test(roomId) ? null : sid === "A" ? check(sid, roomId, "unclear", "No scan photo was taken inside this room.") : check(sid, roomId, "seen"));
    const { events, reports } = await go(spec(), deps([shell("A", { buildingClass: "A" }), shell("B")], { panoCheck }));
    expect(reports[0].shellId).toBe("B");
    const rerank = of(events, "rerank")[0];
    expect(rerank.reason).toBe("Changed the top pick: Suite B, B Main St's exam-room sinks are visible in the scan photos; Suite A, A Main St's couldn't be confirmed (no scan photo was taken inside this room).");
    expect(rerank.evidence?.some((e) => e.ref === "pano:p_Be1 face 2")).toBe(true);
  });
});

describe("planner guardrails", () => {
  it("returns the cached result for a repeated search", async () => {
    const events: TraceEvent[] = [];
    const run = new Run(spec(), (e) => events.push(e), deps([shell("A"), shell("B")]));
    const a = (await run.call("search_shells", {})) as { top: unknown[] };
    const b = (await run.call("search_shells", {})) as { top: unknown[]; note?: string };
    expect(b.top).toEqual(a.top);
    expect(b.note).toMatch(/cached/);
    expect(of(events, "funnel")).toHaveLength(1);
  });

  it("refuses to evaluate or inspect a space that was already ruled out", async () => {
    const run = new Run(spec(), () => {}, deps([shell("A"), shell("B")]));
    await run.call("search_shells", {});
    await run.call("drop_candidate", { drops: [{ shellId: "A", reason: "too far" }] });
    const ev = (await run.call("evaluate_candidates", { shellIds: ["A"] })) as { error?: string; refused: { id: string; reason: string }[] };
    expect(ev.refused[0].reason).toBe("Suite A, A Main St was already ruled out: too far. Pick a candidate that is still in.");
    const look = (await run.call("inspect_view", { shellId: "A", question: "Is there a sink?" })) as { error: string };
    expect(look.error).toMatch(/already ruled out/);
    expect(run.inspections).toBe(0);
  });

  it("auto-submits when the planner finishes with no reports", async () => {
    const turns = [
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "search_shells", input: {} }] },
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "submit_reports", input: { shellIds: [] } }] },
    ];
    const client = { beta: { messages: { create: async () => { const t = turns.shift(); if (!t) throw new Error("no more turns"); return t; } } } };
    const events: TraceEvent[] = [];
    const reports = await runAgent(spec(), (e) => events.push(e), deps([shell("A"), shell("B")]), { client: client as never });
    expect(reports.length).toBeGreaterThan(0);
    expect(of(events, "plan").some((p) => /finished without a report/.test(p.text))).toBe(true);
  });
});
