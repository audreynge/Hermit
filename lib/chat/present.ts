import { displayName } from "../agent/report";
import type { RequirementSpec, ShellReport, TraceEvent } from "../types";
import { an } from "../text";
import { fitRows, fitShort, openingWeeks, openLine, sizeText } from "../uses/rooms";

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
  if (r.similarity && r.similarity.score >= 70) out.push("Floor plan close to your drawing");
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
  const rooms = fitShort(fitRows(r, spec));
  // "Ready" needs scanned evidence: known work ≤ $10k and most requested rooms already there. Otherwise just the sourced prior use.
  const ready = !!r.floorplan && r.costRange != null && r.costRange[1] <= 10000 && matched * 2 > r.fit.assignment.length;
  if (prior) out.push(ready ? READY[prior] ?? `Already built as ${an(prior)} space (minimal build-out)` : `Previously used as ${an(USED_AS[prior] ?? `${prior} space`)}`);
  else if (rooms) out.push(rooms.charAt(0).toUpperCase() + rooms.slice(1));

  const wantsParking = !!(spec.needs.parking || spec.needs.parkingStalls);
  const onsite = wantsParking ? r.rules.find((x) => x.rule === "onsite_parking" && x.status === "pass") : undefined;
  const stalls = onsite?.detail.match(/(\d+)/)?.[1];
  if (onsite) out.push(`On-site parking${stalls ? ` (${stalls} stalls)` : ""}`);
  else if (wantsParking && r.rules.some((x) => x.rule === "parking" && x.status === "pass")) out.push("Enough parking for the use");
  if (r.listing?.status === "active") out.push(`Listed for ${r.listing.kind === "sale" ? "sale" : "lease"} now`);
  if (r.costRange && !r.costRange[1]) out.push("No build-out found in the scan");
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

export function summarizeResults(reports: ShellReport[], spec: RequirementSpec, _stats: { considered: number; dropped: number }) {
  const city = CITY[spec.city];
  if (!reports.length) {
    return {
      paragraphs: [`I couldn't find a space in ${city} that clears your must-haves yet.`],
      followUp: "Want me to widen the size range or raise the budget?",
    };
  }
  // The count is what the results list shows, so the chat and the list never disagree.
  const n = reports.length;
  const top = reports[0];
  const all = highlights(top, spec);
  const sizeNote = all.find((x) => /^[\d,]+ sq ft/.test(x));
  const h = all.filter((x) => !x.startsWith("Right size") && x !== sizeNote).map((x) => x[0].toLowerCase() + x.slice(1));
  const size = sizeText(top);
  const why = [sizeNote ? `it's ${sizeNote}` : size ? `it's ${size}` : "", ...h].filter(Boolean);
  const list = why.length > 1 ? `${why.slice(0, -1).join(", ")}, and ${why.at(-1)}` : why[0];
  const park = parkingLine(top, spec);
  return {
    paragraphs: [`I found ${n} match${n === 1 ? "" : "es"} in ${city} for ${an(spec.useType)}. ${shortName(top)} is the best fit${list ? `: ${list}` : ""}. ${openLine(openingWeeks(top, spec), spec.mode === "home")}${park ? ` ${park.text}` : ""}`],
    followUp: `Want me to compare the layouts or draft an email to the ${spec.mode === "home" ? "listing agent" : "property manager"}?`,
  };
}

const recordStalls = (r: ShellReport) =>
  Number((r.rules.find((h) => h.rule === "parking") ?? r.rules.find((h) => h.rule === "onsite_parking"))?.detail.match(/(\d[\d,]*) recorded stalls?/i)?.[1]?.replace(/,/g, "")) || undefined;
const parkingRules = (r: ShellReport) => r.rules.filter((h) => h.rule === "parking" || h.rule === "onsite_parking");

/** The card's parking fact: the stall count on the CoStar record, and whether to ask where they are. */
export function parkingFact(r: ShellReport): { text: string; ask: boolean } | null {
  const n = recordStalls(r);
  if (!n) return null;
  return { text: `${n.toLocaleString()} parking (record)`, ask: parkingRules(r).some((h) => h.status === "warn" || h.status === "fail") };
}

/** One plain parking sentence for the chat and the Overview, only when the record and the aerial photo don't settle it. */
export function parkingLine(r: ShellReport, spec: Pick<RequirementSpec, "mode" | "useType">): { text: string } | null {
  const hits = parkingRules(r).filter((h) => h.status === "warn" || h.status === "fail");
  if (!hits.length) return null;
  const n = recordStalls(r);
  const who = spec.mode === "home" ? "you'd" : /clinic|medical|dental|doctor|pediatric/i.test(spec.useType) ? "patients" : "customers";
  if (n && hits.some((h) => /no marked surface lot/.test(h.detail)))
    return { text: `Parking: CoStar lists ${n.toLocaleString()} spaces, but the aerial photo shows no surface lot. Ask where ${who} park.` };
  return { text: `Parking: the CoStar record and the aerial photo don't settle it. Ask how many spaces come with the space, and where.` };
}

/** "2,714 scans indexed → 2,714 in Houston → …" reads as "2,714 spaces in Houston → …" (no repeated count). */
export function funnelText(summary: string): string {
  const stages = summary.split(" → ");
  const lead = stages[0]?.match(/^([\d,]+) scans indexed$/);
  const city = stages[1]?.match(/^([\d,]+) in (.+)$/);
  if (lead && city && lead[1] === city[1]) return [`${city[1]} spaces in ${city[2]}`, ...stages.slice(2)].join(" → ");
  return summary.replace(/ scans indexed/, " spaces on file");
}

export type Step ={ id: string; icon: string; label: string; tone: "info" | "warn" };

export function thinkingSteps(events: TraceEvent[], spec: RequirementSpec): Step[] {
  const steps: Step[] = [];
  const add = (id: string, icon: string, label: string, tone: Step["tone"] = "info") => { if (!steps.some((s) => s.label === label)) steps.push({ id, icon, label, tone }); };
  // "From above" only when something was actually counted on an aerial photo, not just because parking was asked for.
  const fromAbove = (ev?: { source: string }[]) => !!ev?.some((x) => /aerial|vexcel/i.test(x.source) && !/not counted/i.test(x.source));
  const aerial = events.some((e) => (e.type === "drop" && fromAbove(e.evidence)) || (e.type === "escalate" && fromAbove(e.evidence)) || (e.type === "report" && e.reports.some((r) => r.aerial)));
  const names = new Map<string, string>();
  const ruled = new Set<string>();
  for (const e of events) {
    if (e.type === "funnel") for (const s of e.stages) for (const r of s.removed) names.set(r.id, displayName(r.name));
    if (e.type === "veto") names.set(e.shellId, displayName(e.name));
    if (e.type === "report") for (const r of e.reports) names.set(r.shellId, displayName(r.name));
  }
  const LEVEL: Record<string, string> = { city: `City: ${CITY[spec.city]} permitting`, county: "County: health permits", state: `State: ${STATE[spec.city]} licensing`, federal: "Federal: ADA" };
  for (const e of events) {
    if (e.type === "tool" && e.tool === "search_shells") add(e.id, "search", `Searched spaces in ${CITY[spec.city]}`);
    if (e.type === "tool" && e.tool === "research_regulations") {
      const levels = [...e.summary.matchAll(/(city|county|state|federal) \d+/g)].map((m) => m[1]);
      if (!levels.length) add(e.id, "gavel", "Looked up local rules");
      for (const l of levels) add(`${e.id}-${l}`, "gavel", LEVEL[l]);
    }
    if (e.type === "tool" && e.tool === "match_layout") add(e.id, "layout", "Compared your drawing to floor plans");
    if (e.type === "tool" && e.tool === "screen_sites") {
      add(`${e.id}-z`, "gavel", "Checked zoning rules");
      if (spec.needs.heavyPower || spec.needs.threePhase) add(`${e.id}-e`, "bolt", "Checked electrical power");
      if (spec.needs.esfr) add(`${e.id}-f`, "flame", "Checked fire sprinklers");
      if (aerial && (spec.needs.parking || spec.needs.parkingStalls || spec.mode === "business")) add(`${e.id}-p`, "car", "Looked at parking from above");
      if (spec.needs.wheelchair || spec.needs.stepFree) add(`${e.id}-a`, "accessible", "Checked accessibility");
      add(`${e.id}-l`, "tag", "Checked what's still available");
    }
    if (e.type === "tool" && e.tool === "evaluate_candidates") {
      add(`${e.id}-m`, "ruler", "Measured the rooms");
      if (spec.rooms.length) add(`${e.id}-r`, "layout", "Matched your rooms to layouts");
      add(`${e.id}-c`, "dollar", "Estimated build-out costs");
    }
    if ((e.type === "drop" || e.type === "veto") && ruled.has(e.shellId)) continue;
    if (e.type === "drop" || e.type === "veto") ruled.add(e.shellId);
    if (e.type === "drop" || e.type === "veto") {
      // Newer runs start the reason with the space's name ("Suite 375, Denmark House: has no exam rooms"); older
      // ones don't, so the name comes from the run's other events. Old rule-key prefixes ("zoning: ...") are dropped.
      const own = e.reason.match(/^([^:]{3,90}): (.+)$/);
      const named = own && !/^[a-z_]+$/.test(own[1]);
      const name = named ? own![1] : e.type === "veto" ? displayName(e.name) : names.get(e.shellId);
      const why = (named ? own![2] : e.reason).split(/[;(]/)[0].replace(/^[a-z_]+: /, "").replace(/\.$/, "").trim();
      const what = why.charAt(0).toLowerCase() + why.slice(1);
      add(e.id, "x", name ? `Ruled out ${name}: ${what}` : `Ruled out: ${why}`, "warn");
    }
    if (e.type === "escalate") {
      const thing = e.question.match(/is there an? ([\w -]+?) in/i)?.[1];
      add(e.id, "eye", thing ? `Looked for ${an(thing)} in the scan` : "Rechecked a detail in the scan");
    }
    if (e.type === "areas" && e.areas.length) add(e.id, "search", `Ranked areas: ${e.areas.slice(0, 3).map((x) => x.zip).join(", ")}`);
    if (e.type === "challenge") add(e.id, "alert", e.outcome === "swapped" ? "Second opinion changed the top pick" : "Second opinion kept the top pick", e.outcome === "swapped" ? "warn" : "info");
    if (e.type === "rerank") add(e.id, "sort", "Re-ranked on what we measured");
    if (e.type === "tool" && e.tool === "verify_reports") add(e.id, "check", e.summary.replace(/ \((rules[^)]*)\)/, ""), /[1-9]\d* (demoted|flagged)|unavailable/.test(e.summary) ? "warn" : "info");
    if (e.type === "error") add(e.id, "alert", e.message, "warn");
    if (e.type === "report") add(e.id, "doc", "Wrote your reports");
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
    { label: "Size", values: reports.map((r) => sizeText(r) || "—") },
    { label: "Rooms already built", values: reports.map((r) => (r.fit.assignment.length ? `${fitRows(r).built.length} of ${r.fit.assignment.length}` : "—")) },
    { label: "Weeks to open", values: reports.map((r) => { const [lo, hi] = openingWeeks(r); return `${lo}–${hi}`; }) },
    { label: "Known work", values: reports.map((r) => (r.costRange?.[1] ? `${k(r.costRange[0])}–${k(r.costRange[1])}` : "none")) },
    { label: "Parking", values: reports.map(parking) },
  ];
}
