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

// Turns a room's unordered wall segments into its outline. Real scan boundaries carry stray stubs (partial walls) and
// inside partitions, so dead-end stubs are trimmed and the largest closed loop wins; an open chain (a wall missing from
// the scan) is walked end to end instead.
export function ringFromEdges(edges: Pt[][], tol = 0.01): Pt[] {
  const nodes: Pt[] = [];
  const nodeOf = (p: Pt) => { const i = nodes.findIndex((q) => near(p, q, tol)); return i >= 0 ? i : nodes.push(p) - 1; };
  const all = edges.filter((e) => e.length >= 2).map((e) => [nodeOf(e[0]), nodeOf(e[e.length - 1])]).filter(([a, b]) => a !== b);
  const degree = (segs: number[][]) => { const d = new Map<number, number>(); for (const s of segs) for (const n of s) d.set(n, (d.get(n) ?? 0) + 1); return d; };
  let loops = all;
  for (let d = degree(loops), next = loops.filter(([a, b]) => d.get(a)! > 1 && d.get(b)! > 1); next.length < loops.length; d = degree(next), next = next.filter(([a, b]) => d.get(a)! > 1 && d.get(b)! > 1)) loops = next;
  const ring = largestCycle(loops, nodes) ?? chain(all, degree(all));
  return ring.map((i) => nodes[i]);
}

/** Largest-area simple cycle through the segments (node ids), or null. Scan rooms have a few dozen walls; the search is capped. */
function largestCycle(segs: number[][], nodes: Pt[]): number[] | null {
  const adj = new Map<number, number[]>();
  segs.forEach(([a, b], i) => { for (const n of [a, b]) adj.set(n, [...(adj.get(n) ?? []), i]); });
  let best: number[] | null = null, bestArea = 0, budget = 20_000;
  const used = new Set<number>(), path: number[] = [];
  const walk = (start: number, at: number) => {
    for (const si of adj.get(at) ?? []) {
      if (used.has(si) || budget-- <= 0) continue;
      const to = segs[si][0] === at ? segs[si][1] : segs[si][0];
      if (to === start) {
        const area = path.length >= 3 ? shoelaceArea(path.map((i) => nodes[i])) : 0;
        if (area > bestArea) { bestArea = area; best = [...path]; }
      } else if (!path.includes(to)) { used.add(si); path.push(to); walk(start, to); path.pop(); used.delete(si); }
    }
  };
  for (const start of new Set(segs.flat())) { path.push(start); walk(start, start); path.pop(); }
  return best;
}

/** Walks segments end to end from a dead end (so no wall before the first segment is lost); stops at the first gap. */
function chain(segs: number[][], degree: Map<number, number>): number[] {
  if (!segs.length) return [];
  const left = [...segs], i = Math.max(0, left.findIndex(([a, b]) => degree.get(a) === 1 || degree.get(b) === 1));
  const [a, b] = left.splice(i, 1)[0], ring = degree.get(b) === 1 && degree.get(a) !== 1 ? [b, a] : [a, b];
  for (let j = 0; j >= 0;) {
    const tail = ring[ring.length - 1];
    j = left.findIndex(([p, q]) => p === tail || q === tail);
    if (j >= 0) { const [p, q] = left.splice(j, 1)[0]; ring.push(p === tail ? q : p); }
  }
  if (ring.length > 2 && ring[0] === ring[ring.length - 1]) ring.pop();
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
