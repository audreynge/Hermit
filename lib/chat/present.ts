import { displayName } from "../agent/report";
import type { RequirementSpec, ShellReport, TraceEvent } from "../types";
import { an } from "../text";

export { displayName };

const CITY: Record<string, string> = { houston: "Houston", los_angeles: "Los Angeles" };
const STATE: Record<string, string> = { houston: "Texas", los_angeles: "California" };
const fmt = (n: number) => Math.round(n).toLocaleString();
const shortName = (r: ShellReport) => displayName(r.name);
const k = (n: number) => `$${Math.round(n / 1000)}k`;
export const areaOf = (r: ShellReport) => r.floorplan?.totalAreaSqft ?? r.listing?.availableSqft ?? r.sqft;

function roomsPhrase(spec: Pick<RequirementSpec, "rooms">): string {
  const first = [...spec.rooms].sort((a, b) => b.count - a.count)[0];
  const rest = spec.rooms.filter((r) => r !== first);
  if (!first) return "";
  const main = first.count > 1 ? `${first.count} ${first.label}s` : an(first.label);
  return rest.length ? `${main} + support spaces` : main;
}

const READY: Record<string, string> = {
  medical: "Clinic-ready layout (minimal build-out)", salon: "Salon-ready layout (minimal build-out)", office: "Office-ready layout (minimal build-out)",
  retail: "Storefront-ready (minimal build-out)", restaurant: "Already built out as a restaurant", warehouse: "Already built for warehouse use",
  fitness: "Already built as a fitness space", manufacturing: "Already built for light industrial use", home: "Already laid out as a home",
};
const USED_AS: Record<string, string> = {
  medical: "clinic", salon: "salon", office: "office", retail: "store", restaurant: "restaurant", warehouse: "warehouse",
  fitness: "fitness space", manufacturing: "light industrial space", home: "home",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// One line on how a wheelchair gets on, from the door checks in lib/reason/rules.ts.
export function accessLine(r: ShellReport, spec: RequirementSpec): { text: string; ok: boolean } | null {
  if (!spec.needs.wheelchair) return null;
  const of = (rule: string, status: string) => r.rules.filter((x) => x.rule === rule && x.status === status);
  const rooms = (hits: ShellReport["rules"]) => hits.map((h) => h.detail.split(":")[0].toLowerCase()).join(", ");
  const narrow = of("door_width", "fail"), hinges = of("door_hinges", "warn");
  if (of("front_door", "fail").length) return { text: "Front door too narrow for the chair", ok: false };
  if (narrow.length) return { text: `${plural(narrow.length, "door")} too narrow for the chair (${rooms(narrow)})`, ok: false };
  const upstairs = of("other_floor", "fail");
  if (upstairs.length) return { text: `${rooms(upstairs).replace(/^./, (c) => c.toUpperCase())} on another floor: needs a stair lift`, ok: false };
  if (hinges.length) return { text: `Chair fits with offset hinges on ${plural(hinges.length, "door")} (${rooms(hinges)})`, ok: false };
  if (of("wheelchair_route", "pass").length) return { text: "Wheelchair reaches every main room", ok: true };
  if (of("door_width", "unknown").length || of("front_door", "unknown").length) return { text: "Door widths not measured yet: ask the landlord", ok: false };
  return null;
}

export function highlights(r: ShellReport, spec: RequirementSpec): string[] {
  const out: string[] = [];
  const access = accessLine(r, spec);
  if (access) out.push(access.text); // for a wheelchair user this decides the space, so it leads
  if (r.similarity) out.push(`Floor plan ${r.similarity.score}% like your drawing`);
  const area = areaOf(r);
  if (area && spec.sizeSqft) {
    const [lo, hi] = spec.sizeSqft;
    const rooms = roomsPhrase(spec);
    out.push(area >= lo && area <= hi * 1.1
      ? rooms ? `Right size for ${rooms}` : `Right size (${fmt(area)} sq ft)`
      : `${fmt(area)} sq ft (you asked for ${fmt(lo)}–${fmt(hi)})`);
  } else if (area) out.push(`${fmt(area)} sq ft`);

  const prior = r.reasons.find((x) => x.startsWith("Prior use matches"))?.match(/\((.+)\)/)?.[1];
  const matched = r.fit.assignment.filter((a) => a.roomId).length;
  // "Ready" needs scanned evidence: known work ≤ $10k and most requested rooms already there. Otherwise just the sourced prior use.
  const ready = !!r.floorplan && r.costRange != null && r.costRange[1] <= 10000 && matched * 2 > r.fit.assignment.length;
  if (prior) out.push(ready ? READY[prior] ?? `Already built as ${an(prior)} space (minimal build-out)` : `Previously used as ${an(USED_AS[prior] ?? `${prior} space`)}`);
  else if (r.fit.assignment.length) out.push(`${matched} of ${r.fit.assignment.length} rooms already built`);

  const wantsParking = !!(spec.needs.parking || spec.needs.parkingStalls);
  const onsite = wantsParking ? r.rules.find((x) => x.rule === "onsite_parking" && x.status === "pass") : undefined;
  const stalls = onsite?.detail.match(/(\d+)/)?.[1];
  if (onsite) out.push(`On-site parking${stalls ? ` (${stalls} stalls)` : ""}`);
  else if (wantsParking && r.rules.some((x) => x.rule === "parking" && x.status === "pass")) out.push("Enough parking for the use");
  if (r.listing?.status === "active") out.push(`Listed for ${r.listing.kind === "sale" ? "sale" : "lease"} now`);
  if (r.costRange && !r.costRange[1]) out.push("No build-out identified");
  else if (r.costRange) out.push(`About ${k(r.costRange[0])}–${k(r.costRange[1])} of work`);
  return out.slice(0, 3);
}

export function searchCounts(events: TraceEvent[]) {
  const s = events.find((e) => e.type === "tool" && e.tool === "search_shells") as Extract<TraceEvent, { type: "tool" }> | undefined;
  const text = (s?.summary ?? "").replace(/(\d),(?=\d{3})/g, "$1");
  // Older recorded runs: "N indexed → R rejected by hard filters → K kept".
  if (/rejected by hard filters/.test(text)) {
    const [indexed, rejected, kept] = (text.match(/\d+/g) ?? []).map(Number);
    return { indexed: indexed ?? 0, considered: (indexed ?? 0) - (rejected ?? 0), kept: kept ?? 0 };
  }
  // Current: "N scans indexed → … → M <last stage>; K kept". Stage labels can contain numbers (sizes), so read each stage's leading count.
  const stages = text.split(";")[0].split(" → ").map((x) => Number(x.match(/^\d+/)?.[0] ?? 0));
  return { indexed: stages[0] ?? 0, considered: stages.at(-1) ?? 0, kept: Number(text.match(/(\d+) kept/)?.[1] ?? 0) };
}

export function summarizeResults(reports: ShellReport[], spec: RequirementSpec, stats: { considered: number; dropped: number }) {
  const city = CITY[spec.city];
  if (!reports.length) {
    return {
      paragraphs: [`I couldn't find a space that clears your must-haves yet. I checked ${fmt(stats.considered)} spaces in ${city} and ruled out ${stats.dropped} on recorded evidence.`],
      followUp: "Want me to widen the size range, raise the budget, or relax a requirement?",
    };
  }
  const size = spec.sizeSqft ? ` that are roughly ${fmt(spec.sizeSqft[0])}–${fmt(spec.sizeSqft[1])} sq ft and` : " that";
  const rooms = roomsPhrase(spec);
  const top = reports[0];
  const strong = reports.filter((r) => r.matchScore >= 70).length;
  const n = strong || reports.length;
  const kind = strong ? "strong" : "possible";
  const area = areaOf(top);
  const all = highlights(top, spec);
  const sizeNote = all.find((x) => /^[\d,]+ sq ft/.test(x));
  const h = all.filter((x) => !x.startsWith("Right size") && x !== sizeNote).map((x) => x[0].toLowerCase() + x.slice(1));
  const why = [sizeNote ? `it's ${sizeNote}` : area ? `it's ${fmt(area)} sq ft` : "", ...h].filter(Boolean);
  const list = why.length > 1 ? `${why.slice(0, -1).join(", ")}, and ${why.at(-1)}` : why[0];
  return {
    paragraphs: [
      `Got it! I searched ${fmt(stats.considered)} spaces in ${city}${size} would work well for ${an(spec.useType)}${rooms ? ` with ${rooms}` : ""}.`,
      `I found ${n} ${kind} match${n === 1 ? "" : "es"}, with ${shortName(top)} being the best fit (${top.matchScore}%)${list ? `: ${list}` : ""}.`,
    ],
    followUp: `Would you like me to compare the layouts, adjust anything like size, location, or budget, or draft an email to the ${spec.mode === "home" ? "listing agent" : "property manager"}?`,
  };
}

export type Step = { id: string; icon: string; label: string; tone: "info" | "warn" };

export function thinkingSteps(events: TraceEvent[], spec: RequirementSpec): Step[] {
  const steps: Step[] = [];
  const add = (id: string, icon: string, label: string, tone: Step["tone"] = "info") => steps.push({ id, icon, label, tone });
  for (const e of events) {
    if (e.type === "tool" && e.tool === "search_shells") add(e.id, "search", `Searching ${fmt(searchCounts([e]).indexed)} spaces in ${CITY[spec.city]}`);
    if (e.type === "tool" && e.tool === "research_regulations") {
      add(e.id, "gavel", `Researching ${CITY[spec.city]} and ${STATE[spec.city]} rules for a ${spec.useType}`);
      for (const [, j, n] of e.summary.matchAll(/(city|county|state|federal) (\d+)/g)) add(`${e.id}-${j}`, "doc", `Found ${n} ${j} rule${n === "1" ? "" : "s"}`);
    }
    if (e.type === "tool" && e.tool === "match_layout") add(e.id, "layout", `Comparing your drawing with ${e.summary.match(/with (\d+) scanned/)?.[1] ?? "scanned"} real floor plans`);
    if (e.type === "tool" && e.tool === "screen_sites") {
      add(`${e.id}-z`, "gavel", "Checking local zoning laws");
      if (spec.needs.heavyPower || spec.needs.threePhase) add(`${e.id}-e`, "bolt", "Checking electrical requirements");
      if (spec.needs.esfr) add(`${e.id}-f`, "flame", "Checking fire sprinklers");
      if (spec.needs.parking || spec.needs.parkingStalls || spec.mode === "business") add(`${e.id}-p`, "car", "Counting parking");
      if (spec.needs.wheelchair || spec.needs.stepFree) add(`${e.id}-a`, "accessible", "Checking accessibility");
      add(`${e.id}-l`, "tag", "Checking listings for availability");
    }
    if (e.type === "tool" && e.tool === "evaluate_candidates") {
      add(`${e.id}-m`, "ruler", "Measuring rooms in 3D scans");
      if (spec.rooms.length) add(`${e.id}-r`, "layout", "Matching your rooms to real floor plans");
      add(`${e.id}-c`, "dollar", "Estimating build-out costs");
    }
    if (e.type === "drop") add(e.id, "x", `Ruled out a space: ${e.reason.split(/[;(]/)[0].replace(/^\w+: /, "").trim()}`, "warn");
    if (e.type === "escalate") {
      const thing = e.question.match(/is there an? ([\w -]+?) in/i)?.[1];
      add(e.id, "eye", thing ? `Looking for ${an(thing)} in the scan` : "Double-checking a detail in the scan");
    }
    if (e.type === "rerank") add(e.id, "sort", "Re-ranking on measured evidence");
    if (e.type === "tool" && e.tool === "verify_reports") add(e.id, "check", e.summary.replace(/ \((rules[^)]*)\)/, ""), /[1-9]\d* (demoted|flagged)|unavailable/.test(e.summary) ? "warn" : "info");
    if (e.type === "error") add(e.id, "alert", e.message, "warn");
    if (e.type === "report") add(e.id, "doc", "Writing your shell reports");
  }
  return steps;
}

export function traceSummary(events: TraceEvent[]): string[] {
  const out: string[] = [];
  const { kept, considered } = searchCounts(events);
  if (events.some((e) => e.type === "tool" && e.tool === "search_shells")) out.push(`Found ${fmt(kept)} space${kept === 1 ? "" : "s"} that pass your filters`);
  const lay = events.find((e) => e.type === "tool" && e.tool === "match_layout") as Extract<TraceEvent, { type: "tool" }> | undefined;
  const n = lay?.summary.match(/with (\d+) scanned/)?.[1];
  if (n) out.push(`Matched your layout against ${n} floor plans`);
  if (events.some((e) => e.type === "tool" && e.tool === "evaluate_candidates")) out.push("Evaluated fit (layout, size, use)");
  const rep = events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }> | undefined;
  if (rep) out.push(`Ranked ${rep.reports.length} matching space${rep.reports.length === 1 ? "" : "s"}`);
  return out;
}

export function draftEmail(r: ShellReport) {
  const to = r.listing?.contact?.email ?? "";
  const subject = r.address.startsWith(shortName(r)) ? `Inquiry about ${r.address}` : `Inquiry about ${shortName(r)} at ${r.address}`;
  const body = r.draftMessage;
  return { to, subject, body, mailto: `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}

export function compareRows(reports: ShellReport[]) {
  const parking = (r: ShellReport) => {
    const p = r.rules.find((x) => x.rule === "onsite_parking") ?? r.rules.find((x) => x.rule === "parking");
    return p ? (p.status === "unknown" ? "unknown" : p.detail.match(/^(\d+)/)?.[1] ? `${p.detail.match(/^(\d+)/)![1]} stalls` : p.status) : "—";
  };
  return [
    { label: "Match", values: reports.map((r) => `${r.matchScore}%`) },
    { label: "Size", values: reports.map((r) => (areaOf(r) ? `${fmt(areaOf(r)!)} sq ft` : "—")) },
    { label: "Rooms already built", values: reports.map((r) => (r.fit.assignment.length ? `${r.fit.assignment.filter((a) => a.roomId).length} of ${r.fit.assignment.length}` : "—")) },
    { label: "Weeks to open", values: reports.map((r) => `${r.weeksToOpen[0]}–${r.weeksToOpen[1]}`) },
    { label: "Known work", values: reports.map((r) => (r.costRange?.[1] ? `${k(r.costRange[0])}–${k(r.costRange[1])}` : "none")) },
    { label: "Parking", values: reports.map(parking) },
  ];
}
