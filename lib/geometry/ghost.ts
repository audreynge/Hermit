import { labelCost } from "../reason/labels";
import type { FitResult, RequirementSpec, RoomGraph, Similarity } from "../types";

// "Your layout on the real plan": which measured rooms already serve the user's rooms, which of the user's rooms
// still have to be built, and which scan rooms are left over. Pure; the floor plan draws it.
export type GhostMatch = {
  roomId: string;
  label: string; // the user's room name(s), e.g. "exam room #1" or "exam room #1 + lab" when two share one room
  reqs: string[];
  sf: number; // measured
  convert?: string; // the scan names this room something else ("office"), so it could become the user's room
  merged?: true; // a proposed merge of measured rooms (fit-out edit), not as scanned
};
export type GhostBuild = {
  label: string;
  sf?: number; // the user's target size, when they gave one
  unsure?: true; // not "missing": the scan couldn't tell (unlabeled rooms) or there is no scan
};
export type Ghost = { matched: GhostMatch[]; toBuild: GhostBuild[]; other: string[] };

type Opts = { spec?: Pick<RequirementSpec, "rooms" | "layout">; similarity?: Similarity };

const VAGUE = new Set(["other", "open"]);
const base = (key: string) => key.replace(/\s*#\d+$/, "");
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Built = same room type (or a room re-labelled with the exact name). Rooms the scan left vague are never "convert":
// the scan just didn't say what they are.
function convertFrom(req: string, room: { label: string; rawTags: string[] }): string | undefined {
  if (VAGUE.has(room.label)) return undefined;
  if (labelCost(req, room.label) === 0 || room.rawTags.some((t) => same(t, req))) return undefined;
  return room.label;
}

// Target size for a room to build: the user's min size, else "Build x (~N sf)" from the fit, else their drawn block.
function targetSf(key: string, nth: number, fit: FitResult, opts: Opts, usedBlocks: Set<number>): number | undefined {
  const label = base(key);
  const req = opts.spec?.rooms.find((r) => same(r.label, label));
  if (req?.minSqft) return Math.round(req.minSqft);
  for (const e of fit.edits) {
    const m = e.match(/^Build (.+?) \(~(\d+(?:\.\d+)?) sf\)/);
    if (m && same(m[1], key)) return Math.round(Number(m[2]));
  }
  const layout = opts.similarity?.layout ?? opts.spec?.layout;
  if (!layout?.length) return undefined;
  const paired = new Set(opts.similarity?.pairs.map((p) => p.mine) ?? []);
  const scale = opts.similarity?.scale ?? 1;
  const free = layout.map((b, i) => ({ b, i })).filter(({ b, i }) => same(b.label, label) && !paired.has(i) && !usedBlocks.has(i));
  const hit = free[Math.min(nth, free.length - 1)] ?? free[0];
  if (!hit) return undefined;
  usedBlocks.add(hit.i);
  const sf = hit.b.w * hit.b.h * scale;
  return sf > 0 ? Math.round(sf) : undefined;
}

export function ghost(fit: FitResult | null | undefined, graph: RoomGraph | null | undefined, opts: Opts = {}): Ghost {
  const assignment = fit?.assignment ?? [];
  const byRoom = new Map<string, string[]>();
  const missing: string[] = [];
  const lost: string[] = []; // matched to a room id the graph doesn't have
  for (const a of assignment) {
    const room = a.roomId && graph ? graph.rooms.find((r) => r.id === a.roomId) : undefined;
    if (room) byRoom.set(room.id, [...(byRoom.get(room.id) ?? []), a.req]);
    else if (a.roomId) lost.push(a.req);
    else missing.push(a.req);
  }

  const matched: GhostMatch[] = [...byRoom].map(([roomId, reqs]) => {
    const room = graph!.rooms.find((r) => r.id === roomId)!;
    const convert = reqs.map((q) => convertFrom(q, room)).find(Boolean);
    return {
      roomId, reqs, label: reqs.join(" + "), sf: Math.round(room.areaSqft),
      ...(convert ? { convert } : {}),
      ...(room.proposed && (room.parts?.length ?? 0) > 1 ? { merged: true as const } : {}),
    };
  });

  const unknown = (key: string) => !graph || lost.includes(key) || (fit?.unknowns ?? []).some((u) => u.startsWith(`${key}:`));
  const used = new Set<number>();
  const seen = new Map<string, number>();
  const toBuild: GhostBuild[] = [...missing, ...lost].map((key) => {
    const n = seen.get(base(key)) ?? 0;
    seen.set(base(key), n + 1);
    const sf = fit ? targetSf(key, n, fit, opts, used) : undefined;
    return { label: key, ...(sf ? { sf } : {}), ...(unknown(key) ? { unsure: true as const } : {}) };
  });

  const other = (graph?.rooms ?? []).filter((r) => !byRoom.has(r.id)).map((r) => r.id);
  return { matched, toBuild, other };
}

// "Exam room #1 → scanned room, 120 sf; Bathroom → to build" for screen readers.
export function ghostText(g: Ghost, roomName: (id: string) => string = () => "scanned room"): string[] {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return [
    ...g.matched.map((m) => `${cap(m.label)} → ${roomName(m.roomId)}, ${m.sf} sf${m.convert ? ` (scanned as ${m.convert}; could become yours)` : ""}${m.merged ? " (rooms joined)" : ""}`),
    ...g.toBuild.map((b) => `${cap(b.label)} → ${b.unsure ? "couldn't find it in the scan" : "to build"}${b.sf ? `, about ${b.sf} sf` : ""}`),
  ];
}
