import type { ShellReport } from "../types";

const SID = /^[A-Za-z0-9]{6,20}$/;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function tourUrl(sid: string, sweepIndex?: number): string {
  if (!SID.test(sid)) throw new Error("not a Matterport sid");
  return `https://my.matterport.com/show/?m=${sid}&play=1&qs=1&brand=0${sweepIndex != null ? `&ss=${sweepIndex}` : ""}`;
}

// Requested rooms first (named after the requirement they satisfy), then other labeled scanned rooms.
export function roomStops(r: ShellReport): { label: string; index: number }[] {
  const rooms = r.floorplan?.rooms ?? [];
  const first = (id: string) => rooms.find((x) => x.id === id)?.sweeps?.[0]?.index;
  const used = new Set<string>();
  const stops: { label: string; index: number }[] = [];
  for (const a of r.fit.assignment) {
    const i = a.roomId ? first(a.roomId) : undefined;
    if (a.roomId && i != null) { stops.push({ label: cap(a.req), index: i }); used.add(a.roomId); }
  }
  for (const room of rooms) {
    const i = room.sweeps?.[0]?.index;
    if (!used.has(room.id) && i != null && room.label !== "other" && room.label !== "hallway") stops.push({ label: cap(room.label), index: i });
  }
  return stops;
}
