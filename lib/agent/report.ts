import type { Verdict } from "../crew";
import { chairFor, checkAccess } from "../reason/access";
import type { Finding } from "../regs/research";
import { parkingQuestion, useCategory } from "../reason/rules";
import { triangulate } from "../reason/triangulate";
import { buildoutCheck } from "../reason/buildout";
import { exclusiveScan } from "../reason/exclusive";
import type { SiteFile } from "../neighborhood/types";
import { packFor } from "../uses/packs";
import { classMatches, sqftOf } from "../query/shells";
import { countLine, missingOf, roomCounts, roomNoun, shortfalls } from "../reason/fit";
import { fitRows, fitShort, openingWeeks, roomList, summaryLine } from "../uses/rooms";
import type { AerialCount, Evidence, FitResult, PanoCheck, RequirementSpec, RoomGraph, RuleHit, ScoreLine, Shell, ShellReport, Similarity, WorkItem } from "../types";
import { an } from "../text";
import { alsoFits } from "../reverse";
import { mustHaves } from "./verify";

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
  escalations: { question: string; outcome: string; result?: PanoCheck["result"]; evidence?: Evidence[] }[];
  similarity?: Similarity;
  extraUnknowns?: { topic: string; question: string }[];
  verdicts: Verdict[];
  aerial?: AerialCount | null; // Vexcel count around the building (lib/vexcel/count.ts); null = not counted
  checks?: PanoCheck[]; // "looked closer" results on real scan photos, one per room and feature
  seen?: PanoCheck[]; // every "seen" photo check in this scan, used to refit rooms (a room with a visible sink can be the exam room)
};

// "Suite 1202, MEDPLACE" or "Medical Office, 7440 Cypress Creek Pky": the name a person would use, for trace reasons.
export function spaceName(shell: Pick<Shell, "name" | "address">): string {
  const parts = shell.name.split(" · ");
  const first = displayName(shell.name);
  const street = (parts[1] ?? shell.address ?? "").split(",")[0].trim();
  if (!street || first.toLowerCase().includes(street.toLowerCase()) || street.toLowerCase().includes(first.toLowerCase())) return first || street;
  if (parts[1] || !/\d/.test(first)) return `${first}, ${street}`;
  return first;
}

const QUESTIONS: Record<string, string> = {
  electrical: "Is heavy power available? What is the electrical service (amps, volts, phase) to the space?",
  fire: "What sprinkler system serves the space, and is it rated for our storage height?",
  drive_in_bays: "How many grade-level drive-in doors does the space have, and what are their dimensions?",
  zoning: "Are there deed restrictions or zoning conditions that would limit our use?",
  parking: "How many parking stalls are allocated to this space?",
  accessibility: "Is there a step-free entry and an accessible restroom on this floor?",
  door_width: "What is the clear width of each door into the bedrooms and bathroom?",
  front_door: "What is the clear width of the front door, and is the entry step-free?",
  turning_space: "Is there a 60 in clear turning circle in the bathroom once fixtures are in place?",
  hvac: "What cooling capacity (tons) serves the suite, and how old is the equipment?",
  availability: "Is the space currently available, and from what date?",
  onsite_parking: "How many on-site parking spaces come with the space?",
  ground_floor: "Which floor is the space on, and is there a street-level entrance?",
  transit: "How close is the nearest bus or rail stop?",
  zoning_records: "Which zone is the parcel in today, and does it permit our use by right?",
};
const PARKING_RULES = new Set(["parking", "onsite_parking"]);

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
    note: exact ? (classMatches(shell.scanClass, use) ? `Matterport reads it as ${shell.scanClass!.replace(/_/g, " ")}` : `Prior use ${use}`) : near ? `Close use (${shell.useTags.join(", ")}); conversion needed` : "Different prior use",
    source: exact && classMatches(shell.scanClass, use) ? `matterport ${shell.sid}.propertyClassifications` : `models_index name "${shell.name}"` });

  if (graph && fit.assignment.length) {
    // Full credit for a room that's there as-is, half for one that needs a fixture or a change, none for one to build.
    const credit = fit.assignment.map((a) => {
      if (!a.roomId) return 0;
      const needsWork = fit.edits.some((e) => e.includes(a.req)) || a.cost >= 15;
      return needsWork ? 0.5 : 1;
    });
    const asIs = credit.filter((c) => c === 1).length, partial = credit.filter((c) => c === 0.5).length;
    const missing = credit.length - asIs - partial;
    const tally = countLine(spec, roomCounts(spec, fit, graph));
    lines.push({ factor: "Rooms already built", earned: Math.round((30 * credit.reduce((s: number, c) => s + c, 0)) / credit.length), max: 30,
      note: `${tally ? `${tally}. ` : ""}${asIs} ready as-is, ${partial} need changes, ${missing} not found of ${credit.length} rooms`, source: `matterport ${graph.sid} room graph` });
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
  const short = graph ? shortfalls(spec, roomCounts(spec, fit, graph)) : [];
  const cap = fit.hardFails[0] ?? short[0];
  if (cap && sum > 40) lines.push({ factor: fit.hardFails.length ? "Hard fail cap" : "Missing rooms you need", earned: 40 - sum, max: 0, note: cap, source: graph ? `matterport ${graph.sid}` : "spec" });
  return lines;
}

export const total = (lines: ScoreLine[]) => Math.max(0, Math.min(100, lines.reduce((s, l) => s + l.earned, 0)));

// A door the scan says is too narrow becomes a specific ask: confirm the width, allow the fix.
function doorQuestions(rules: RuleHit[]) {
  return rules
    .filter((r) => ((r.rule === "door_width" || r.rule === "front_door") && r.status === "fail") || r.rule === "door_hinges")
    .map((r) => {
      const room = r.detail.split(":")[0].toLowerCase();
      const clear = r.detail.match(/~([\d.]+) in clear/)?.[1];
      const fix = r.rule === "door_hinges" ? "would you allow swing-clear (offset) hinges on it" : "would you allow it to be widened";
      return { topic: "door", question: `The ${room} door looks ${clear ? `about ${clear} in clear` : "narrow"} in the 3D tour. Can you confirm its clear width, and ${fix}?` };
    });
}

export function regulationHits(regs: Finding[]): RuleHit[] {
  const seen = new Map<string, number>();
  return regs.map((f) => {
    const n = (seen.get(f.topic) ?? 0) + 1;
    seen.set(f.topic, n);
    return {
      rule: n > 1 ? `reg_${f.topic}_${n}` : `reg_${f.topic}`,
      status: f.certainty === "applies" ? "warn" : "unknown",
      detail: `${f.requirement} (${f.jurisdiction} rule, checked ${f.retrievedAt}; screening only, verify with the jurisdiction)`,
      citation: f.url,
      evidence: [{ source: f.jurisdiction, ref: f.citedText.slice(0, 160), confidence: 0.6 }],
      reg: { topic: f.topic, jurisdiction: f.jurisdiction, requirement: f.requirement, certainty: f.certainty, retrievedAt: f.retrievedAt },
    };
  });
}

export function buildReport(spec: RequirementSpec, e: Evaluation, rank: number, regs: Finding[] = [], site: SiteFile | null = null): ShellReport {
  const { shell, graph, fit, work } = e;
  const rules = [...e.rules, ...regulationHits(regs)];
  const buildout = buildoutCheck(spec.useType, graph);
  const exclusive = exclusiveScan(site, spec.useType);
  const pack = packFor(spec);
  const sources: Evidence[] = [
    ...(shell.propertyId ? [{ source: "costar", ref: `property ${shell.propertyId}`, confidence: 0.9 }] : []),
    ...(shell.homesListingId ? [{ source: "costar", ref: `residential listing ${shell.homesListingId}`, confidence: 0.9 }] : []),
    ...(graph ? [{ source: "matterport", ref: `${graph.sid} (${graph.rooms.length} rooms, ${graph.panoCount} panos)`, confidence: 0.85 }] : []),
    ...rules.flatMap((r) => r.evidence),
  ].filter((s, i, a) => a.findIndex((x) => x.ref === s.ref) === i);

  const access = spec.needs.wheelchair && graph ? checkAccess(graph, chairFor(spec.needs)) : null;
  const doors = doorQuestions(rules);
  const raw = [...doors, ...rules
    .filter((r) => !r.rule.startsWith("reg_") && (r.status === "unknown" || (r.status === "warn" && QUESTIONS[r.rule])))
    .map((r) => ({ topic: r.rule.replace(/_/g, " "), question: PARKING_RULES.has(r.rule) ? parkingQuestion(r, QUESTIONS[r.rule]) : QUESTIONS[r.rule] ?? r.detail }))];
  for (const f of regs) if (f.certainty === "applies") raw.push({ topic: `${f.jurisdiction} rule`, question: `Confirm: ${f.requirement}` });
  const counts = roomCounts(spec, fit, graph);
  const short = shortfalls(spec, counts);
  for (const c of counts) if (graph && missingOf(c) > 0) raw.push({ topic: "rooms", question: `The 3D tour shows ${c.have || "no"} ${roomNoun(spec, c, c.have || 2)} and I need ${c.need}. Is there another one the scan missed, or space to add it?` });
  for (const u of fit.unknowns) raw.push({ topic: "room", question: `Can you confirm ${u.split(":")[0].replace(/ #\d+$/, "")} access within or next to the suite?` });
  const musts = mustHaves(spec);
  for (const m of musts) if (!rules.some((r) => r.rule === m.rule)) raw.push({ topic: m.rule.replace(/_/g, " "), question: `Can you confirm the space has ${m.need}?` });
  raw.push(...(e.extraUnknowns ?? []));
  for (const v of e.verdicts) for (const q of v.questions) raw.push({ topic: v.agent, question: q });
  for (const x of e.escalations) if (/unresolved|not observed/i.test(x.outcome)) raw.push({ topic: "scan detail", question: x.question });
  for (const h of pack.hidden) if (!raw.some((u) => u.question.startsWith(h))) raw.push({ topic: "behind the walls", question: `${h}: what's in place today?` });
  // Exclusive-use and unverified build-out questions (Skeptic / buildout check) lead with the proposed-change ones.
  if (exclusive.question) raw.push({ topic: "exclusive use", question: exclusive.question });
  for (const c of exclusive.conflicts.slice(0, 2)) raw.push({ topic: "competitor nearby", question: `${c.name} (${c.what}) is ${c.where}. Does it have an exclusive that would block my use?` });
  for (const b of buildout) if (b.status !== "seen") raw.push({ topic: "unverified build-out", question: b.question });
  // Proposed-change and must-have questions lead (and are never cut from the draft); duplicates go.
  const mustTopics = new Set(musts.map((m) => m.rule.replace(/_/g, " ")));
  const LEAD = new Set(["rooms", "looked closer", "proposed change", "door", "exclusive use", "competitor nearby", "unverified build-out"]);
  const priority = (u: { topic: string }) => (LEAD.has(u.topic) ? 0 : mustTopics.has(u.topic) ? 1 : 2);
  const unknowns = tidyUnknowns(raw.filter((u, i) => raw.findIndex((x) => x.question === u.question) === i).sort((a, b) => priority(a) - priority(b)),
    { fit, floorplan: graph ?? undefined, checks: e.checks }, spec);

  // Rooms the scan labels as the type you asked for (or shows set up for it); a room that could be converted isn't "already built".
  const built = fitShort(fitRows({ fit, floorplan: graph ?? undefined, checks: e.checks }, spec));
  const fails = rules.filter((r) => r.status === "fail");
  const unconfirmed = counts.some((c) => c.unknown || c.convert.length);
  const verdict = short.length ? "Short on rooms" : fit.hardFails.length || fails.length ? "Conditional fit"
    : e.finalScore < 50 ? "Long shot" : unconfirmed ? "Rooms to confirm" : e.finalScore >= 70 ? "Likely fits" : "Workable with changes";
  const tally = countLine(spec, counts);
  // The same sentence the card, the chat and the Overview use (lib/uses/rooms.ts).
  const summary = summaryLine({ fit, floorplan: graph ?? undefined, checks: e.checks, work: work.items, costRange: work.costRange, unknowns, address: shell.address, useTags: shell.useTags }, spec);

  const nm = displayName(shell.name);
  const place = spec.mode === "home" ? `the home at ${shell.address}` : shell.address.startsWith(nm) ? shell.address : `${nm} at ${shell.address}`;
  const contact = shell.listing?.contact?.name?.split(" ")[0];
  const asks = unknowns.slice(0, Math.max(5, unknowns.filter((u) => priority(u) < 2).length)).map((u) => `- ${u.question}`).join("\n");
  const draftMessage = `Hi${contact ? ` ${contact}` : ""},\n\nI'm looking for ${spec.mode === "home" ? "a home" : `space for ${an(spec.useType)}`} in ${spec.city === "houston" ? "Houston" : "Los Angeles"}${spec.sizeSqft ? ` (about ${spec.sizeSqft[0].toLocaleString()}–${spec.sizeSqft[1].toLocaleString()} sq ft)` : ""} and ${place} looks promising${graph && built ? `: in the 3D tour, ${built}` : ""}.${spec.needs.wheelchair ? ` It needs to work for a wheelchair user${spec.needs.chairWidthIn ? ` (the chair is ${spec.needs.chairWidthIn} in wide)` : ""}.` : ""}\n\nCould you help with a few questions?\n${asks || "- Is the space available, and what are the terms?"}\n\nThanks!`;

  return {
    shellId: shell.id,
    rank,
    name: shell.name.includes(" · ") ? `${displayName(shell.name)} · ${shell.name.split(" · ").slice(1).join(" · ")}` : displayName(shell.name),
    address: shell.address,
    verdict,
    summary,
    matchScore: Math.max(0, Math.min(100, e.finalScore)),
    sqft: sqftOf(shell),
    useTags: shell.useTags,
    reasons: [...(graph && tally ? [tally] : []), ...(graph ? short : []), ...e.searchReasons],
    fit,
    rules,
    work: work.items,
    weeksToOpen: openingWeeks({ work: work.items, unknowns, address: shell.address, useTags: shell.useTags }, spec), // the opening plan, the same number every screen shows
    costRange: work.costRange,
    tiAllowance: work.tiAllowance,
    unknowns,
    inside: shell.sid ? { sid: shell.sid, sweepId: evidenceSweep(e) } : undefined,
    above: shell.lat != null && shell.lon != null ? { lat: shell.lat, lon: shell.lon, provider: "Esri World Imagery", overlays: [{ kind: "pin", lat: shell.lat, lon: shell.lon, label: shell.name }] } : undefined,
    floorplan: graph ?? undefined,
    ...(access ? { access } : {}),
    draftMessage,
    badge: graph ? "scan-verified" : "record-only",
    sources,
    listing: shell.listing,
    ...(e.similarity ? { similarity: e.similarity } : {}),
    score: e.similarity ? [...e.lines, { factor: "Match to your drawn layout", earned: e.finalScore - total(e.lines), max: 0, note: `Layout ${e.similarity.score}% similar, blended 50/50 with the evidence score`, source: "match_layout" }] : e.lines,
    crew: e.verdicts, triangulation: triangulate(spec, shell, graph, e.aerial ?? null), defurnished: shell.defurnished,
    buildout, conflicts: exclusive.conflicts,
    ...(e.aerial ? { aerial: e.aerial } : {}),
    ...(e.checks?.length ? { checks: e.checks } : {}),
    alsoFits: graph && spec.mode !== "home" ? alsoFits(shell, graph, spec.useType) : [],
  };
}

type Ask = { topic: string; question: string };
const NOT_LOOKED = /^Is there an? (.+?) in (.+?)\? Hermit didn't get to look at that room's photos\.$/;
// Questions that say the same thing in different words: only the first of each family is asked.
const FAMILIES: [string, RegExp][] = [["zoning", /zoning|deed restriction/i], ["step-free", /step-free/i], ["parking", /\bpark(ing)?\b|\bstalls?\b/i]];
const fixtureWord = (f: string) => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(e?s)?\\b`, "i");

/**
 * Landlord questions without repeats or ones the scan photos already answered:
 * - a fixture seen in every assigned room of that type ("Do the exam rooms have their own sinks?") isn't asked;
 * - rooms Hermit couldn't look at become one question per fixture ("Do exam rooms #1 and #2 have sinks?");
 * - zoning, step-free entry and parking are asked once.
 */
export function tidyUnknowns(raw: Ask[], r: Pick<ShellReport, "fit" | "floorplan"> & Partial<Pick<ShellReport, "checks">>, spec: Pick<RequirementSpec, "rooms">): Ask[] {
  const reqs = (label: string) => r.fit.assignment.filter((a) => a.roomId && a.req.replace(/\s*#\d+$/, "").toLowerCase() === label.toLowerCase());
  const pairs = spec.rooms.flatMap((room) => (room.fixtures ?? []).map((f) => ({ label: room.label.toLowerCase(), f: f.toLowerCase() })));
  const answered = pairs.filter(({ label, f }) => {
    const as = reqs(label);
    return as.length > 0 && as.every((a) => (r.checks ?? []).some((c) => c.roomId === a.roomId && c.result === "seen" && c.feature.toLowerCase() === f));
  });
  const about = (q: string, p: { label: string; f: string }) => q.toLowerCase().includes(p.label) && fixtureWord(p.f).test(q);
  // Rooms not looked at, merged per fixture.
  const unlooked = new Map<string, string[]>();
  for (const u of raw) { const m = u.question.match(NOT_LOOKED); if (m) unlooked.set(m[1].toLowerCase(), [...(unlooked.get(m[1].toLowerCase()) ?? []), m[2]]); }
  const out: Ask[] = [];
  const families = new Set<string>();
  for (const u of raw) {
    const m = u.question.match(NOT_LOOKED);
    let ask = u;
    if (m) {
      const rooms = unlooked.get(m[1].toLowerCase());
      if (!rooms) continue; // already merged into the first one
      unlooked.delete(m[1].toLowerCase());
      const f = m[1].toLowerCase(), many = rooms.length > 1;
      ask = { topic: u.topic, question: `${many ? "Do" : "Does"} ${roomList(rooms)} have ${many ? (/(s|sh|ch|x)$/.test(f) ? `${f}es` : `${f}s`) : an(f)}? Hermit couldn't look closer at ${many ? "those rooms" : "that room"} this time.` };
    }
    if (answered.some((p) => about(ask.question, p))) continue;
    const fam = [...FAMILIES.filter(([, re]) => re.test(ask.question)).map(([k]) => k), ...pairs.filter((p) => about(ask.question, p)).map((p) => `${p.label}|${p.f}`)];
    if (fam.length && fam.every((k) => families.has(k))) continue;
    for (const k of fam) families.add(k);
    if (!out.some((x) => x.question === ask.question)) out.push(ask);
  }
  return out;
}

/** Older recorded reports: clean their questions the same way, and keep the inquiry draft's list in step. */
export function tidyReport<T extends ShellReport>(report: T, spec: Pick<RequirementSpec, "rooms">): T {
  const unknowns = tidyUnknowns(report.unknowns, report, spec);
  const kept = new Set(unknowns.map((u) => u.question));
  const fresh = unknowns.filter((u) => !report.unknowns.some((x) => x.question === u.question)).map((u) => `- ${u.question}`);
  const lines = report.draftMessage.split("\n");
  const asks = lines.map((l, i) => (l.startsWith("- ") ? i : -1)).filter((i) => i >= 0);
  const was = new Set(report.unknowns.map((u) => u.question));
  const draft = asks.length
    ? [...lines.slice(0, asks[0]), ...fresh, ...asks.map((i) => lines[i]).filter((l) => !was.has(l.slice(2)) || kept.has(l.slice(2))), ...lines.slice(asks.at(-1)! + 1)].join("\n")
    : report.draftMessage;
  // The intro's room count, rebuilt from the one room rule (older runs wrote "0 of 2 exam rooms, ... already look built").
  const built = report.floorplan ? fitShort(fitRows(report, spec)) : "";
  return { ...report, unknowns, draftMessage: draft.replace(/(\d) sf\)/g, "$1 sq ft)").replace(/looks promising[^\n]*?\.(?=\s|$)/, `looks promising${built ? `: in the 3D tour, ${built}` : ""}.`) };
}

// Open the tour where Hermit saw a fixture you asked for, else the sweep nearest the first matched room, else the first sweep.
function evidenceSweep(e: Evaluation): string | undefined {
  const g = e.graph;
  if (!g) return undefined;
  const seen = e.checks?.find((c) => c.result === "seen" && c.panoId);
  if (seen) return seen.panoId;
  const first = e.fit.assignment.find((a) => a.roomId);
  return g.rooms.find((r) => r.id === first?.roomId)?.panoId ?? g.panos?.[0]?.id;
}
