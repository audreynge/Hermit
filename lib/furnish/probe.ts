// Checks a planned footprint against the tour's own surfaces: room outlines carry no fixture positions, so a table
// could land on a built-in counter or island. The browser casts a ray through each sample point (scene.probe); this
// file picks the points and judges the hits. Same world convention as ops.ts (y up, rotY in degrees).
import type { Size } from "./catalog";
import { corners, type Vec } from "./ops";

export type Footprint = { pos: Vec; size: Size; rotY: number };
/** hit: the first tour surface through the point's pixel; null = the ray hit nothing; undefined = not probed (behind the camera or off-screen). */
export type Sample = { at: Vec; hit?: Vec | null };
export type ProbeResult = { blocked: boolean; unknown: number; reason?: string };

const RAISED_M = 0.05; // a hit this far above the floor is a surface, not the floor
const GROW_M = 0.05; // footprint margin when deciding whether a hit belongs to this spot
const CORNER_INSET_M = 0.08; // corners pulled in so a ray grazing the wall behind a wall-flush piece doesn't count

/** 9 interior points (center, a 2/3-size ring and its edge midpoints) and 4 slightly inset corners, at floor height. */
export function samplePoints(fp: Footprint, floorY: number): Vec[] {
  const at = (p: { x: number; y: number }): Vec => ({ x: p.x, y: floorY, z: -p.y }); // plan → world
  const ring = corners(fp.pos, { ...fp.size, w: (fp.size.w * 2) / 3, d: (fp.size.d * 2) / 3 }, fp.rotY);
  const mids = ring.map((p, i) => ({ x: (p.x + ring[(i + 1) % 4].x) / 2, y: (p.y + ring[(i + 1) % 4].y) / 2 }));
  const inset = (n: number) => Math.max(n - 2 * CORNER_INSET_M, n / 2);
  const outer = corners(fp.pos, { ...fp.size, w: inset(fp.size.w), d: inset(fp.size.d) }, fp.rotY);
  return [{ x: fp.pos.x, y: floorY, z: fp.pos.z }, ...[...ring, ...mids, ...outer].map(at)];
}

/** Whether a world x/z lies inside the footprint grown by `grow` meters (inverse of the rotation in ops.corners). */
export function inFootprint(v: Vec, fp: Footprint, grow = GROW_M): boolean {
  const a = (fp.rotY * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = v.x - fp.pos.x, dz = v.z - fp.pos.z;
  return Math.abs(dx * c - dz * s) <= fp.size.w / 2 + grow && Math.abs(dx * s + dz * c) <= fp.size.d / 2 + grow;
}

/** A point is blocked when its ray stops on a raised surface inside the footprint, free when it reaches the floor
 *  there, and unknown otherwise (not probed, nothing hit, or something closer and outside the footprint in the way).
 *  The spot is blocked at ≥ 2 blocked points (one stray hit is noise). */
export function classify(floorY: number, fp: Footprint, samples: Sample[]): ProbeResult {
  let unknown = 0;
  const raised: number[] = [];
  for (const s of samples) {
    if (!s.hit || !inFootprint(s.hit, fp)) unknown++;
    else if (s.hit.y > floorY + RAISED_M) raised.push(s.hit.y - floorY);
  }
  const blocked = raised.length >= 2;
  if (!blocked) return { blocked, unknown };
  const top = Math.max(...raised);
  return { blocked, unknown, reason: `a built-in surface about ${top.toFixed(1)} m high is in the way` };
}

type PlannedAdd = { group?: string; anchor?: boolean; pos?: { x: number; z: number; y?: number }; size?: Size; rotY?: number };
/** Which planned add ops survive the probe. A blocked anchor takes its whole group (chairs around a blocked table); a
 *  blocked dependent takes only itself and what stands on it (the lamp on a blocked nightstand): same group, higher up,
 *  center within its footprint. Ops without a group (not from the planner) drop alone. */
export function dropBlocked(ops: object[], blockedIdx: Set<number>): { keep: object[]; skipped: number } {
  const list = ops as PlannedAdd[], drop = new Set(blockedIdx);
  for (const i of blockedIdx) {
    const b = list[i];
    if (!b?.group) continue;
    list.forEach((o, j) => {
      if (o.group !== b.group) return;
      if (b.anchor) { drop.add(j); return; }
      const fp = b.pos && b.size && { pos: { x: b.pos.x, y: 0, z: b.pos.z }, size: b.size, rotY: b.rotY ?? 0 };
      if (fp && o.pos && (o.pos.y ?? 0) > (b.pos!.y ?? 0) && inFootprint({ x: o.pos.x, y: 0, z: o.pos.z }, fp, 0)) drop.add(j);
    });
  }
  const keep = ops.filter((_, j) => !drop.has(j));
  return { keep, skipped: ops.length - keep.length };
}
