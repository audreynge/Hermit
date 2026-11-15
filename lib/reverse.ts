import table from "../rules/uses.json";
import { fit, missingOf, roomCounts } from "./reason/fit";
import { normalizeRoomLabel } from "./reason/labels";
import { useCategory } from "./reason/rules";
import { estimateWork } from "./reason/work";
import { seedRooms } from "./uses/packs";
import type { RequirementSpec, RoomGraph, RoomReq, Shell } from "./types";

// "Also fits": the reverse match. For a scanned space, which other business uses is it already built for?
// Runs the same room fit Hermit uses for search, with each use pack's default rooms, and keeps only clear fits.
type Pack = { label: string; rooms: { label: string; count: number; fixtures?: string[] }[] };
const PACKS = table.packs as unknown as Record<string, Pack>;
const INDUSTRIAL = new Set(["warehouse", "manufacturing"]);
const MIN_FIT = 70;

const NOUN: Record<string, string> = { bathroom: "restroom", open: "open floor" };
const plural = (w: string) => (/s$/.test(w) ? w : `${w}s`);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export type AlsoFit = { use: string; label: string; why: string };

export function alsoFits(shell: Pick<Shell, "city" | "mode" | "useTags">, graph: RoomGraph, currentUseType: string): AlsoFit[] {
  const current = useCategory(currentUseType);
  const industrialShell = shell.mode === "enterprise" || shell.useTags.some((t) => INDUSTRIAL.has(t));
  const seen = new Set<string>();
  const out: { use: string; label: string; why: string; score: number; weeks: number }[] = [];

  for (const [use, pack] of Object.entries(PACKS)) {
    if (use === "home" || use === current) continue;
    // A warehouse program (open floor, office, restroom) matches almost any suite; only offer it for industrial buildings.
    if (INDUSTRIAL.has(use) !== industrialShell) continue;
    const program = JSON.stringify(pack.rooms.map((r) => [r.label, r.count, r.fixtures ?? []]));
    if (seen.has(program)) continue; // identical packs (warehouse / light industrial) say the same thing once
    const spec: RequirementSpec = { mode: "business", city: shell.city, useType: use, rooms: [], needs: {}, priorities: {}, input: "survey" };
    spec.rooms = seedRooms(spec);
    const f = fit(spec, graph);
    const counts = roomCounts(spec, f, graph);
    // Counted rooms (restrooms, exam rooms, offices) must already be there as that room type, not rooms to convert.
    if (f.score < MIN_FIT || f.hardFails.length || f.unknowns.length || counts.some((c) => missingOf(c) > 0 || c.have < c.need)) continue;
    // At most one room to build, and no signature fixture missing from a room the use needs (a hood in the kitchen).
    if (f.edits.filter((e) => e.startsWith("Build ")).length > 1 || f.edits.some((e) => /^Add .+ to /.test(e))) continue;
    const why = builtLine(spec.rooms, f, graph);
    if (!why) continue;
    seen.add(program);
    out.push({ use, label: pack.label, why, score: f.score, weeks: estimateWork(spec, shell as Shell, f, []).weeksToOpen[1] });
  }
  return out.sort((a, b) => b.score - a.score || a.weeks - b.weeks || a.use.localeCompare(b.use)).slice(0, 2).map(({ use, label, why }) => ({ use, label, why }));
}

// "Its 2 exam rooms with sinks, restroom and office are already built." Only rooms that need no change count.
function builtLine(rooms: RoomReq[], f: ReturnType<typeof fit>, g: RoomGraph): string | null {
  const parts: string[] = [];
  let total = 0, notRestrooms = 0;
  for (const r of rooms) {
    const rows = f.assignment.filter((a) => a.req === r.label || a.req.startsWith(`${r.label} #`));
    const want = normalizeRoomLabel([r.label]);
    const ready = rows.filter((a) => {
      const room = a.roomId ? g.rooms.find((x) => x.id === a.roomId) : undefined;
      // Same room type only: an unlabeled room is a room to convert, not an exam room already built.
      const same = room && (want === "other" ? room.label === r.label.toLowerCase() || room.rawTags.some((t) => t.toLowerCase() === r.label.toLowerCase()) : room.label === want);
      return same && a.cost < 15 && !f.edits.some((e) => e.includes(` to ${a.req}`) || e.includes(` for ${a.req}`));
    }).length;
    if (!ready) continue;
    total += ready;
    const implied = normalizeRoomLabel([r.label]) === "bathroom";
    if (!implied) notRestrooms += ready;
    const noun = NOUN[normalizeRoomLabel([r.label])] ?? r.label;
    const fixture = !implied && r.fixtures?.length ? r.fixtures[0] : null;
    parts.push(`${ready > 1 ? `${ready} ${plural(noun)}` : noun}${fixture ? ` with ${ready > 1 ? plural(fixture) : `a ${fixture}`}` : ""}`);
  }
  // Restrooms alone (or one ready room) don't make a space built for a use.
  if (!parts.length || total < 2 || !notRestrooms) return null;
  return `Its ${list(parts)} ${total > 1 ? "are" : "is"} already built.`;
}

// Evidence fallback for "Also fits". Most scans label small rooms "other", so the pack fit above rarely passes.
// This reads only what the scan measured and what the photo checks saw: private rooms of the right size, sinks
// seen in them, restrooms and open floor. Every claim in `why` is a count of those, nothing more.
const PRIVATE = (sf: number) => sf >= 60 && sf <= 260;
const KINDS: { use: string; label: string; current: RegExp; test: (n: Counts) => string | null }[] = [
  { use: "dental", label: "Dental office", current: /dental|dentist/i,
    test: (n) => (n.sinkRooms >= 2 && n.restrooms >= 1 ? `${n.sinkRooms} private rooms with sinks seen in the scan photos, and a restroom.` : null) },
  { use: "medical", label: "Medical clinic", current: /clinic|medical|doctor|pediatric|exam/i,
    test: (n) => (n.sinkRooms >= 2 && n.restrooms >= 1 ? `${n.sinkRooms} private rooms with sinks seen in the scan photos, and a restroom.` : null) },
  { use: "therapy", label: "Therapy or counseling practice", current: /therap|counsel|psych/i,
    test: (n) => (n.privateRooms >= 3 && n.restrooms >= 1 ? `${n.privateRooms} private rooms off a hallway and a restroom.` : null) },
  { use: "office", label: "Small office", current: /office|agency|cowork/i,
    test: (n) => (n.privateRooms >= 3 && n.restrooms >= 1 ? `${n.privateRooms} private offices and a restroom.` : null) },
];
type Counts = { privateRooms: number; sinkRooms: number; restrooms: number };

export function alsoFitsFromEvidence(graph: RoomGraph, checks: { roomId: string; feature: string; result: string }[], currentUseType: string): AlsoFit[] {
  const sinkSeen = new Set(checks.filter((c) => c.feature === "sink" && c.result === "seen").map((c) => c.roomId));
  const priv = graph.rooms.filter((r) => (r.label === "office" || r.label === "other") && PRIVATE(r.areaSqft) && r.polygon.length >= 3);
  const n: Counts = {
    privateRooms: priv.length,
    sinkRooms: priv.filter((r) => sinkSeen.has(r.id)).length,
    restrooms: graph.rooms.filter((r) => r.label === "bathroom").length || (checks.some((c) => c.feature === "toilet" && c.result === "seen") ? 1 : 0),
  };
  const out: AlsoFit[] = [];
  for (const k of KINDS) {
    if (k.current.test(currentUseType)) continue;
    const why = k.test(n);
    if (why) out.push({ use: k.use, label: k.label, why: `Its ${why.charAt(0).toLowerCase()}${why.slice(1)}` });
  }
  return out.slice(0, 2);
}
