import { z } from "zod";
import { buildReport, finalScore, type Evaluation } from "../agent/report";
import { fit, fixturesIn } from "../reason/fit";
import { checkRules } from "../reason/rules";
import { estimateWork, row } from "../reason/work";
import type { RequirementSpec, Room, RoomGraph, Shell, ShellReport, WorkItem } from "../types";
import { parseOps, type Rejected } from "./layout-ops";
import { roomType } from "./rooms";

// Labels and ids end up in the model's prompt, so only plain words are accepted.
export const PlainLabel = z.string().regex(/^[A-Za-z][A-Za-z0-9 -]{0,39}$/, "use a plain room name");
const Id = z.string().regex(/^[A-Za-z0-9_.+-]{1,60}$/, "bad id");
export const FitoutOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("use_as"), roomId: Id, label: PlainLabel }),
  z.object({ op: z.literal("merge"), roomIds: z.array(Id).min(1).max(6), label: PlainLabel.optional() }),
  z.object({ op: z.literal("split"), roomId: Id, into: z.number(), label: PlainLabel.optional() }),
  z.object({ op: z.literal("add_fixture"), roomId: Id, fixture: PlainLabel }),
]);
export type FitoutOp = z.infer<typeof FitoutOp>;

export const MIN_SPLIT_SQFT = 35;
const LOCKED = new Set(["hallway", "outdoor"]);
const FIXTURES: Record<string, string> = {
  sink: "sink", "hand sink": "sink", basin: "sink", toilet: "toilet", wc: "toilet", shower: "shower", bathtub: "bathtub", tub: "bathtub",
  range: "range", stove: "range", oven: "range", hood: "hood", "exhaust hood": "hood", dishwasher: "dishwasher", washer: "washer",
  "washing machine": "washer", dryer: "dryer", refrigerator: "refrigerator", fridge: "refrigerator", drain: "drain", "floor drain": "drain",
};
export const fixtureName = (f: string) => FIXTURES[f.toLowerCase().trim()] ?? FIXTURES[f.toLowerCase().trim().replace(/s$/, "")] ?? null;
// Catalog type when known ("Exam Room 1", "consult room" -> "exam room"), else the plain lower-case words ("lab").
const cleanLabel = (l: string) => roomType(l) ?? l.toLowerCase().trim().replace(/\s+/g, " ").replace(/\s*#?\d+$/, "");

export type FitoutApplied = { graph: RoomGraph; work: WorkItem[]; unknowns: string[]; applied: FitoutOp[]; rejected: Rejected[]; notes: string[] };

export const roomTitle = (r: Room) => `${r.label} ${r.id} (${Math.round(r.areaSqft)} sf)`;

function isAxisRect(p: { x: number; y: number }[]) {
  if (p.length !== 4) return false;
  const xs = new Set(p.map((q) => q.x.toFixed(4))), ys = new Set(p.map((q) => q.y.toFixed(4)));
  return xs.size === 2 && ys.size === 2;
}

function connected(ids: string[], edges: RoomGraph["edges"]): boolean {
  const seen = new Set([ids[0]]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) for (const [a, b] of [[e.a, e.b], [e.b, e.a]])
      if (seen.has(a) && ids.includes(b) && !seen.has(b)) { seen.add(b); grew = true; }
  }
  return ids.every((id) => seen.has(id));
}

function dedupeEdges(edges: RoomGraph["edges"]): RoomGraph["edges"] {
  const best = new Map<string, RoomGraph["edges"][number]>();
  for (const e of edges) {
    if (e.a === e.b) continue;
    const k = [e.a, e.b].sort().join("|");
    if (!best.has(k) || e.kind === "door") best.set(k, e);
  }
  return [...best.values()];
}

/** Applies proposed fit-out changes to a scanned room graph. Pure; changed rooms are marked `proposed`. */
export function applyFitout(input: RoomGraph, raw: unknown[], maxOps?: number): FitoutApplied {
  const { ops, rejected } = parseOps(raw, FitoutOp, maxOps);
  const g: RoomGraph = structuredClone(input);
  const work: WorkItem[] = [];
  const unknowns: string[] = [];
  const applied: FitoutOp[] = [];
  const notes: string[] = [];
  const get = (id: string) => g.rooms.find((r) => r.id === id);
  const reject = (op: FitoutOp, reason: string) => rejected.push({ op, reason });

  for (const op of ops) {
    if (op.op === "use_as") {
      const r = get(op.roomId);
      const label = cleanLabel(op.label);
      if (!r) { reject(op, `there's no room ${op.roomId} in this scan`); continue; }
      if (LOCKED.has(r.label)) { reject(op, `${roomTitle(r)} is a ${r.label}; it can't be reassigned`); continue; }
      if (LOCKED.has(label)) { reject(op, `a room can't be turned into a ${label}`); continue; }
      if (r.label === label) { notes.push(`${roomTitle(r)} is already a ${label}.`); applied.push(op); continue; }
      work.push(row("build_room", 1, "user", `Convert ${r.label} ${r.id} to ${label}`));
      Object.assign(r, { label, proposed: true });
    } else if (op.op === "merge") {
      const ids = [...new Set(op.roomIds)];
      const rooms = ids.map(get);
      if (ids.length < 2) { reject(op, "merging needs at least two different rooms"); continue; }
      const missing = ids.filter((_, i) => !rooms[i]);
      if (missing.length) { reject(op, `there's no room ${missing.join(", ")} in this scan`); continue; }
      const rs = rooms as Room[];
      if (new Set(rs.map((r) => r.floorId)).size > 1) { reject(op, "those rooms are on different floors"); continue; }
      if (rs.some((r) => r.label === "outdoor")) { reject(op, "outdoor areas can't be merged into rooms"); continue; }
      if (!connected(ids, g.edges)) { reject(op, `${rs.map((r) => r.id).join(" and ")} don't share a wall in the scan`); continue; }
      const largest = [...rs].sort((a, b) => b.areaSqft - a.areaSqft)[0];
      const merged: Room = {
        id: ids.join("+"), label: op.label ? cleanLabel(op.label) : largest.label, rawTags: rs.flatMap((r) => r.rawTags),
        areaSqft: rs.reduce((s, r) => s + r.areaSqft, 0), heightFt: largest.heightFt, polygon: [],
        parts: rs.flatMap((r) => (r.parts?.length ? r.parts : r.polygon.length >= 3 ? [r.polygon] : [])), floorId: largest.floorId, proposed: true,
      };
      g.rooms = [...g.rooms.filter((r) => !ids.includes(r.id)), merged];
      g.edges = dedupeEdges(g.edges.map((e) => ({ ...e, a: ids.includes(e.a) ? merged.id : e.a, b: ids.includes(e.b) ? merged.id : e.b })));
      g.objects = g.objects.map((o) => (o.roomId && ids.includes(o.roomId) ? { ...o, roomId: merged.id } : o));
      const names = rs.map((r) => `${r.label} ${r.id}`).join(" and ");
      work.push(row("divide_room", ids.length - 1, "user", `Remove wall${ids.length > 2 ? "s" : ""} between ${names}`));
      unknowns.push(`Is the wall between ${names} load-bearing, and does it carry plumbing, power or HVAC?`);
    } else if (op.op === "split") {
      const r = get(op.roomId);
      if (!r) { reject(op, `there's no room ${op.roomId} in this scan`); continue; }
      if (!Number.isInteger(op.into) || op.into < 2 || op.into > 6) { reject(op, "a room can be split into 2 to 6 parts"); continue; }
      if (LOCKED.has(r.label)) { reject(op, `${roomTitle(r)} is a ${r.label}; it can't be split into rooms`); continue; }
      const each = r.areaSqft / op.into;
      if (each < MIN_SPLIT_SQFT) { reject(op, `each part would be ${Math.round(each)} sf, under the ${MIN_SPLIT_SQFT} sf minimum`); continue; }
      const label = op.label ? cleanLabel(op.label) : r.label;
      const polys = splitPolygon(r.polygon, op.into);
      const parts: Room[] = Array.from({ length: op.into }, (_, i) => ({
        ...r, id: `${r.id}.${i + 1}`, label, areaSqft: each, polygon: polys?.[i] ?? (i === 0 ? r.polygon : []), parts: undefined, proposed: true,
      }));
      g.rooms = [...g.rooms.filter((x) => x.id !== r.id), ...parts];
      const inherited = g.edges.filter((e) => e.a === r.id || e.b === r.id);
      g.edges = dedupeEdges([
        ...g.edges.filter((e) => e.a !== r.id && e.b !== r.id),
        ...parts.flatMap((p) => inherited.map((e) => ({ ...e, a: e.a === r.id ? p.id : e.a, b: e.b === r.id ? p.id : e.b }))),
        ...parts.slice(1).map((p, i) => ({ a: parts[i].id, b: p.id, kind: "door" as const })),
      ]);
      g.objects = g.objects.map((o) => (o.roomId === r.id ? { ...o, roomId: parts[0].id } : o));
      work.push(row("divide_room", op.into - 1, "user", `Divide ${r.label} ${r.id} into ${op.into} ${label}s`));
      if (!polys) notes.push(`${roomTitle(r)} isn't a simple rectangle, so the new walls aren't drawn.`);
    } else {
      const r = get(op.roomId);
      const f = fixtureName(op.fixture);
      if (!r) { reject(op, `there's no room ${op.roomId} in this scan`); continue; }
      if (!f) { reject(op, `I can't price a "${op.fixture}"; try sink, toilet, shower, range, hood, dishwasher, washer, dryer or drain`); continue; }
      if (fixturesIn(r, g).has(f)) { notes.push(`${roomTitle(r)} already has a ${f}.`); applied.push(op); continue; }
      g.objects = [...g.objects, { label: f, roomId: r.id, confidence: 0, proposed: true }];
      r.proposed = true;
      work.push(row("add_fixture", 1, "user", `Add ${f} to ${r.label} ${r.id}`));
      unknowns.push(`Plumbing or power for a new ${f} in ${r.label} ${r.id} isn't visible in the scan. Is there a supply and drain line nearby?`);
    }
    applied.push(op);
  }
  g.totalAreaSqft = input.totalAreaSqft; // edits move walls; they don't change measured floor area
  return { graph: g, work, unknowns: [...new Set(unknowns)], applied, rejected, notes: [...new Set(notes)] };
}

function splitPolygon(p: { x: number; y: number }[], n: number): { x: number; y: number }[][] | null {
  if (!isAxisRect(p)) return null;
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const alongX = x1 - x0 >= y1 - y0;
  return Array.from({ length: n }, (_, i) => {
    const [a, b] = alongX ? [x0 + ((x1 - x0) * i) / n, x0 + ((x1 - x0) * (i + 1)) / n] : [y0 + ((y1 - y0) * i) / n, y0 + ((y1 - y0) * (i + 1)) / n];
    return alongX ? [{ x: a, y: y0 }, { x: b, y: y0 }, { x: b, y: y1 }, { x: a, y: y1 }] : [{ x: x0, y: a }, { x: x1, y: a }, { x: x1, y: b }, { x: x0, y: b }];
  });
}

export type FitoutDiff = {
  fit: [number, number];
  score: [number, number];
  cost: [[number, number], [number, number]];
  weeks: [[number, number], [number, number]];
  nowMatched: string[];
  stillMissing: string[];
  hardFailsCleared: string[];
};
export type FitoutEvaluation = { before: ShellReport; after: ShellReport; diff: FitoutDiff; ops: FitoutOp[]; rejected: Rejected[]; notes: string[] };

function evaluation(spec: RequirementSpec, shell: Shell, graph: RoomGraph, search: { score: number; reasons: string[] }, extra: WorkItem[] = [], unknowns: string[] = []): Evaluation {
  const f = fit(spec, graph);
  const rules = checkRules(spec, shell, graph);
  const work = estimateWork(spec, shell, f, rules, extra);
  return {
    shell, searchScore: search.score, searchReasons: search.reasons, graph, fit: f, rules, work,
    finalScore: finalScore(f, rules, search.score, true), escalations: [],
    extraUnknowns: unknowns.map((question) => ({ topic: "proposed change", question })),
  };
}

/**
 * Before/after reports for proposed changes. `kept` are changes the user already accepted (no per-turn cap);
 * `ops` are this turn's. Both are re-applied to the measured graph, so results never drift.
 */
export function evaluateFitout(spec: RequirementSpec, shell: Shell, graph: RoomGraph, ops: unknown[], search = { score: 50, reasons: [] as string[] }, kept: FitoutOp[] = []): FitoutEvaluation {
  const before = buildReport(spec, evaluation(spec, shell, graph, search), 1);
  const k = applyFitout(graph, kept, Infinity);
  const n = applyFitout(k.graph, ops);
  const a = { graph: n.graph, work: [...k.work, ...n.work], unknowns: [...new Set([...k.unknowns, ...n.unknowns])], applied: [...k.applied, ...n.applied], rejected: n.rejected, notes: n.notes };
  const after = buildReport(spec, evaluation(spec, shell, a.graph, search, a.work, a.unknowns), 1);
  const matched = (r: ShellReport) => new Set(r.fit.assignment.filter((x) => x.roomId).map((x) => x.req));
  const mb = matched(before), ma = matched(after);
  const diff: FitoutDiff = {
    fit: [before.fit.score, after.fit.score],
    score: [before.matchScore, after.matchScore],
    cost: [before.costRange ?? [0, 0], after.costRange ?? [0, 0]],
    weeks: [before.weeksToOpen, after.weeksToOpen],
    nowMatched: [...ma].filter((x) => !mb.has(x)),
    stillMissing: after.fit.assignment.filter((x) => !x.roomId).map((x) => x.req),
    hardFailsCleared: before.fit.hardFails.filter((h) => !after.fit.hardFails.includes(h)),
  };
  return { before, after, diff, ops: a.applied, rejected: a.rejected, notes: a.notes };
}

/** Compact, id-bearing description of a scanned space for the model. */
export function describeGraph(g: RoomGraph): string {
  const floors = [...new Set(g.rooms.map((r) => r.floorId))];
  const ordinal = new Map<string, number>();
  return g.rooms.map((r) => {
    const n = (ordinal.get(r.label) ?? 0) + 1;
    ordinal.set(r.label, n);
    const count = g.rooms.filter((x) => x.label === r.label).length;
    const doors = g.edges.filter((e) => e.a === r.id || e.b === r.id).map((e) => `${e.a === r.id ? e.b : e.a}${e.kind === "door" ? "" : "?"}`);
    const objs = [...fixturesIn(r, g)];
    return `- ${r.id}: "${r.label}${count > 1 ? ` ${n}` : ""}", ${Math.round(r.areaSqft)} sf${floors.length > 1 ? `, floor ${r.floorId}` : ""}${doors.length ? `, connects to ${doors.join(", ")}` : ""}${objs.length ? `, has ${objs.join(", ")}` : ""}${r.proposed ? " (proposed)" : ""}`;
  }).join("\n") + "\n(\"?\" after a room id means the scan shows a shared wall but no door.)";
}
