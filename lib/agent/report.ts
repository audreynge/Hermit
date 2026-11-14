import type { Verdict } from "../crew";
import { useCategory } from "../reason/rules";
import { triangulate } from "../reason/triangulate";
import { buildoutCheck } from "../reason/buildout";
import { exclusiveScan } from "../reason/exclusive";
import type { SiteFile } from "../neighborhood/types";
import { packFor } from "../uses/packs";
import { sqftOf } from "../query/shells";
import type { Evidence, FitResult, RequirementSpec, RoomGraph, RuleHit, ScoreLine, Shell, ShellReport, WorkItem } from "../types";

export type Evaluation = {
  shell: Shell;
  searchScore: number;
  searchReasons: string[];
  graph: RoomGraph | null;
  fit: FitResult;
  rules: RuleHit[];
  work: { items: WorkItem[]; weeksToOpen: [number, number]; costRange: [number, number]; tiAllowance?: number };
  finalScore: number;
  lines: ScoreLine[];
  escalations: { question: string; outcome: string }[];
  verdicts: Verdict[];
};

const QUESTIONS: Record<string, string> = {
  electrical: "Is heavy power available? What is the electrical service (amps, volts, phase) to the space?",
  fire: "What sprinkler system serves the space, and is it rated for our storage height?",
  drive_in_bays: "How many grade-level drive-in doors does the space have, and what are their dimensions?",
  zoning: "Are there deed restrictions or zoning conditions that would limit our use?",
  parking: "How many parking stalls are allocated to this space?",
  accessibility: "Is there a step-free entry and an accessible restroom on this floor?",
  hvac: "What cooling capacity (tons) serves the suite, and how old is the equipment?",
  availability: "Is the space currently available, and from what date?",
  onsite_parking: "How many on-site parking spaces come with the space?",
  ground_floor: "Which floor is the space on, and is there a street-level entrance?",
  transit: "How close is the nearest bus or rail stop?",
};

export const displayName = (name: string) =>
  name.split(" · ")[0].replace(/\s*[-–]\s*[\d,]+\s*(?:SF|sq\.?\s*ft)\s*$/i, "").trim();

const NEIGHBOR: Record<string, string[]> = { medical: ["office"], salon: ["retail", "office"], office: ["medical"], retail: ["salon", "office"], warehouse: ["manufacturing"], manufacturing: ["warehouse"], fitness: ["retail", "office"] };

// Every point is accounted for: the visible lines sum to the match score.
export function scoreLines(spec: RequirementSpec, shell: Shell, graph: RoomGraph | null, fit: FitResult, rules: RuleHit[]): ScoreLine[] {
  const use = useCategory(spec.useType);
  const lines: ScoreLine[] = [];
  const exact = spec.mode === "home" ? shell.mode === "home" : shell.useTags.includes(use);
  const near = !exact && shell.useTags.some((t) => NEIGHBOR[use]?.includes(t));
  lines.push({ factor: "Built for your use", earned: exact ? 20 : near ? 8 : 0, max: 20,
    note: exact ? (shell.scanClass ? `Matterport reads it as ${shell.scanClass.replace(/_/g, " ")}` : `Prior use ${use}`) : near ? `Close use (${shell.useTags.join(", ")}); conversion needed` : "Different prior use",
    source: shell.scanClass ? `matterport ${shell.sid}.propertyClassifications` : `models_index name "${shell.name}"` });

  if (graph && fit.assignment.length) {
    // Full credit for a room that's there as-is, half for one that needs a fixture or a change, none for one to build.
    const credit = fit.assignment.map((a) => {
      if (!a.roomId) return 0;
      const needsWork = fit.edits.some((e) => e.includes(a.req)) || a.cost >= 15;
      return needsWork ? 0.5 : 1;
    });
    const asIs = credit.filter((c) => c === 1).length, partial = credit.filter((c) => c === 0.5).length;
    const missing = credit.length - asIs - partial;
    lines.push({ factor: "Rooms already built", earned: Math.round((30 * credit.reduce((s: number, c) => s + c, 0)) / credit.length), max: 30,
      note: `${asIs} ready as-is, ${partial} need changes, ${missing} not found of ${credit.length} rooms`, source: `matterport ${graph.sid} room graph` });
  } else lines.push({ factor: "Rooms already built", earned: 0, max: 30, note: graph ? "No rooms requested" : "Record-only: no scan to walk", source: graph ? "spec" : "none" });

  const area = graph?.totalAreaSqft && graph.totalAreaSqft > 30 ? graph.totalAreaSqft : sqftOf(shell);
  if (spec.sizeSqft && area) {
    const [lo, hi] = spec.sizeSqft;
    const off = area < lo ? (lo - area) / lo : area > hi ? (area - hi) / hi : 0;
    lines.push({ factor: "Size", earned: Math.round(20 * Math.max(0, 1 - off * 1.5)), max: 20, note: `${Math.round(area).toLocaleString()} sf ${graph ? "measured" : "on record"} vs ${lo.toLocaleString()}–${hi.toLocaleString()} wanted`, source: graph ? `matterport ${graph.sid}.dimensions` : "index" });
  } else lines.push({ factor: "Size", earned: spec.sizeSqft ? 6 : 20, max: 20, note: spec.sizeSqft ? "Size unknown" : "No size requested", source: "spec" });

  const adj = fit.breakdown.adjacency;
  lines.push({ factor: "Layout and adjacency", earned: adj != null ? Math.round(adj / 10) : graph ? 7 : 3, max: 10, note: adj != null ? `Requested neighbours ${adj >= 70 ? "line up" : "need rework"}` : graph ? "No adjacency asked; layout unconfirmed" : "Unverified without a scan", source: graph ? `matterport ${graph.sid}.edges` : "none" });

  const fails = rules.filter((r) => r.status === "fail").length, warns = rules.filter((r) => r.status === "warn").length, unk = rules.filter((r) => r.status === "unknown").length;
  lines.push({ factor: "Code and site screens", earned: Math.max(0, 20 - fails * 8 - warns * 3 - unk), max: 20, note: `${fails} fail, ${warns} warn, ${unk} unknown`, source: "rules/screening.json" });

  const sum = lines.reduce((s, l) => s + l.earned, 0);
  if (fit.hardFails.length && sum > 40) lines.push({ factor: "Hard fail cap", earned: 40 - sum, max: 0, note: fit.hardFails[0], source: graph ? `matterport ${graph.sid}` : "spec" });
  return lines;
}

export const total = (lines: ScoreLine[]) => Math.max(0, Math.min(100, lines.reduce((s, l) => s + l.earned, 0)));

export function buildReport(spec: RequirementSpec, e: Evaluation, rank: number, site: SiteFile | null = null): ShellReport {
  const { shell, graph, fit, rules, work } = e;
  const buildout = buildoutCheck(spec.useType, graph);
  const exclusive = exclusiveScan(site, spec.useType);
  const pack = packFor(spec);
  const sources: Evidence[] = [
    ...(shell.propertyId ? [{ source: "costar", ref: `property ${shell.propertyId}`, confidence: 0.9 }] : []),
    ...(shell.homesListingId ? [{ source: "costar", ref: `residential listing ${shell.homesListingId}`, confidence: 0.9 }] : []),
    ...(graph ? [{ source: "matterport", ref: `${graph.sid} (${graph.rooms.length} rooms, ${graph.panoCount} panos)`, confidence: 0.85 }] : []),
    ...rules.flatMap((r) => r.evidence),
  ].filter((s, i, a) => a.findIndex((x) => x.ref === s.ref) === i);

  const unknowns: ShellReport["unknowns"] = rules
    .filter((r) => r.status === "unknown" || (r.status === "warn" && QUESTIONS[r.rule]))
    .map((r) => ({ topic: r.rule.replace(/_/g, " "), question: QUESTIONS[r.rule] ?? r.detail }));
  for (const v of e.verdicts) for (const q of v.questions) unknowns.push({ topic: v.agent, question: q });
  for (const x of e.escalations) if (/unresolved|not observed/i.test(x.outcome)) unknowns.push({ topic: "scan detail", question: x.question });
  for (const h of pack.hidden) if (!unknowns.some((u) => u.question.startsWith(h))) unknowns.push({ topic: "behind the walls", question: `${h}: what's in place today?` });
  for (const b of buildout) if (b.status !== "seen") unknowns.unshift({ topic: "unverified build-out", question: b.question });
  for (const c of exclusive.conflicts.slice(0, 2)) unknowns.unshift({ topic: "competitor nearby", question: `${c.name} (${c.what}) is ${c.where}. Does it have an exclusive that would block my use?` });
  if (exclusive.question) unknowns.unshift({ topic: "exclusive use", question: exclusive.question });
  const seen = new Set<string>();
  const dedup = unknowns.filter((u) => (seen.has(u.question) ? false : (seen.add(u.question), true)));

  const matched = fit.assignment.filter((a) => a.roomId).length;
  const fails = rules.filter((r) => r.status === "fail");
  const verdict = fit.hardFails.length || fails.length ? "Conditional fit" : e.finalScore >= 70 ? "Likely fits" : e.finalScore >= 50 ? "Workable with changes" : "Long shot";
  const items = work.items.length;
  const cost = items ? `${items} work item${items > 1 ? "s" : ""} (screening estimate $${Math.round(work.costRange[0] / 1000)}k–$${Math.round(work.costRange[1] / 1000)}k)` : "no build-out found in the scan";
  const area = graph ? `${Math.round(graph.totalAreaSqft).toLocaleString()} sf measured` : "";
  const rooms = fit.assignment.length ? `${matched} of ${fit.assignment.length} rooms you need are already built (${area}).` : `${area}.`;
  const unclear = fit.unknowns.length ? ` ${fit.unknowns.length} couldn't be identified from scan labels, so they're questions, not passes.` : "";
  const summary = graph
    ? `${rooms}${unclear} ${items ? `Work left: ${cost}` : "No build-out found"}, about ${work.weeksToOpen[0]}–${work.weeksToOpen[1]} weeks to open.`
    : `Record-only: no room scan, so room fit is not verified. ${cost}.`;

  const contact = shell.listing?.contact?.name?.split(" ")[0];
  const asks = dedup.slice(0, 5).map((u) => `- ${u.question}`).join("\n");
  const draftMessage = `Hi${contact ? ` ${contact}` : ""},\n\nI'm looking for space for a ${spec.useType} in ${spec.city === "houston" ? "Houston" : "Los Angeles"}${spec.sizeSqft ? ` (about ${spec.sizeSqft[0].toLocaleString()}–${spec.sizeSqft[1].toLocaleString()} sf)` : ""}, and ${displayName(shell.name)}${shell.address ? ` at ${shell.address}` : ""} looks promising: ${matched ? `${matched} of the ${fit.assignment.length} rooms I need already look built` : "the layout looks workable"}.\n\nCould you help with a few questions?\n${asks || "- Is the space available, and what are the terms?"}\n\nThanks!`;

  return {
    shellId: shell.id, rank,
    name: displayName(shell.name), address: shell.address, verdict, summary,
    matchScore: e.finalScore, sqft: sqftOf(shell), useTags: shell.useTags,
    reasons: e.searchReasons.slice(0, 3), fit, rules, work: work.items, weeksToOpen: work.weeksToOpen, costRange: work.costRange, tiAllowance: work.tiAllowance,
    unknowns: dedup,
    inside: shell.sid ? { sid: shell.sid, sweepId: evidenceSweep(e) } : undefined,
    above: shell.lat != null && shell.lon != null ? { lat: shell.lat, lon: shell.lon, provider: "Esri World Imagery", overlays: [{ kind: "pin", lat: shell.lat, lon: shell.lon, label: shell.name }] } : undefined,
    floorplan: graph ?? undefined,
    draftMessage, badge: graph ? "scan-verified" : "record-only", sources, listing: shell.listing,
    score: e.lines, crew: e.verdicts, triangulation: triangulate(spec, shell, graph), defurnished: shell.defurnished,
    buildout, conflicts: exclusive.conflicts,
  };
}

// Open the tour on the sweep nearest the first matched room (the evidence), else the first sweep.
function evidenceSweep(e: Evaluation): string | undefined {
  const g = e.graph;
  if (!g) return undefined;
  const first = e.fit.assignment.find((a) => a.roomId);
  return g.rooms.find((r) => r.id === first?.roomId)?.panoId ?? g.panos?.[0]?.id;
}
