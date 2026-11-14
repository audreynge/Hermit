import { describe, expect, it } from "vitest";
import { fit } from "../reason/fit";
import type { RoomGraph } from "../types";
import { clinicSpec, homeOfficeSpec, sampleGraph, sampleShell, SAMPLE_SIDS } from "./fixtures";
import { applyFitout, evaluateFitout, MIN_SPLIT_SQFT, type FitoutOp } from "./fitout";

const home = () => sampleGraph("SAMPLEHOME1");
const homeShell = () => sampleShell("SAMPLEHOME1");
const examSpec = (n = 2) => clinicSpec({ mode: "home", rooms: [{ label: "exam room", count: n, hard: false }] });

describe("applyFitout / evaluateFitout", () => {
  it("[F1] using bedrooms as exam rooms raises fit by at least 10 and assigns them", () => {
    const spec = examSpec(2);
    const before = fit(spec, home()).score;
    const ev = evaluateFitout(spec, homeShell(), home(), [{ op: "use_as", roomId: "b1", label: "exam room" }, { op: "use_as", roomId: "b2", label: "exam room" }]);
    expect(ev.diff.fit[0]).toBe(before);
    expect(ev.diff.fit[1] - ev.diff.fit[0]).toBeGreaterThanOrEqual(10);
    expect(ev.after.fit.assignment.map((a) => a.roomId).sort()).toEqual(["b1", "b2"]);
    // One conversion when one exam room is needed: also >= 10.
    const one = evaluateFitout(examSpec(1), homeShell(), home(), [{ op: "use_as", roomId: "b1", label: "exam room" }]);
    expect(one.diff.fit[1] - one.diff.fit[0]).toBeGreaterThanOrEqual(10);
  });

  it("[F2] use_as with the room's own label is a no-op with no cost", () => {
    const ev = evaluateFitout(homeOfficeSpec(), homeShell(), home(), [{ op: "use_as", roomId: "b1", label: "Bedroom" }]);
    expect(ev.after.fit).toEqual(ev.before.fit);
    expect(ev.after.costRange).toEqual(ev.before.costRange);
    expect(ev.notes.join(" ")).toMatch(/already a bedroom/);
  });

  it("[F3] merging rooms that share a door sums the area, keeps both polygons and flags the wall", () => {
    const g = home();
    const r = applyFitout(g, [{ op: "merge", roomIds: ["b1", "b2"], label: "office" }]);
    const m = r.graph.rooms.find((x) => x.id === "b1+b2")!;
    expect(m.areaSqft).toBeCloseTo(g.rooms[2].areaSqft + g.rooms[3].areaSqft, 0);
    expect(m.parts).toEqual([g.rooms[2].polygon, g.rooms[3].polygon]);
    expect(m.proposed).toBe(true);
    expect(r.unknowns[0]).toMatch(/load-bearing/);
    expect(r.graph.edges.some((e) => e.a === "b1+b2" || e.b === "b1+b2")).toBe(true);
  });

  it("[F4] merge is rejected for rooms with no shared wall, on different floors, or a single room", () => {
    expect(applyFitout(home(), [{ op: "merge", roomIds: ["l", "ba"] }]).rejected[0].reason).toMatch(/don't share a wall/);
    const two = structuredClone(home());
    two.rooms[3].floorId = "f2";
    expect(applyFitout(two, [{ op: "merge", roomIds: ["b1", "b2"] }]).rejected[0].reason).toMatch(/different floors/);
    expect(applyFitout(home(), [{ op: "merge", roomIds: ["b1", "b1"] }]).rejected[0].reason).toMatch(/two different rooms/);
  });

  it("[F5] split gives equal parts that sum to the original; bad counts or tiny parts are rejected", () => {
    const g = sampleGraph("SAMPLEMED3");
    const r = applyFitout(g, [{ op: "split", roomId: "a", into: 3, label: "exam room" }]);
    const parts = r.graph.rooms.filter((x) => x.id.startsWith("a."));
    expect(parts).toHaveLength(3);
    expect(parts.reduce((s, p) => s + p.areaSqft, 0)).toBeCloseTo(g.rooms[0].areaSqft, 3);
    expect(new Set(parts.map((p) => p.areaSqft.toFixed(6))).size).toBe(1);
    expect(parts.every((p) => p.polygon.length === 4 && p.proposed)).toBe(true);
    for (const into of [1, 7, 2.5]) expect(applyFitout(g, [{ op: "split", roomId: "a", into }]).rejected).toHaveLength(1);
    const ba = home().rooms.find((x) => x.id === "ba")!;
    const n = Math.floor(ba.areaSqft / MIN_SPLIT_SQFT) + 1;
    expect(applyFitout(home(), [{ op: "split", roomId: "b3", into: Math.min(6, n + 2) }]).rejected[0].reason).toMatch(/minimum/);
  });

  it("[F6] adding a fixture that exists costs nothing; a new one adds cost and a plumbing unknown", () => {
    const med = sampleGraph("SAMPLEMED1"); // e1 has a sink
    const have = applyFitout(med, [{ op: "add_fixture", roomId: "e1", fixture: "sinks" }]);
    expect(have.work).toEqual([]);
    const kitchen = applyFitout(home(), [{ op: "add_fixture", roomId: "k", fixture: "sink" }]); // implied by kitchen
    expect(kitchen.work).toEqual([]);
    const add = applyFitout(home(), [{ op: "add_fixture", roomId: "b3", fixture: "hand sink" }]);
    expect(add.work).toHaveLength(1);
    expect(add.work[0].reason).toBe("user");
    expect(add.unknowns[0]).toMatch(/Plumbing or power/);
  });

  it("[F7] ops chain: merge then use the merged room", () => {
    const r = applyFitout(home(), [{ op: "merge", roomIds: ["b1", "b2"] }, { op: "use_as", roomId: "b1+b2", label: "conference" }]);
    expect(r.rejected).toEqual([]);
    expect(r.graph.rooms.find((x) => x.id === "b1+b2")?.label).toBe("conference");
  });

  it("[F8] every changed room is marked proposed and the report says so", () => {
    const ops: FitoutOp[] = [{ op: "use_as", roomId: "b1", label: "exam room" }, { op: "add_fixture", roomId: "b2", fixture: "sink" }];
    const ev = evaluateFitout(examSpec(), homeShell(), home(), ops);
    const changed = ev.after.floorplan!.rooms.filter((r) => ["b1", "b2"].includes(r.id));
    expect(changed.every((r) => r.proposed)).toBe(true);
    expect(ev.after.floorplan!.rooms.filter((r) => !["b1", "b2"].includes(r.id)).some((r) => r.proposed)).toBe(false);
    expect(ev.after.floorplan!.objects.find((o) => o.roomId === "b2")).toMatchObject({ proposed: true, confidence: 0 });
    expect(ev.after.sources.some((s) => /b1|b2|proposed/.test(s.ref))).toBe(false);
    expect(ev.after.unknowns.some((u) => u.topic === "proposed change")).toBe(true);
  });

  it("[F9] idempotent: the same ops twice equal once, and re-applying to the result changes nothing", () => {
    const ops: FitoutOp[] = [{ op: "use_as", roomId: "b1", label: "exam room" }, { op: "add_fixture", roomId: "b1", fixture: "sink" }];
    const once = evaluateFitout(examSpec(), homeShell(), home(), ops);
    const twice = evaluateFitout(examSpec(), homeShell(), home(), [...ops, ...ops]);
    expect(twice.after.fit).toEqual(once.after.fit);
    expect(twice.after.costRange).toEqual(once.after.costRange);
    const again = applyFitout(applyFitout(home(), ops).graph, ops);
    expect(again.work).toEqual([]);
    expect(again.graph).toEqual(applyFitout(home(), ops).graph);
  });

  it("[F10] cost only drops when a planned build item is made unnecessary, and only by that item", () => {
    const labels = ["exam room", "office", "conference", "storage", "kitchen", "bedroom"];
    const fixtures = ["sink", "toilet", "range", "hood"];
    let checked = 0;
    for (const sid of SAMPLE_SIDS) {
      const g = sampleGraph(sid);
      const shell = sampleShell(sid);
      const spec = sid.startsWith("SAMPLEHOME") ? homeOfficeSpec() : clinicSpec({ mode: shell.mode, city: shell.city });
      for (let i = 0; i < 25; i++) {
        const r = g.rooms[i % g.rooms.length], r2 = g.rooms[(i + 1) % g.rooms.length];
        const ops = [
          { op: "use_as", roomId: r.id, label: labels[i % labels.length] },
          { op: "add_fixture", roomId: r2.id, fixture: fixtures[i % fixtures.length] },
          ...(i % 3 === 0 ? [{ op: "merge", roomIds: [r.id, r2.id] }] : []),
        ];
        const ev = evaluateFitout(spec, shell, g, ops);
        const removed = ev.before.work.filter((w) => !ev.after.work.some((x) => x.item === w.item && x.low === w.low));
        const allowance = removed.reduce((s, w) => s + w.low, 0);
        expect(ev.after.costRange![0]).toBeGreaterThanOrEqual(ev.before.costRange![0] - allowance);
        for (const w of ev.after.work) expect(w.low).toBeGreaterThanOrEqual(0);
        checked++;
      }
    }
    expect(checked).toBe(SAMPLE_SIDS.length * 25);
  });

  it("[F11] no ops: the after report equals the before report", () => {
    const ev = evaluateFitout(examSpec(), homeShell(), home(), []);
    expect(ev.after.fit).toEqual(ev.before.fit);
    expect(ev.after.rules).toEqual(ev.before.rules);
    expect(ev.after.work).toEqual(ev.before.work);
  });

  it("[F12] a hard fail fixed by an op disappears; one no op addresses stays", () => {
    const spec = examSpec(1);
    spec.rooms = [{ label: "conference", count: 1, hard: true }, { label: "garage", count: 1, hard: true }];
    const before = evaluateFitout(spec, homeShell(), home(), []);
    expect(before.after.fit.hardFails.length).toBeGreaterThanOrEqual(1);
    const fixed = evaluateFitout(spec, homeShell(), home(), [{ op: "use_as", roomId: "b1", label: "garage" }]);
    expect(fixed.diff.hardFailsCleared.join(" ")).toMatch(/garage/);
    const stays = before.after.fit.hardFails.filter((h) => !/garage/.test(h));
    for (const h of stays) expect(fixed.after.fit.hardFails).toContain(h);
  });

  it("[F14] unknown room ids, unknown fixtures and too many ops are rejected per op, never thrown", () => {
    const r = applyFitout(home(), [
      { op: "use_as", roomId: "nope", label: "office" }, { op: "add_fixture", roomId: "b1", fixture: "hot tub" },
      { op: "teleport" }, ...Array.from({ length: 10 }, (_, i) => ({ op: "use_as", roomId: "b2", label: `office ${i}` })),
    ]);
    const reasons = r.rejected.map((x) => x.reason);
    for (const re of [/no room nope/, /hot tub/, /"teleport" is not a change/, /too many/]) expect(reasons.some((x) => re.test(x))).toBe(true);
    expect(r.rejected).toHaveLength(6); // nope, hot tub, teleport, and 3 ops past the cap of 10
  });

  it("[F16] apply + rescore is fast: p95 under 50 ms over 200 random op lists", () => {
    const labels = ["exam room", "office", "conference", "storage"];
    const times: number[] = [];
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let i = 0; i < 200; i++) {
      const sid = SAMPLE_SIDS[i % SAMPLE_SIDS.length];
      const g: RoomGraph = sampleGraph(sid);
      const ids = g.rooms.map((r) => r.id);
      const ops = Array.from({ length: 1 + rnd(6) }, () => {
        const k = rnd(4);
        const id = ids[rnd(ids.length)];
        return k === 0 ? { op: "use_as", roomId: id, label: labels[rnd(4)] } : k === 1 ? { op: "add_fixture", roomId: id, fixture: "sink" }
          : k === 2 ? { op: "merge", roomIds: [id, ids[rnd(ids.length)]] } : { op: "split", roomId: id, into: 2 + rnd(3) };
      });
      const t = performance.now();
      evaluateFitout(clinicSpec(), sampleShell(sid), g, ops);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(50);
  });
});
