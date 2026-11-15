import type { FitResult, RequirementSpec, Room, RoomGraph } from "../types";
import { minCostAssignment } from "./hungarian";
import { IMPLIED_FIXTURES, labelCost, normalizeRoomLabel } from "./labels";
import { packFor } from "../uses/packs";
const SCAN_MIN_SLACK = 0.7;

const BUILD_COST = 70;
const NOT_A_ROOM = new Set(["hallway", "outdoor"]);
const BLOCKED = 1e6;

export const isBathroom = (label: string) => normalizeRoomLabel([label]) === "bathroom";

// Counted rooms rank first: every bathroom, plus the use's primary rooms (any room asked for 2+ of, or that the pack asks 2+ of).
export function countedKind(spec: Pick<RequirementSpec, "useType" | "mode">, r: { label: string; count: number }): "bathroom" | "primary" | null {
  if (isBathroom(r.label)) return "bathroom";
  return r.count >= 2 || packFor(spec).rooms.some((p) => p.label === r.label && p.count >= 2) ? "primary" : null;
}

function sizeCost(area: number, min?: number, max?: number): number {
  if (min && area < min) return Math.min(60, ((min - area) / min) * 80);
  if (max && area > max) return Math.min(20, ((area - max) / max) * 10);
  return 0;
}

export function fixturesIn(room: Room, g: RoomGraph): Set<string> {
  const s = new Set(IMPLIED_FIXTURES[room.label] ?? []);
  for (const o of g.objects) if (o.roomId === room.id) s.add(o.label.toLowerCase());
  return s;
}

export function fit(spec: RequirementSpec, g: RoomGraph): FitResult {
  const reqs = spec.rooms.flatMap((r) =>
    Array.from({ length: r.count }, (_, i) => ({ ...r, key: r.count > 1 ? `${r.label} #${i + 1}` : r.label })),
  );
  const rooms = g.rooms.filter((r) => r.areaSqft > 1 && !NOT_A_ROOM.has(r.label));

  const cost = reqs.map((req) => {
    const bath = isBathroom(req.label);
    const real = rooms.map((room) => {
      const label = labelCost(req.label, room.label);
      if (bath !== isBathroom(room.label) || label >= 100) return BLOCKED;
      const have = fixturesIn(room, g);
      const missing = (req.fixtures ?? []).filter((f) => !have.has(f.toLowerCase())).length;
      return label + sizeCost(room.areaSqft, req.minSqft, req.maxSqft) + missing * 20;
    });
    // Leaving a counted room unfilled costs more, so bathrooms and primary rooms claim measured rooms first.
    const skip = countedKind(spec, req) ? BUILD_COST * 3 : BUILD_COST;
    return [...real, ...reqs.map(() => skip)];
  });
  const pick = minCostAssignment(cost);

  const edits: string[] = [];
  const hardFails: string[] = [];
  const unknowns: string[] = [];
  const labeled = rooms.filter((r) => r.label !== "other").length;
  const labelsInformative = rooms.length > 0 && labeled / rooms.length >= 0.5;
  const assignment = reqs.map((req, i) => {
    const j = pick[i];
    const room = j >= 0 && j < rooms.length && cost[i][j] < BLOCKED ? rooms[j] : null;
    const c = room ? cost[i][j] : BUILD_COST;
    if (!room) {
      // Counted rooms are never hard fails here: lib/agent/tools.ts decides drop vs rank-last from roomCounts.
      const counted = countedKind(spec, req);
      if (!labelsInformative && (counted || req.hard)) unknowns.push(`${req.key}: not identifiable in scan ${g.sid} (${labeled} of ${rooms.length} rooms labeled)`);
      else if (req.hard && !counted) hardFails.push(`Required ${req.key} not found among ${rooms.length} measured rooms (scan ${g.sid})`);
      else edits.push(`Build ${req.key}${req.minSqft ? ` (~${req.minSqft} sf)` : ""}`);
    } else {
      if (req.maxSqft && room.areaSqft > 2 * req.maxSqft) edits.push(`Divide ${Math.round(room.areaSqft)} sf ${room.label} room for ${req.key}`);
      const have = fixturesIn(room, g);
      for (const f of req.fixtures ?? []) if (!have.has(f.toLowerCase())) edits.push(`Add ${f} to ${req.key}`);
    }
    return { req: req.key, roomId: room?.id ?? null, cost: Math.round(c) };
  });

  // Fixtures the use needs that no requested room covers: missing means build, never a silent pass.
  const pack = packFor(spec);
  const covered = new Set(reqs.flatMap((r) => r.fixtures ?? []));
  const anywhere = new Set(rooms.flatMap((r) => [...fixturesIn(r, g)]));
  for (const f of pack.fixtures) if (!covered.has(f) && !anywhere.has(f)) edits.push(`Add ${f} (typical for a ${pack.label.toLowerCase()}; not seen in scan ${g.sid})`);

  const breakdown: Record<string, number> = {};
  const adjacency = scoreAdjacency(reqs, assignment, g, edits);
  if (adjacency != null) breakdown.adjacency = adjacency;
  breakdown.rooms = reqs.length ? Math.round(100 - assignment.reduce((s, a) => s + a.cost, 0) / reqs.length) : 100;

  if (spec.sizeSqft) {
    const [lo, hi] = spec.sizeSqft;
    const a = g.totalAreaSqft;
    breakdown.size = Math.round(100 - sizeCost(a, lo, hi) * (100 / 60));
    // Scans measure net floor area, typically 10-20% under the listed gross, so a scan only fails when it is far short.
    if (a < lo * SCAN_MIN_SLACK) hardFails.push(`Measured area ${Math.round(a)} sf is far below the ${lo} sf minimum (scan ${g.sid})`);
  }

  const weights = { rooms: spec.priorities.rooms ?? 2, size: spec.priorities.size ?? 2, adjacency: spec.priorities.adjacency ?? 1 };
  const keys = Object.keys(breakdown) as (keyof typeof weights)[];
  const wsum = keys.reduce((s, k) => s + weights[k], 0);
  let score = keys.reduce((s, k) => s + breakdown[k] * weights[k], 0) / wsum;
  if (hardFails.length) score = Math.min(score, 40);

  return { score: Math.round(Math.max(0, score)), assignment, edits, breakdown, hardFails, unknowns };
}

// Door edges count as verified access; "possible" edges (shared wall, no recorded opening) only partly.
function scoreAdjacency(
  reqs: { label: string; key: string; adjacentTo?: string[] }[],
  assignment: FitResult["assignment"],
  g: RoomGraph,
  edits: string[],
): number | null {
  const scores: number[] = [];
  const link = (a: string, b: string) => g.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))?.kind;
  reqs.forEach((req, i) => {
    const from = assignment[i].roomId;
    if (!from) return;
    for (const label of req.adjacentTo ?? []) {
      const targets = assignment.filter((a, j) => j !== i && a.roomId && reqs[j].label === label).map((a) => a.roomId!);
      if (!targets.length) continue;
      const kinds = targets.map((t) => link(from, t));
      if (kinds.includes("door")) scores.push(100);
      else if (kinds.includes("possible")) scores.push(70);
      else {
        scores.push(30);
        edits.push(`Rework layout so ${req.key} sits next to ${label}`);
      }
    }
  });
  return scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null;
}

export type RoomCount = { label: string; kind: "bathroom" | "primary"; need: number; have: number; unknown: number };

// Required counts per counted room type. No scan means every count is unknown, never met.
export function roomCounts(spec: RequirementSpec, f: FitResult, scanned: boolean): RoomCount[] {
  const out = new Map<string, RoomCount>();
  for (const r of spec.rooms) {
    const kind = countedKind(spec, r);
    if (!kind) continue;
    const key = kind === "bathroom" ? "bathroom" : r.label;
    const c = out.get(key) ?? { label: key, kind, need: 0, have: 0, unknown: 0 };
    const rows = f.assignment.filter((a) => a.req === r.label || a.req.startsWith(`${r.label} #`));
    c.need += r.count;
    if (!scanned || !rows.length) c.unknown += r.count;
    else {
      c.have += rows.filter((a) => a.roomId).length;
      c.unknown += rows.filter((a) => !a.roomId && f.unknowns.some((u) => u.startsWith(`${a.req}:`))).length;
    }
    out.set(key, c);
  }
  return [...out.values()];
}

export const missingOf = (c: RoomCount) => Math.max(0, c.need - c.have - c.unknown);
export const roomNoun = (spec: Pick<RequirementSpec, "mode">, c: RoomCount, n: number) => {
  const w = c.kind === "bathroom" ? (spec.mode === "home" ? "bathroom" : "restroom") : c.label;
  return n === 1 || /s$/.test(w) ? w : `${w}s`;
};

// "Has 1 restroom; you need 2" for each short count.
export const shortfalls = (spec: Pick<RequirementSpec, "mode">, counts: RoomCount[]) =>
  counts.filter((c) => missingOf(c) > 0).map((c) => `Has ${c.have || "no"} ${roomNoun(spec, c, c.have || 2)}; you need ${c.need}`);

// "3 of 3 exam rooms, 1 of 2 restrooms already built (1 unconfirmed)"
export function countLine(spec: Pick<RequirementSpec, "mode">, counts: RoomCount[]): string {
  if (!counts.length) return "";
  const parts = counts.map((c) => `${c.have} of ${c.need} ${roomNoun(spec, c, c.need)}${c.unknown ? ` (${c.unknown} not confirmed)` : ""}`);
  return `${parts.join(", ")} already built`;
}

// Missing a bathroom or 2+ primary rooms is a drop; anything short still ranks below spaces that meet every count.
export const severe = (counts: RoomCount[]) =>
  counts.some((c) => c.kind === "bathroom" && missingOf(c) > 0) || counts.filter((c) => c.kind === "primary").reduce((s, c) => s + missingOf(c), 0) > 1;
export const countTier = (counts: RoomCount[]) => (counts.some((c) => missingOf(c) > 0) ? 2 : counts.some((c) => c.unknown) ? 1 : 0);

// "3 exam rooms, 2 restrooms": what the user needs, for spaces with no scan to count from.
export const needLine = (spec: Pick<RequirementSpec, "mode">, counts: RoomCount[]) => counts.map((c) => `${c.need} ${roomNoun(spec, c, c.need)}`).join(", ");
