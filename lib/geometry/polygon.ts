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

// Walks unordered wall segments into a ring by matching endpoints; stops at the first gap.
export function ringFromEdges(edges: Pt[][], tol = 0.01): Pt[] {
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
