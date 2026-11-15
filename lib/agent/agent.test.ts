import { describe, expect, it } from "vitest";
import { runAgent, type AgentDeps } from "./loop";
import { BUDGET } from "./tools";
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

  it("drops the search leader when its scan has no restroom, changing the top pick", async () => {
    const ev = await run();
    const drop = ev.find((e) => e.type === "drop" && e.shellId === "A") as Extract<TraceEvent, { type: "drop" }> | undefined;
    expect(drop?.reason).toBe("Suite A, A Main St: has no restrooms; you need 1.");
    expect(drop?.evidence[0].source).toBe("matterport");
    const rerank = ev.find((e) => e.type === "rerank") as Extract<TraceEvent, { type: "rerank" }>;
    expect(rerank.reason).toMatch(/^Changed the top pick: Suite A, A Main St was dropped \(has no restrooms; you need 1\)\.$/);
    expect(rerank.evidence?.[0].source).toBe("matterport");
    const report = ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    expect(report.reports[0].shellId).not.toBe("A");
  });

  it("escalates an unverified fixture on a top candidate instead of assuming it", async () => {
    const ev = await run();
    const esc = ev.filter((e) => e.type === "escalate") as Extract<TraceEvent, { type: "escalate" }>[];
    expect(esc.length).toBeGreaterThan(0);
    expect(esc.length).toBeLessThanOrEqual(4);
    expect(esc[0].question).toBe("Is there a sink in the exam rooms?");
  });

  it("drops a recorded must-have failure (even a fixable one) and batches drops into one call", async () => {
    const d = deps();
    const all = d.shells(spec);
    const shells = [
      ...all.slice(0, 3),
      ...Array.from({ length: 10 }, (_, i) => shell(`X${i}`, { heavyPower: false, driveInBays: 0 })),
    ];
    const events: TraceEvent[] = [];
    await runAgent({ ...spec, needs: { heavyPower: true, driveInBays: 1 } }, (e) => events.push(e), { ...d, shells: () => shells });
    const dropCalls = events.filter((e) => e.type === "tool" && e.tool === "drop_candidate");
    const drops = events.filter((e) => e.type === "drop").map((e) => (e as { shellId: string }).shellId);
    expect(drops).toEqual(expect.arrayContaining(["X0", "X9"]));
    expect(drops).toContain("C"); // heavy power is a selected must-have and C records none
    expect(dropCalls.length).toBeLessThanOrEqual(2);
    const report = events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    expect(report.reports.map((r) => r.shellId)).not.toContain("C");
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

  it("cross-checks zoning with the parcel layer for evaluated candidates", async () => {
    const d = { ...deps(), zoning: async () => ({ zone: "R3", source: "scag test", apn: "1" }) };
    const events: TraceEvent[] = [];
    await runAgent({ ...spec, city: "los_angeles" }, (e) => events.push(e), { ...d, shells: () => d.shells(spec).map((s) => ({ ...s, city: "los_angeles" as const, zoning: "LAC2" })) });
    const report = events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    expect(report.reports[0].rules.find((r) => r.rule === "zoning_records")?.status).toBe("warn");
  });

  it("researches regulations once, within budget, and cites them on every report", async () => {
    let calls = 0;
    const research = async () => { calls++; return { fromCache: false, findings: [
      { topic: "professional_license" as const, jurisdiction: "state" as const, requirement: "Dental practices need a state permit", appliesWhen: "always", certainty: "applies" as const, url: "https://tsbde.texas.gov/x", citedText: "A permit is required.", retrievedAt: "2026-11-14" },
      { topic: "occupancy" as const, jurisdiction: "city" as const, requirement: "Certificate of occupancy", appliesWhen: "new tenant", certainty: "may_apply" as const, url: "https://houstontx.gov/co", citedText: "A CO is required.", retrievedAt: "2026-11-14" },
    ] }; };
    const events: TraceEvent[] = [];
    await runAgent(spec, (e) => events.push(e), { ...deps(), research });
    expect(calls).toBe(1);
    expect(events.filter((e) => e.type === "tool" && e.tool === "research_regulations")).toHaveLength(1);
    const done = events.at(-1) as Extract<TraceEvent, { type: "done" }>;
    expect(done.toolCalls).toBeLessThanOrEqual(25);
    const report = events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
    for (const r of report.reports) {
      const regs = r.rules.filter((h) => h.rule.startsWith("reg_"));
      expect(regs.map((h) => [h.status, h.citation])).toEqual([["warn", "https://tsbde.texas.gov/x"], ["unknown", "https://houstontx.gov/co"]]);
      expect(regs[0].evidence[0].source).toBe("state");
      expect(r.unknowns.some((u) => /state permit/i.test(u.question))).toBe(true);
    }
  });

  it("does not let slow regulation research hold up the search", async () => {
    BUDGET.researchMs = 50;
    try {
      const events: TraceEvent[] = [];
      const t0 = Date.now();
      await runAgent(spec, (e) => events.push(e), { ...deps(), research: () => new Promise(() => {}) });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(events.some((e) => e.type === "drop")).toBe(true);
      const report = events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>;
      expect(report.reports[0].rules.some((h) => h.rule.startsWith("reg_"))).toBe(true);
    } finally {
      BUDGET.researchMs = 20_000;
    }
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
    const shells = d.shells(spec).map((s) => (s.id === "B" ? { ...s, elevator: null } : s));
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
    for (const r of report.reports) expect(Math.max(0, Math.min(100, r.score!.reduce((s, l) => s + l.earned, 0)))).toBe(r.matchScore);
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

describe("required room counts", () => {
  const two = (sid: string, baths: number, exams = 3) => graph(sid, [
    ...Array.from({ length: exams }, (_, i) => room(`${sid}e${i}`, "exam room", 120)),
    ...Array.from({ length: baths }, (_, i) => room(`${sid}b${i}`, "bathroom", 50)),
    room(`${sid}s`, "storage", 40), room(`${sid}r`, "reception", 300),
  ]);
  const need2 = { ...spec, sizeSqft: undefined, needs: {}, rooms: [{ label: "exam room", count: 3, minSqft: 100, hard: false }, { label: "restroom", count: 2, hard: false }] };
  const go = async (graphs: Record<string, RoomGraph>, shells: Shell[]) => {
    const events: TraceEvent[] = [];
    await runAgent(need2, (e) => events.push(e), { shells: () => shells, graph: (sid) => graphs[sid] ?? null });
    return events;
  };

  it("drops a space with 1 restroom when 2 are needed, never counting the storage closet", async () => {
    const ids = ["P", "Q", "R", "S"];
    const ev = await go({ P: two("P", 1), Q: two("Q", 2), R: two("R", 2), S: two("S", 2) }, [shell("P", { buildingClass: "A" }), ...ids.slice(1).map((id) => shell(id))]);
    const drop = ev.find((e) => e.type === "drop" && e.shellId === "P") as Extract<TraceEvent, { type: "drop" }> | undefined;
    expect(drop?.reason).toBe("Suite P, P Main St: has 1 restroom; you need 2.");
    const reports = (ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>).reports;
    expect(reports.map((r) => r.shellId)).not.toContain("P");
    expect(reports[0].summary).toMatch(/^\d+ of \d+ rooms already built\./);
    expect(reports[0].summary).not.toMatch(/Missing/);
    expect(reports[0].reasons[0]).toBe("3 of 3 exam rooms, 2 of 2 restrooms already built");
  });

  it("keeps short spaces when fewer than 3 would remain, ranks them last and says what's missing", async () => {
    const ev = await go({ P: two("P", 1), Q: two("Q", 2), R: two("R", 2, 1) }, [shell("P", { buildingClass: "A" }), shell("Q"), shell("R", { buildingClass: "A" })]);
    expect(ev.some((e) => e.type === "drop")).toBe(false);
    const reports = (ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>).reports;
    expect(reports[0].shellId).toBe("Q");
    expect(reports[0].verdict).not.toBe("Short on rooms");
    const p = reports.find((r) => r.shellId === "P")!;
    expect(p.verdict).toBe("Short on rooms");
    expect(p.summary).toMatch(/rooms already built\. Missing: Has 1 restroom; you need 2\./);
    expect(p.unknowns[0].question).toMatch(/shows 1 restroom and I need 2/);
    expect(reports.find((r) => r.shellId === "R")!.summary).toMatch(/Missing: Has 1 exam room; you need 3/);
  });

  it("decides count drops after every veto, so vetoes can't leave fewer than 3 when a short space could stay", async () => {
    const needKitchen = { ...need2, rooms: [...need2.rooms, { label: "kitchen", count: 1, hard: true }] };
    const withKitchen = (g: RoomGraph) => ({ ...g, rooms: [...g.rooms, room(`${g.sid}k`, "kitchen", 80)] });
    const graphs = { P: withKitchen(two("P", 1)), Q: withKitchen(two("Q", 2)), R: two("R", 2), S: two("S", 2) };
    const events: TraceEvent[] = [];
    await runAgent(needKitchen, (e) => events.push(e), { shells: () => ["P", "Q", "R", "S"].map((id) => shell(id)), graph: (sid) => graphs[sid as keyof typeof graphs] ?? null });
    expect(events.filter((e) => e.type === "veto").map((e) => (e as { shellId: string }).shellId).sort()).toEqual(["R", "S"]);
    expect(events.some((e) => e.type === "drop" && e.shellId === "P")).toBe(false);
    const reports = (events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>).reports;
    expect(reports.map((r) => r.shellId)).toEqual(["Q", "P"]);
    expect(reports[1].verdict).toBe("Short on rooms");
  });

  it("treats beds: 0 as a studio, not the home pack's 2 bedrooms", async () => {
    const studio = graph("H", [room("l", "living", 300), room("k", "kitchen", 80), room("w", "bathroom", 50)]);
    const events: TraceEvent[] = [];
    const home = shell("H", { mode: "home", useTags: ["home"], propertyType: "Residential", subtype: "Residential" });
    await runAgent({ ...spec, mode: "home", useType: "home", sizeSqft: undefined, beds: 0, baths: 1, needs: {}, rooms: [] }, (e) => events.push(e), { shells: () => [home], graph: (sid) => (sid === "H" ? studio : null) });
    const r = (events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>).reports[0];
    expect(r.reasons[0]).toBe("1 of 1 bathroom already built");
    expect(r.summary).not.toMatch(/bedroom/);
    expect(r.verdict).not.toBe("Short on rooms");
  });

  it("ranks a space with every count met above a higher-scoring one that is short a single exam room", async () => {
    const ev = await go({ P: two("P", 2, 2), Q: two("Q", 2), R: two("R", 2), S: two("S", 2) },
      [shell("P", { buildingClass: "A" }), shell("Q", { useTags: ["office"], listing: undefined }), shell("R", { useTags: ["office"], listing: undefined }), shell("S", { useTags: ["office"], listing: undefined })]);
    expect(ev.some((e) => e.type === "drop" && e.shellId === "P")).toBe(false);
    const reports = (ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>).reports;
    expect(reports.at(-1)!.shellId).toBe("P");
    expect(reports.at(-1)!.matchScore).toBeLessThanOrEqual(40);
  });
});

describe("layout-driven run", () => {
  it("dispatches match_layout after search and carries similarity into reports", async () => {
    const events: TraceEvent[] = [];
    const layout = [
      { label: "office", x: 0, y: 0, w: 11, h: 11 }, { label: "office", x: 11, y: 0, w: 11, h: 11 }, { label: "office", x: 22, y: 0, w: 10, h: 11 },
      { label: "bathroom", x: 32, y: 0, w: 8, h: 8 }, { label: "reception", x: 0, y: 11, w: 20, h: 15 },
    ];
    await runAgent({ ...spec, input: "layout", sizeSqft: undefined, rooms: [], layout }, (e) => events.push(e), deps(), { client: null });
    const tools = events.flatMap((e) => (e.type === "tool" ? [e.tool] : []));
    expect(tools.slice(0, 2)).toEqual(["search_shells", "match_layout"]);
    const reports = (events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>).reports;
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports.filter((r) => r.floorplan)) {
      expect(r.similarity?.layout).toEqual(layout);
      expect(r.similarity!.pairs.length).toBeGreaterThan(0);
    }
  });

  it("skips match_layout when nothing was drawn", async () => {
    const events = await run();
    expect(events.some((e) => e.type === "tool" && e.tool === "match_layout")).toBe(false);
  });
});
