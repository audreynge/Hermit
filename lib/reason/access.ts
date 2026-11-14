import type { Access, AccessRoom, Room, RoomGraph } from "../types";

// Screening constants (2010 ADA Standards): 32 in clear door width (§404.2.3), 60 in turning circle (§304.3.1).
export const DOOR_STOP_IN = 2; // a hinged leaf + stop take ~2 in off the measured opening (estimate)
export const SWING_CLEAR_GAIN_IN = 1.75; // swing-clear (offset) hinges move the leaf out of the opening
export const DEFAULT_CHAIR_IN: [number, number] = [27, 42]; // typical power chair, width x length
export const chairFor = (needs: { chairWidthIn?: number }): [number, number] => [needs.chairWidthIn ?? DEFAULT_CHAIR_IN[0], DEFAULT_CHAIR_IN[1]];
const M_TO_IN = 39.3701;

const clearIn = (widthIn: number, gain: number) => widthIn - DOOR_STOP_IN + gain;

// Room-level route check: which rooms can a chair of this width reach from the entry,
// passing only through doors whose estimated clear width fits it?
function route(g: RoomGraph, chairW: number, gain: number): AccessRoom[] {
  const doors = g.edges.filter((e) => e.kind === "door");
  const start = g.entryRoomIds?.length
    ? g.entryRoomIds
    : [g.rooms.reduce((x, y) => (y.areaSqft > x.areaSqft ? y : x), g.rooms[0])?.id].filter(Boolean);
  const reached = new Set<string>(start);
  for (let queue = [...start]; queue.length; ) {
    const cur = queue.shift()!;
    for (const e of doors) {
      const next = e.a === cur ? e.b : e.b === cur ? e.a : null;
      if (next && !reached.has(next) && e.widthIn != null && clearIn(e.widthIn, gain) >= chairW) {
        reached.add(next);
        queue.push(next);
      }
    }
  }

  return g.rooms.map((r) => {
    const base = { roomId: r.id, label: r.label, turnCircleIn: r.label === "bathroom" ? turnCircleIn(r) : undefined };
    if (reached.has(r.id)) return { ...base, status: "reachable", reason: null };
    const into = doors.filter((e) => e.a === r.id || e.b === r.id);
    const fromReached = into.filter((e) => reached.has(e.a === r.id ? e.b : e.a));
    const shortfall = (edges: typeof doors) => {
      const best = edges.reduce((x, y) => (y.widthIn! > x.widthIn! ? y : x));
      const clear = clearIn(best.widthIn!, gain);
      const fromId = best.a === r.id ? best.b : best.a;
      const from = g.rooms.find((x) => x.id === fromId)?.label ?? "the next room";
      return clear < chairW
        ? { text: `widest door in (from ${from}) is ~${clear.toFixed(1)} in clear, ${(chairW - clear).toFixed(1)} in short of a ${chairW} in chair`, stopDoor: { from: fromId, clearIn: Math.round(clear * 10) / 10 } }
        : null;
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
    return { ...base, status: "unknown", reason: "no measured door connects it to the entry" };
  });
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

// null when the scan has no door widths at all (older bundles): nothing to screen.
export function checkAccess(g: RoomGraph, chairIn: [number, number] = DEFAULT_CHAIR_IN): Access | null {
  if (!g.rooms.length || !g.edges.some((e) => e.widthIn != null)) return null;
  return { chairIn, asScanned: route(g, chairIn[0], 0), hinges: route(g, chairIn[0], SWING_CLEAR_GAIN_IN) };
}
