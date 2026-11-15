export type Pt = { x: number; y: number };

export const SQFT_PER_SQM = 10.7639;

export function shoelaceArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function centroid(pts: Pt[]): Pt {
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

const near = (a: Pt, b: Pt, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

// Wall segments → the room's outline. Open-plan rooms have interior wall stubs and T-junctions, so a simple chain
// walk dead-ends partway round; instead trace the outer face of the wall graph (outermost turn at every junction,
// both windings, keep the larger). Falls back to the chain walk when the walls don't close.
export function ringFromEdges(edges: Pt[][], tol = 0.01): Pt[] {
  const outer = outerFace(edges, tol);
  return outer.length >= 3 ? outer : chainWalk(edges, tol);
}

function outerFace(edges: Pt[][], tol: number): Pt[] {
  const vs: Pt[] = [], adj: Set<number>[] = [];
  const id = (p: Pt) => {
    let i = vs.findIndex((q) => near(q, p, tol));
    if (i < 0) { i = vs.push(p) - 1; adj.push(new Set()); }
    return i;
  };
  for (const e of edges) if (e.length >= 2) { const a = id(e[0]), b = id(e[e.length - 1]); if (a !== b) { adj[a].add(b); adj[b].add(a); } }
  for (let pruned = true; pruned;) { // dangling wall stubs aren't part of any outline
    pruned = false;
    adj.forEach((n, i) => { if (n.size === 1) { for (const j of n) adj[j].delete(i); n.clear(); pruned = true; } });
  }
  const live = vs.map((_, i) => i).filter((i) => adj[i].size >= 2);
  if (!live.length) return [];
  const start = live.reduce((a, b) => (vs[b].x < vs[a].x || (vs[b].x === vs[a].x && vs[b].y < vs[a].y) ? b : a));
  const walk = (sign: 1 | -1): Pt[] => {
    const ring = [start];
    let prev = -1, cur = start;
    for (let k = 0; k < 4 * vs.length; k++) {
      const back = prev < 0 ? Math.PI : Math.atan2(vs[prev].y - vs[cur].y, vs[prev].x - vs[cur].x);
      let best = -1, bestAng = Infinity;
      for (const n of adj[cur]) {
        if (n === prev) continue;
        const a = (((sign * (Math.atan2(vs[n].y - vs[cur].y, vs[n].x - vs[cur].x) - back)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (a < bestAng) { bestAng = a; best = n; }
      }
      if (best < 0) return [];
      prev = cur; cur = best;
      if (cur === start) return ring.map((i) => vs[i]);
      ring.push(cur);
    }
    return [];
  };
  const a = walk(1), b = walk(-1);
  return shoelaceArea(a) >= shoelaceArea(b) ? a : b;
}

function chainWalk(edges: Pt[][], tol: number): Pt[] {
  const left = edges.filter((e) => e.length >= 2).map((e) => [e[0], e[e.length - 1]]);
  if (!left.length) return [];
  const [first] = left.splice(0, 1);
  const ring = [first[0], first[1]];
  while (left.length) {
    const tail = ring[ring.length - 1];
    const i = left.findIndex(([a, b]) => near(a, tail, tol) || near(b, tail, tol));
    if (i < 0) break;
    const [a, b] = left.splice(i, 1)[0];
    ring.push(near(a, tail, tol) ? b : a);
  }
  if (ring.length > 2 && near(ring[0], ring[ring.length - 1], tol)) ring.pop();
  return ring;
}

export const perimeter = (pts: Pt[]) => pts.reduce((s, a, i) => s + Math.hypot(pts[(i + 1) % pts.length].x - a.x, pts[(i + 1) % pts.length].y - a.y), 0);

// For a long, thin room 2·area/perimeter approximates its clear width (exact for an infinitely long rectangle).
export const corridorWidth = (pts: Pt[]) => (pts.length >= 3 ? (2 * shoelaceArea(pts)) / perimeter(pts) : null);

// Even-odd ray cast.
export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Closest point to p on the polygon's boundary, with the edge it lies on. */
export function nearestOnBoundary(p: Pt, pts: Pt[]): { pt: Pt; a: Pt; b: Pt; dist: number } {
  let best = { pt: pts[0], a: pts[0], b: pts[0], dist: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const pt = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (dist < best.dist) best = { pt, a, b, dist };
  }
  return best;
}
