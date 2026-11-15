import { centroid, pointInPolygon, type Pt } from "../geometry/polygon";
import type { Room, RoomGraph, ShellReport } from "../types";

const SID = /^[A-Za-z0-9]{6,20}$/;

/** Showcase embed URL. `yaw` (degrees, SDK convention) becomes the `sr` start rotation so the plain tour faces the room. */
export function tourUrl(sid: string, sweepIndex?: number, yaw?: number): string {
  if (!SID.test(sid)) throw new Error("not a Matterport sid");
  const sr = sweepIndex != null && yaw != null ? `&sr=0,${((yaw * Math.PI) / 180).toFixed(2)}` : "";
  return `https://my.matterport.com/show/?m=${sid}&play=1&qs=1&brand=0${sweepIndex != null ? `&ss=${sweepIndex}${sr}` : ""}`;
}

/** Where the tour stands to show a room: a camera spot inside it when the scan has one, else the nearest spot facing it. */
export type RoomStop = { sweepId: string; index?: number; inside: boolean; yaw?: number };

const indexOf = (label?: string) => (label && /^\d+$/.test(label) ? Number(label) : undefined);

/**
 * Yaw (degrees) that faces `to` from `from`, both plan points. Plan (x, y) is world (x, -z); the SDK camera looks down
 * -z at yaw 0 and turns left as yaw grows (three.js convention), so facing world (dx, dz) needs atan2(-dx, -dz).
 */
export function yawToward(from: Pt, to: Pt): number {
  const dx = to.x - from.x, dz = -(to.y - from.y);
  return Math.round(((Math.atan2(-dx, -dz) * 180) / Math.PI) * 10) / 10;
}

export function roomStop(g: RoomGraph | undefined, room: Room | undefined): RoomStop | undefined {
  if (!g || !room) return undefined;
  const panos = g.panos ?? [];
  const poly = room.polygon ?? [];
  if (poly.length < 3 || !panos.length) {
    // No geometry to check against: trust Matterport's own room attribution.
    const s = room.sweeps?.[0];
    return s ? { sweepId: s.id, index: s.index, inside: true } : undefined;
  }
  const c = centroid(poly);
  const dist = (p: Pt) => Math.hypot(p.x - c.x, p.y - c.y);
  const own = new Set((room.sweeps ?? []).map((s) => s.id));
  const inRoom = panos.filter((p) => pointInPolygon(p, poly)).sort((a, b) => dist(a) - dist(b));
  // A spot Matterport assigned to this room and that sits inside its outline beats any other spot inside it.
  const best = inRoom.find((p) => own.has(p.id)) ?? inRoom[0];
  if (best) return { sweepId: best.id, index: indexOf(best.label), inside: true };
  const near = [...panos].sort((a, b) => dist(a) - dist(b))[0];
  return { sweepId: near.id, index: indexOf(near.label), inside: false, yaw: yawToward(near, c) };
}

export type TourStep = { text: string; sweep?: number; sweepId?: string; yaw?: number; inside?: boolean; room?: string };

// Hermit narrates where each requested room lands, like an agent on a showing. When the scanner never stood inside
// a room, the tour stops at the nearest spot facing it and says so, instead of claiming the view is the room.
export function tourSteps(report: ShellReport, furniture: Record<string, string[]> = {}): TourStep[] {
  const g = report.floorplan;
  const start = g?.panos?.find((p) => p.id === report.inside?.sweepId);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  const steps: TourStep[] = [{ text: `Welcome to ${report.name.split(" · ")[0]}! Let me show you where everything you need would go.`, sweep: indexOf(start?.label), sweepId: start?.id }];
  for (const a of report.fit.assignment) {
    const name = a.req.replace(/\s*#(\d+)/, " $1");
    if (!a.roomId) { steps.push({ text: `Your ${name} isn't built here yet. The full report prices that work.`, room: name }); continue; }
    const room = g?.rooms.find((r) => r.id === a.roomId);
    const stop = roomStop(g, room);
    const items = [...new Set(furniture[a.req.replace(/ #\d+$/, "")] ?? [])];
    const size = room?.areaSqft ? `about ${Math.round(room.areaSqft).toLocaleString()} sq ft` : "";
    const picture = items.length ? ` Picture your ${list(items)} ${stop?.inside === false ? "in there" : "right here"}.` : "";
    const text = stop?.inside === false
      ? `Your ${name} is the room ahead of you${size ? `, ${size}` : ""}. The scanner never stood inside it, so this is the closest view.${picture}`
      : `This is where your ${name} would go.${size ? ` It's ${size}.` : ""}${picture}`;
    steps.push({ text, sweep: stop?.index, sweepId: stop?.sweepId, yaw: stop?.yaw, inside: stop?.inside, room: name });
  }
  steps.push({ text: report.unknowns.length ? `That's the tour! I couldn't see ${report.unknowns.length} things from the scan. They're questions for the landlord in the full report.` : "That's the tour! Look around on your own as long as you like." });
  return steps;
}
