import type { FitResult, RequirementSpec, Room, RoomGraph } from "../types";
import { minCostAssignment } from "./hungarian";
import { IMPLIED_FIXTURES, labelCost } from "./labels";
import { packFor } from "../uses/packs";
const SCAN_MIN_SLACK = 0.7;

const BUILD_COST = 70;
const NOT_A_ROOM = new Set(["hallway", "outdoor"]);

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
    const real = rooms.map((room) => {
      const have = fixturesIn(room, g);
      const missing = (req.fixtures ?? []).filter((f) => !have.has(f.toLowerCase())).length;
      return labelCost(req.label, room.label) + sizeCost(room.areaSqft, req.minSqft, req.maxSqft) + missing * 20;
    });
    return [...real, ...reqs.map(() => BUILD_COST)];
  });
  const pick = minCostAssignment(cost);

  const edits: string[] = [];
  const hardFails: string[] = [];
  const unknowns: string[] = [];
  const labeled = rooms.filter((r) => r.label !== "other").length;
  const labelsInformative = rooms.length > 0 && labeled / rooms.length >= 0.5;
  const assignment = reqs.map((req, i) => {
    const j = pick[i];
    const room = j >= 0 && j < rooms.length ? rooms[j] : null;
    const c = j >= 0 ? cost[i][j] : BUILD_COST;
    if (!room) {
      if (req.hard && labelsInformative) hardFails.push(`Required ${req.key} not found among ${rooms.length} measured rooms (scan ${g.sid})`);
      else if (req.hard) unknowns.push(`${req.key}: not identifiable in scan ${g.sid} (${labeled} of ${rooms.length} rooms labeled)`);
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
