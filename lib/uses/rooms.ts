import { openingPlan } from "../crew/planner";
import { roomCounts, shortfalls } from "../reason/fit";
import { labelCost, normalizeRoomLabel } from "../reason/labels";
import { an } from "../text";
import type { RequirementSpec, ShellReport } from "../types";

// The one room rule every screen uses (card, chat, report summary, Overview), so the numbers always agree:
// built = the scan labels the room as that type; setUp = another room where the scan photos show every fixture you asked
// for (an unlabeled room with a sink, for an exam room); convert = any other room here that could become it;
// unsure = no room matched, but the scan's labels couldn't say either way; toBuild = no room for it.
const ROOM_WORDS: Record<string, string> = { living: "living room", open: "open area", other: "unlabeled room" };
const sameType = (req: string, observed: string) =>
  normalizeRoomLabel([req]) === "other" ? req.toLowerCase() === observed.toLowerCase() : labelCost(req, observed) === 0;
const base = (req: string) => req.replace(/\s*#\d+$/, "");
const plural = (w: string) => (/(s|sh|ch|x)$/.test(w) ? `${w}es` : `${w}s`);
const words = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** "exam rooms #1 and #2", "exam room #1 and the lab" */
export function roomList(keys: string[]): string {
  const by = new Map<string, string[]>();
  for (const k of keys) { const m = k.match(/^(.*) (#\d+)$/); const b = m ? m[1] : k; (by.get(b) ?? by.set(b, []).get(b)!).push(m ? m[2] : ""); }
  return words([...by].map(([b, nums]) => (nums.length > 1 && nums.every(Boolean) ? `${plural(b)} ${words(nums)}` : nums.map((n) => (n ? `${b} ${n}` : b)).join(" and "))));
}

export type FitRows ={ built: string[]; setUp: { req: string; seen: string[] }[]; convert: { req: string; from: string }[]; unsure: string[]; toBuild: string[] };
type FitInput = Pick<ShellReport, "fit" | "floorplan"> & Partial<Pick<ShellReport, "checks">>;

export function fitRows(report: FitInput, spec?: Pick<RequirementSpec, "rooms">): FitRows {
  const out: FitRows = { built: [], setUp: [], convert: [], unsure: [], toBuild: [] };
  const unclear = new Set((report.fit.unknowns ?? []).map((u) => u.split(":")[0].trim()));
  for (const a of report.fit.assignment) {
    const room = a.roomId ? report.floorplan?.rooms.find((r) => r.id === a.roomId) : undefined;
    const fixtures = (spec?.rooms.find((r) => r.label.toLowerCase() === base(a.req).toLowerCase())?.fixtures ?? []).map((f) => f.toLowerCase());
    const seen = (f: string) => (report.checks ?? []).some((c) => c.roomId === a.roomId && c.result === "seen" && c.feature.toLowerCase() === f);
    if (!a.roomId) (unclear.has(a.req) ? out.unsure : out.toBuild).push(a.req);
    else if (room && sameType(base(a.req), room.label)) out.built.push(a.req);
    else if (room && fixtures.length && fixtures.every(seen)) out.setUp.push({ req: a.req, seen: fixtures });
    else out.convert.push({ req: a.req, from: room ? an(ROOM_WORDS[room.label] ?? room.label) : "a measured room" });
  }
  return out;
}

// "2 set up as exam rooms (sinks seen)"
function setUpPhrase(setUp: FitRows["setUp"]): string {
  const groups = new Map<string, { n: number; seen: string[] }>();
  for (const s of setUp) {
    const k = base(s.req);
    const g = groups.get(k) ?? { n: 0, seen: s.seen };
    g.n++;
    groups.set(k, g);
  }
  return [...groups].map(([label, g]) => `${g.n} set up as ${g.n === 1 ? an(label) : plural(label)} (${words(g.seen.map((f) => (g.n === 1 ? f : plural(f))))} seen)`).join(", ");
}

/** The short room count, word for word the same on the card, in the chat and on the Overview. */
export function fitShort(rows: FitRows): string {
  const total = rows.built.length + rows.setUp.length + rows.convert.length + rows.unsure.length + rows.toBuild.length;
  if (!total) return "";
  return `${rows.built.length} of ${total} rooms already built${rows.setUp.length ? `, plus ${setUpPhrase(rows.setUp)}` : ""}`;
}

/** The short count, then what could be made from rooms here and what's missing. */
export function fitLead(rows: FitRows): string {
  const short = fitShort(rows);
  if (!short) return "This space has no scan to measure.";
  const parts = [`${short}.`];
  if (rows.convert.length) parts.push(`${rows.convert.length} more could be made from rooms that are here.`);
  if (rows.unsure.length) parts.push(`${rows.unsure.length} couldn't be told from the scan, so ${rows.unsure.length === 1 ? "it's a question" : "they're questions"} for the landlord.`);
  if (rows.toBuild.length) parts.push(`${rows.toBuild.length} would need to be built new.`);
  return parts.join(" ");
}

/** Measured scan area vs the listing or record size: "about 2,322 sq ft measured (listing says 3,022)". */
export function sizeText(r: Pick<ShellReport, "floorplan" | "listing" | "sqft">): string {
  const measured = r.floorplan?.totalAreaSqft && r.floorplan.totalAreaSqft > 30 ? Math.round(r.floorplan.totalAreaSqft) : undefined;
  const fromListing = r.listing?.availableSqft;
  const record = fromListing ?? r.sqft;
  const said = fromListing ? "listing says" : "record says";
  if (measured) {
    // A listing more than twice the measured area is usually the whole building's availability, not this suite: leave it out.
    const differs = record && Math.abs(record - measured) / measured > 0.05 && record <= measured * 2;
    return `about ${measured.toLocaleString()} sq ft measured${differs ? ` (${said} ${Math.round(record).toLocaleString()})` : ""}`;
  }
  return record ? `${Math.round(record).toLocaleString()} sq ft (${fromListing ? "listing" : "record"}, not measured)` : "";
}

/** Weeks from touring and signing to opening day, from the opening plan (lib/crew/planner.ts). */
export function openingWeeks(r: Pick<ShellReport, "work" | "unknowns" | "address" | "useTags">, spec?: Pick<RequirementSpec, "city" | "useType">): [number, number] {
  const s = spec ?? { city: /houston/i.test(r.address) ? "houston" as const : "los_angeles" as const, useType: r.useTags?.[0] ?? "office" };
  return openingPlan(s, r).total;
}

/** "About 4 to 6 weeks to open, including signing the lease." The same sentence everywhere. */
export function openLine([lo, hi]: [number, number], home = false): string {
  const span = lo === hi ? `About ${lo} week${lo === 1 ? "" : "s"}` : `About ${lo} to ${hi} weeks`;
  return home ? `${span} to move in, including the application.` : `${span} to open, including signing the lease.`;
}

/** "No build-out found in the scan." / "3 things to build or change (screening estimate $11k–$36k)." */
export function workLine(r: Pick<ShellReport, "work" | "costRange" | "floorplan">): string {
  const n = r.work.length;
  if (!r.floorplan && !n) return "No scan, so the build-out isn't known yet.";
  if (!n) return "No build-out found in the scan.";
  const [lo, hi] = r.costRange ?? [0, 0];
  return `${n} thing${n === 1 ? "" : "s"} to build or change${hi ? ` (screening estimate $${Math.round(lo / 1000)}k–$${Math.round(hi / 1000)}k)` : ""}.`;
}

/** The report's one-glance summary: rooms, what's missing, work, time. report.ts writes it; the Overview recomputes it for older runs. */
export function summaryLine(r: FitInput & Pick<ShellReport, "work" | "costRange" | "unknowns" | "address" | "useTags">, spec: RequirementSpec): string {
  const short = fitShort(fitRows(r, spec));
  const missing = r.floorplan ? shortfalls(spec, roomCounts(spec, r.fit, r.floorplan)) : [];
  const rooms = !r.floorplan ? "Records only: no 3D scan, so the rooms aren't measured." : short ? `${short}.` : "";
  return [rooms, missing.length ? `Missing: ${missing.join("; ")}.` : "", workLine(r), openLine(openingWeeks(r, spec), spec.mode === "home")].filter(Boolean).join(" ");
}
