import { describe, expect, it } from "vitest";
import { runAgent, type AgentDeps } from "./loop";
import type { RequirementSpec, Room, RoomGraph, Shell, TraceEvent } from "../types";

const shell = (id: string, over: Partial<Shell> = {}): Shell => ({
  id, sid: id, mode: "business", city: "houston", name: `Suite ${id}`, address: `${id} Main St, Houston, TX`, lat: 29.7, lon: -95.4,
  propertyId: 100, propertyType: "Office", subtype: "Office_Medical", useTags: ["medical"], sqft: 2500, sqftSource: "listing space",
  sprinkler: "wet", heavyPower: null, driveInBays: null, loadingDocks: null, parkingSpaces: 40, zoning: null, elevator: true,
  constructionStatus: "Existing", listing: { listingId: 1, status: "active", contact: { name: "Pat Lee", company: "Acme" } }, ...over,
});
const room = (id: string, label: string, areaSqft: number): Room => ({ id, label, rawTags: [label], areaSqft, polygon: [], floorId: "f" });
const graph = (sid: string, rooms: Room[], extra: Partial<RoomGraph> = {}): RoomGraph => ({
  sid, name: sid, totalAreaSqft: rooms.reduce((s, r) => s + r.areaSqft, 0), rooms, edges: [], objects: [], panoCount: 12, floorCount: 1, ...extra,
});

const goodRooms = [room("e1", "office", 120), room("e2", "office", 120), room("e3", "office", 110), room("b1", "bathroom", 60), room("r", "reception", 300), room("o", "other", 1500)];

const spec: RequirementSpec = {
  mode: "business", city: "houston", useType: "dental clinic", sizeSqft: [2000, 3000],
  rooms: [{ label: "exam room", count: 3, minSqft: 100, fixtures: ["sink"], hard: false }, { label: "bathroom", count: 1, hard: true }],
  needs: { heavyPower: true }, priorities: {}, input: "text",
};

function deps(): AgentDeps {
  const shells = [
    // Ranks first on search (class A + medical + scan) but its scan has no bathroom: should be dropped after evaluation.
    shell("A", { buildingClass: "A" }),
    shell("B"),
    shell("C", { heavyPower: false }),
    shell("D", { sid: undefined, id: "D" }),
    shell("E", { useTags: ["office"] }),
    ...Array.from({ length: 12 }, (_, i) => shell(`F${i}`, { useTags: ["office"], listing: undefined })),
  ];
  const graphs: Record<string, RoomGraph> = {
    A: graph("A", [room("x", "office", 900), room("y", "office", 900), room("z", "office", 700)]),
    B: graph("B", goodRooms, { objects: [{ label: "sink", roomId: "e1", confidence: 0.9 }] }),
    C: graph("C", goodRooms),
    E: graph("E", goodRooms),
  };
  for (let i = 0; i < 12; i++) graphs[`F${i}`] = graph(`F${i}`, goodRooms);
  return { shells: () => shells, graph: (sid) => graphs[sid] ?? null };
}

async function run(d = deps()) {
  const events: TraceEvent[] = [];
  await runAgent(spec, (e) => events.push(e), d);
  return events;
}

describe("deterministic agent", () => {
  it("emits plan, tool, report and done events within budget", async () => {
    const ev = await run();
    expect(ev[0].type).toBe("plan");
    const done = ev.find((e) => e.type === "done") as Extract<TraceEvent, { type: "done" }>;
    expect(done.planner).toBe("deterministic");
    expect(done.toolCalls).toBeLessThanOrEqual(25);
    const report = ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    expect(report.reports.length).toBeGreaterThan(0);
    expect(report.reports.length).toBeLessThanOrEqual(5);
    expect(ev.filter((e) => e.type === "tool").every((e) => (e as { resultId: string }).resultId)).toBe(true);
  });

  it("drops a candidate on recorded evidence and never reports it", async () => {
    const events: TraceEvent[] = [];
    await runAgent({ ...spec, needs: { heavyPower: true, esfr: true } }, (e) => events.push(e), deps());
    const ev = events;
    const drops = ev.filter((e) => e.type === "drop") as Extract<TraceEvent, { type: "drop" }>[];
    const c = drops.find((d) => d.shellId === "C");
    expect(c?.reason).toMatch(/power/i);
    expect(c?.evidence[0].ref).toMatch(/hasHeavyPower/);
    const report = ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    expect(report.reports.map((r) => r.shellId)).not.toContain("C");
  });

  it("vetoes the search leader when its scan lacks a required room, changing the top pick", async () => {
    const ev = await run();
    const veto = ev.find((e) => e.type === "veto" && e.shellId === "A") as Extract<TraceEvent, { type: "veto" }> | undefined;
    expect(veto?.agent).toBe("inspector");
    expect(veto?.reason).toMatch(/bathroom not found/);
    expect(ev.some((e) => e.type === "rerank")).toBe(true);
    const report = ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    expect(report.reports[0].shellId).not.toBe("A");
  });

  it("escalates an unverified fixture on a top candidate instead of assuming it", async () => {
    const ev = await run();
    const esc = ev.filter((e) => e.type === "escalate") as Extract<TraceEvent, { type: "escalate" }>[];
    expect(esc.length).toBeGreaterThan(0);
    expect(esc.length).toBeLessThanOrEqual(4);
    expect(esc[0].question).toBe("Does the exam room have a sink?");
  });

  it("keeps a single fixable code gap as priced work and batches drops into one call", async () => {
    const d = deps();
    const all = d.shells();
    const shells = [
      ...all.slice(0, 3),
      ...Array.from({ length: 10 }, (_, i) => shell(`X${i}`, { heavyPower: false, driveInBays: 0 })),
    ];
    const events: TraceEvent[] = [];
    await runAgent({ ...spec, needs: { heavyPower: true, driveInBays: 1 } }, (e) => events.push(e), { ...d, shells: () => shells });
    const dropCalls = events.filter((e) => e.type === "tool" && e.tool === "drop_candidate");
    const drops = events.filter((e) => e.type === "drop").map((e) => (e as { shellId: string }).shellId);
    expect(drops).toEqual(expect.arrayContaining(["X0", "X9"]));
    expect(drops).not.toContain("C");
    expect(dropCalls.length).toBeLessThanOrEqual(2);
    const report = events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    const c = report.reports.find((r) => r.shellId === "C");
    if (c) expect(c.work.some((w) => /service upgrade/i.test(w.item))).toBe(true);
  });

  it("does not report an unrelated object as the fixture asked about", async () => {
    const d = deps();
    const g = d.graph;
    d.graph = (sid) => (sid === "B" ? { ...g("B")!, objects: [{ label: "chair", roomId: "e1", confidence: 0.5 }] } : g(sid));
    const events: TraceEvent[] = [];
    await runAgent(spec, (e) => events.push(e), d);
    const esc = events.filter((e) => e.type === "escalate") as Extract<TraceEvent, { type: "escalate" }>[];
    expect(esc.length).toBeGreaterThan(0);
    for (const e of esc) expect(e.outcome).not.toMatch(/^observed/);
  });

  it("reads at most 8 room graphs", async () => {
    let reads = 0;
    const d = deps();
    const g = d.graph;
    d.graph = (sid) => { reads++; return g(sid); };
    await run(d);
    expect(reads).toBeLessThanOrEqual(8);
  });

  it("only consults Access when the user needs step-free access, and Access can veto a multi-level scan", async () => {
    const skipped = await run();
    expect(skipped.some((e) => e.type === "handoff" && e.to === "access" && e.skipped)).toBe(true);
    const d = deps();
    const g = d.graph;
    d.graph = (sid) => (sid === "B" ? { ...g("B")!, floorCount: 2 } : g(sid));
    const shells = d.shells().map((s) => (s.id === "B" ? { ...s, elevator: null } : s));
    const events: TraceEvent[] = [];
    await runAgent({ ...spec, needs: { wheelchair: true } }, (e) => events.push(e), { ...d, shells: () => shells });
    const veto = events.find((e) => e.type === "veto" && e.shellId === "B") as Extract<TraceEvent, { type: "veto" }> | undefined;
    expect(veto?.agent).toBe("access");
    expect(veto?.reason).toMatch(/2 floors/);
    const report = events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    expect(report.reports.map((r) => r.shellId)).not.toContain("B");
  });

  it("makes the visible score lines sum to the match score", async () => {
    const ev = await run();
    const report = ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    for (const r of report.reports) expect(Math.max(0, Math.min(100, r.score.reduce((s, l) => s + l.earned, 0)))).toBe(r.matchScore);
  });

  it("builds sourced reports with badges, unknowns and a draft inquiry", async () => {
    const ev = await run();
    const report = ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    for (const r of report.reports) {
      expect(r.sources.length).toBeGreaterThan(0);
      expect(r.draftMessage).toMatch(/dental clinic/);
      expect(r.badge).toBe(r.floorplan ? "scan-verified" : "record-only");
    }
    const top = report.reports[0];
    expect(top.unknowns.some((u) => /power/i.test(u.topic + u.question))).toBe(true);
    expect(top.draftMessage).toMatch(/Pat/);
  });
});
