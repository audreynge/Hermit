import { minCostAssignment } from "../reason/hungarian";
import { labelCost } from "../reason/labels";
import { searchShells, type Candidate } from "../query/shells";
import type { RequirementSpec, RoomGraph, Shell, Similarity } from "../types";

export type LayoutBlock = NonNullable<RequirementSpec["layout"]>[number];
type Sig = { rooms: { key: string; label: string; area: number }[]; edges: Set<string>; total: number; aspect: number };

const SKIP = new Set(["hallway", "corridor", "outdoor"]);
const UNMATCHED = 80;
const W = { program: 0.45, adjacency: 0.25, size: 0.2, shape: 0.1 };

const pair = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const aspect = (w: number, h: number) => (w && h ? Math.max(w, h) / Math.min(w, h) : 1);
const touches = (a: LayoutBlock, b: LayoutBlock) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const closeness = (a: number, b: number, k: number) => (a > 0 && b > 0 ? 100 * Math.exp(-k * Math.abs(Math.log(a / b))) : 0);

export const layoutRooms = (blocks: LayoutBlock[]) => blocks.filter((b) => !SKIP.has(b.label.toLowerCase()));
// Footprint including circulation: the same total fromLayout() puts in sizeSqft[0], so an unscaled drawing has scale 1.
export const drawnArea = (blocks: LayoutBlock[]) => blocks.reduce((s, b) => s + b.w * b.h, 0);

// "Make it bigger/smaller" rescales sizeSqft; the drawn layout follows so matching tracks the requested size.
export function layoutScale(spec: Pick<RequirementSpec, "layout" | "sizeSqft">): number {
  const area = drawnArea(spec.layout ?? []);
  return area && layoutRooms(spec.layout ?? []).length && spec.sizeSqft?.[0] ? Math.min(4, Math.max(0.25, spec.sizeSqft[0] / area)) : 1;
}

export function blocksSig(blocks: LayoutBlock[], scale = 1): Sig {
  const idx = blocks.flatMap((b, i) => (SKIP.has(b.label.toLowerCase()) ? [] : [i]));
  const rooms = idx.map((i) => blocks[i]);
  const edges = new Set<string>();
  rooms.forEach((a, i) => rooms.forEach((b, j) => { if (i < j && touches(a, b)) edges.add(pair(i, j)); }));
  const xs = rooms.flatMap((r) => [r.x, r.x + r.w]), ys = rooms.flatMap((r) => [r.y, r.y + r.h]);
  return {
    rooms: rooms.map((r, k) => ({ key: String(idx[k]), label: r.label, area: r.w * r.h * scale })),
    edges,
    total: rooms.reduce((s, r) => s + r.w * r.h, 0) * scale,
    aspect: rooms.length ? aspect(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 1,
  };
}

export function graphSig(g: RoomGraph): Sig {
  const rooms = g.rooms.filter((r) => r.areaSqft > 1 && !SKIP.has(r.label));
  const at = new Map(rooms.map((r, i) => [r.id, i]));
  const edges = new Set<string>();
  for (const e of g.edges) {
    const a = at.get(e.a), b = at.get(e.b);
    if (a != null && b != null && a !== b) edges.add(pair(a, b));
  }
  const pts = rooms.flatMap((r) => r.polygon);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return {
    rooms: rooms.map((r) => ({ key: r.id, label: r.label, area: r.areaSqft })),
    edges,
    total: rooms.reduce((s, r) => s + r.areaSqft, 0),
    aspect: pts.length ? aspect(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 1,
  };
}

// Program = optimal room-to-room assignment (label + log-area cost); adjacency = drawn neighbours still neighbours after assignment.
export function compare(mine: Sig, theirs: Sig, scale = 1): Similarity {
  if (!mine.rooms.length || !theirs.rooms.length)
    return { score: 0, scale, breakdown: { program: 0, adjacency: null, size: closeness(mine.total, theirs.total, 1.5), shape: 0 }, pairs: [] };
  const cost = mine.rooms.map((m) => [
    // An incompatible room type is no match at all (worse than leaving the drawn room unmatched).
    ...theirs.rooms.map((t) => { const l = labelCost(m.label, t.label); return l >= 100 ? UNMATCHED + 1 : l * 0.6 + Math.min(40, Math.abs(Math.log(m.area / t.area)) * 35); }),
    ...mine.rooms.map(() => UNMATCHED),
  ]);
  const pick = minCostAssignment(cost).map((j) => (j >= 0 && j < theirs.rooms.length ? j : -1));
  const mean = pick.reduce((s, j, i) => s + (j >= 0 ? cost[i][j] : UNMATCHED), 0) / pick.length;
  const used = new Set(pick.filter((j) => j >= 0));
  const spare = theirs.rooms.reduce((s, r, j) => s + (used.has(j) ? 0 : r.area), 0) / (theirs.total || 1);
  const program = Math.max(0, (100 - mean) * (1 - 0.3 * spare));

  let kept = 0;
  for (const e of mine.edges) {
    const [a, b] = e.split("|").map(Number);
    if (pick[a] >= 0 && pick[b] >= 0 && theirs.edges.has(pair(pick[a], pick[b]))) kept++;
  }
  const adjacency = mine.edges.size ? (100 * kept) / mine.edges.size : null;
  const size = closeness(mine.total, theirs.total, 1.5);
  const shape = closeness(mine.aspect, theirs.aspect, 1);

  const parts = { program, size, shape, ...(adjacency == null ? {} : { adjacency }) };
  const wsum = Object.keys(parts).reduce((s, k) => s + W[k as keyof typeof W], 0);
  const score = Object.entries(parts).reduce((s, [k, v]) => s + v * W[k as keyof typeof W], 0) / wsum;
  const r = Math.round;
  return {
    score: r(score), scale,
    breakdown: { program: r(program), adjacency: adjacency == null ? null : r(adjacency), size: r(size), shape: r(shape) },
    pairs: pick.flatMap((j, i) => (j >= 0 ? [{ mine: Number(mine.rooms[i].key), theirs: theirs.rooms[j].key }] : [])),
  };
}

// ponytail: per-process signature cache over the private bundle (~1.4k graphs, ~11 MB parsed once); move to a precomputed index if the bundle grows 10x.
const cache = new Map<string, Sig | null>();
export function cachedGraphSig(sid: string, load: (sid: string) => RoomGraph | null): Sig | null {
  if (!cache.has(sid)) { const g = load(sid); cache.set(sid, g ? graphSig(g) : null); }
  return cache.get(sid)!;
}

// Every scanned candidate that passes the spec's hard filters, scored against the drawn layout (most similar first).
export function similarScans(spec: RequirementSpec, shells: Shell[], load: (sid: string) => RoomGraph | null) {
  const blocks = spec.layout ?? [];
  const scale = layoutScale(spec);
  const mine = blocksSig(blocks, scale);
  const out: { candidate: Candidate; sim: Similarity }[] = [];
  if (!mine.rooms.length) return { scale, rooms: 0, results: out };
  for (const c of searchShells(spec, shells, Infinity).results) {
    const sig = c.shell.sid ? cachedGraphSig(c.shell.sid, load) : null;
    if (sig) out.push({ candidate: c, sim: { ...compare(mine, sig, scale), layout: blocks } });
  }
  out.sort((a, b) => b.sim.score - a.sim.score || a.candidate.shell.id.localeCompare(b.candidate.shell.id));
  return { scale, rooms: mine.rooms.length, results: out };
}
