import { labelCost, normalizeRoomLabel } from "../reason/labels";
import { an } from "../text";
import type { ShellReport } from "../types";

// Same rule as lib/reason/fit.ts roomCounts: a room only counts as built when the scan labels it as that room type.
// Any other matched room (an unlabeled room for an exam room) is one that could become it, not one that's already there.
const ROOM_WORDS: Record<string, string> = { living: "living room", open: "open area", other: "unlabeled room" };
const sameType = (req: string, observed: string) =>
  normalizeRoomLabel([req]) === "other" ? req.toLowerCase() === observed.toLowerCase() : labelCost(req, observed) === 0;

export type FitRows = { built: string[]; convert: { req: string; from: string }[]; toBuild: string[] };

export function fitRows(report: Pick<ShellReport, "fit" | "floorplan">): FitRows {
  const out: FitRows = { built: [], convert: [], toBuild: [] };
  for (const a of report.fit.assignment) {
    const room = a.roomId ? report.floorplan?.rooms.find((r) => r.id === a.roomId) : undefined;
    if (!a.roomId) out.toBuild.push(a.req);
    else if (room && sameType(a.req.replace(/ #\d+$/, ""), room.label)) out.built.push(a.req);
    else out.convert.push({ req: a.req, from: room ? an(ROOM_WORDS[room.label] ?? room.label) : "a measured room" });
  }
  return out;
}

export function fitLead({ built, convert, toBuild }: FitRows): string {
  const total = built.length + convert.length + toBuild.length;
  if (!total) return "This space has no scan to measure.";
  const parts = [`${built.length} of the ${total} rooms you want ${built.length === 1 ? "is" : "are"} already built.`];
  if (convert.length) parts.push(`${convert.length} more could be made from rooms that are here.`);
  if (toBuild.length) parts.push(`${toBuild.length} would need to be built new.`);
  return parts.join(" ");
}
