import type { Access, AccessEntry, AccessRoom, AccessScenario, DoorMeasure, Room, RoomGraph } from "../types";

// Screening constants (2010 ADA Standards): 32 in clear door width (§404.2.3), 60 in turning circle (§304.3.1).
export const DOOR_STOP_IN = 2; // a hinged leaf + stop take ~2 in off the measured opening (estimate)
export const SWING_CLEAR_GAIN_IN = 1.75; // swing-clear (offset) hinges move the leaf out of the opening
export const DEFAULT_CHAIR_IN: [number, number] = [27, 42]; // typical power chair, width x length
export const chairFor = (needs: { chairWidthIn?: number }): [number, number] => [needs.chairWidthIn ?? DEFAULT_CHAIR_IN[0], DEFAULT_CHAIR_IN[1]];
const M_TO_IN = 39.3701;

// A hinged door loses ~2 in to its leaf and stop, which swing-clear hinges win back; a cased opening has no leaf.
const clearIn = (d: DoorMeasure, gain: number) => d.widthIn! - (d.open ? 0 : DOOR_STOP_IN - gain);
// The same estimate for drawing a door's label, as scanned or with swing-clear hinges.
export const doorClearIn = (d: DoorMeasure, hinges: boolean) => round1(clearIn(d, hinges ? SWING_CLEAR_GAIN_IN : 0));
const round1 = (n: number) => Math.round(n * 10) / 10;
const OPEN_PLAN = new Set(["living", "kitchen", "dining", "hallway", "other", "open"]);

// Where the chair starts: inside every outside door it fits through. A scan with no outside door
// starts in the largest room; a front door too narrow for the chair means the unit is out of reach.
function entry(g: RoomGraph, chairW: number, gain: number): { start: string[]; entry: AccessEntry } {
  const outside = g.entries ?? [];
  const measured = outside.filter((d) => d.widthIn != null);
  const fits = measured.filter((d) => clearIn(d, gain) >= chairW);
  const unmeasured = outside.filter((d) => d.widthIn == null);
  const widest = measured.reduce<(typeof measured)[number] | undefined>((x, y) => (!x || y.widthIn! > x.widthIn! ? y : x), undefined);
  const info = (d?: (typeof measured)[number]) => (d ? { clearIn: round1(clearIn(d, gain)), roomId: d.roomId, ...(d.at ? { at: d.at } : {}) } : {});
  if (fits.length) return { start: fits.map((d) => d.roomId), entry: { status: "fits", ...info(fits[0]) } };
  if (unmeasured.length) return { start: unmeasured.map((d) => d.roomId), entry: { status: "unknown", ...info(widest) } };
  if (widest) return { start: [], entry: { status: "blocked", ...info(widest) } };
  const largest = g.rooms.reduce((x, y) => (y.areaSqft > x.areaSqft ? y : x), g.rooms[0]);
  return { start: largest ? [largest.id] : [], entry: { status: "unknown" } };
}

// Room-level route check: which rooms can a chair of this width reach from the entry,
// passing only through doors whose estimated clear width fits it?
function route(g: RoomGraph, chairW: number, gain: number): AccessScenario {
  const doors = g.edges.filter((e) => e.kind === "door");
  const { start, entry: front } = entry(g, chairW, gain);
  const reached = new Set<string>(start);
  for (let queue = [...start]; queue.length; ) {
    const cur = queue.shift()!;
    for (const e of doors) {
      const next = e.a === cur ? e.b : e.b === cur ? e.a : null;
      if (next && !reached.has(next) && e.widthIn != null && clearIn(e, gain) >= chairW) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  const entryFloors = new Set(g.rooms.filter((r) => start.includes(r.id)).map((r) => r.floorId));
  const labelOf = (id: string) => g.rooms.find((x) => x.id === id)?.label ?? "the next room";
  const short = (clear: number) => `~${clear.toFixed(1)} in clear, ${(chairW - clear).toFixed(1)} in short of a ${chairW} in chair`;

  const rooms = g.rooms.map((r): AccessRoom => {
    const base = { roomId: r.id, label: r.label, turnCircleIn: r.label === "bathroom" ? turnCircleIn(r) : undefined };
    if (reached.has(r.id)) return { ...base, status: "reachable", reason: null };
    if (front.status === "blocked")
      return { ...base, status: "blocked", reason: `the widest outside door is ${short(front.clearIn!)}`, stopDoor: { from: "outside", clearIn: front.clearIn! } };
    if (entryFloors.size && !entryFloors.has(r.floorId))
      return { ...base, status: "blocked", reason: "on another floor; the scan shows no elevator or stair lift", otherFloor: true };
    const into = doors.filter((e) => e.a === r.id || e.b === r.id);
    const other = (e: { a: string; b: string }) => (e.a === r.id ? e.b : e.a);
    const fromReached = into.filter((e) => reached.has(other(e)));
    const shortfall = (edges: typeof doors) => {
      const best = edges.reduce((x, y) => (clearIn(y, gain) > clearIn(x, gain) ? y : x));
      const clear = clearIn(best, gain);
      return clear < chairW ? { text: `widest door in (from ${labelOf(other(best))}) is ${short(clear)}`, stopDoor: { from: other(best), clearIn: round1(clear) } } : null;
    };
    const measured = fromReached.filter((e) => e.widthIn != null);
    if (measured.length) {
      const s = shortfall(measured)!; // a door from a reached room that fit would have reached this room
      return { ...base, status: "blocked", reason: s.text, stopDoor: s.stopDoor };
    }
    if (fromReached.length) return { ...base, status: "unknown", reason: "door width not measured in the scan" };
    if (into.length && into.every((e) => e.widthIn != null)) {
      const own = shortfall(into); // its own door is too narrow too: say so, not just "behind another room"
      return own
        ? { ...base, status: "blocked", reason: `${own.text}, and it opens off a room the chair can't reach`, stopDoor: own.stopDoor }
        : { ...base, status: "blocked", reason: "every door in opens off a room the chair can't reach" };
    }
    // Matterport splits open-plan spaces with walls that have no opening; say so instead of "no door".
    const openTo = g.edges.find((e) => e.kind === "possible" && (e.a === r.id || e.b === r.id) && reached.has(other(e)) && OPEN_PLAN.has(r.label) && OPEN_PLAN.has(labelOf(other(e))));
    if (openTo) return { ...base, status: "unknown", reason: `shares a wall with no measured opening with the ${labelOf(other(openTo))}; likely open plan, check in the 3D tour` };
    return { ...base, status: "unknown", reason: "no measured door connects it to the entry" };
  });
  return { entry: front, rooms };
}

// Largest circle that fits inside the room polygon (walls only; fixtures are not in the scan geometry).
export function turnCircleIn(room: Room, stepM = 0.05): number | undefined {
  const p = room.polygon;
  if (p.length < 3) return undefined;
  const xs = p.map((v) => v.x), ys = p.map((v) => v.y);
  let best = 0;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += stepM)
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += stepM)
      if (inside(p, x, y)) best = Math.max(best, edgeDistance(p, x, y));
  return Math.round(best * 2 * M_TO_IN * 10) / 10;
}

function inside(p: Room["polygon"], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if ((p[i].y > y) !== (p[j].y > y) && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) hit = !hit;
  return hit;
}

function edgeDistance(p: Room["polygon"], x: number, y: number): number {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [ax, ay, bx, by] = [p[j].x, p[j].y, p[i].x, p[i].y];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2));
    d = Math.min(d, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
  }
  return d;
}

type Pt = { x: number; y: number };
const DOOR_TOL_M = 0.25; // a door centre this close to a drawn wall counts as on it
const outlines = (r?: Room) => (!r ? [] : r.parts?.length ? r.parts : r.polygon.length >= 3 ? [r.polygon] : []);
const onWall = (r: Room | undefined, p: Pt) => outlines(r).some((poly) => edgeDistance(poly, p.x, p.y) <= DOOR_TOL_M);

// Where to draw a door: on the drawn wall between rooms a and b (b null = outside door), else null.
// Scan polygons can be truncated, so a measured centre that misses either outline snaps to the nearest shared-wall point.
export function doorPoint(g: RoomGraph, a: string, b: string | null, at?: Pt): Pt | null {
  const ra = g.rooms.find((r) => r.id === a);
  if (b == null) {
    const others = g.rooms.filter((r) => r.id !== a && r.floorId === ra?.floorId);
    return at && onWall(ra, at) && !others.some((r) => outlines(r).some((poly) => inside(poly, at.x, at.y))) ? at : null;
  }
  const rb = g.rooms.find((r) => r.id === b);
  if (at && onWall(ra, at) && onWall(rb, at)) return at;
  const shared = outlines(ra).flatMap((poly) => poly.flatMap((q, i) => {
    const n = poly[(i + 1) % poly.length], steps = Math.max(1, Math.ceil(Math.hypot(n.x - q.x, n.y - q.y) / 0.1));
    return Array.from({ length: steps }, (_, k) => ({ x: q.x + ((n.x - q.x) * k) / steps, y: q.y + ((n.y - q.y) * k) / steps }));
  })).filter((p) => onWall(rb, p));
  if (!shared.length) return null;
  const ref = at ?? shared[Math.floor(shared.length / 2)];
  return shared.reduce((x, y) => (Math.hypot(y.x - ref.x, y.y - ref.y) < Math.hypot(x.x - ref.x, x.y - ref.y) ? y : x));
}

// null when the scan has no door widths at all (older bundles): nothing to screen.
export function checkAccess(g: RoomGraph, chairIn: [number, number] = DEFAULT_CHAIR_IN): Access | null {
  if (!g.rooms.length || !g.edges.some((e) => e.widthIn != null)) return null;
  const asScanned = route(g, chairIn[0], 0), hinges = route(g, chairIn[0], SWING_CLEAR_GAIN_IN);
  return { chairIn, asScanned: asScanned.rooms, hinges: hinges.rooms, entry: asScanned.entry, hingesEntry: hinges.entry };
}
