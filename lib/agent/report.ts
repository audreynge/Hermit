import type { Evidence, FitResult, RequirementSpec, RoomGraph, RuleHit, Shell, ShellReport, WorkItem } from "../types";

export type Evaluation = {
  shell: Shell;
  searchScore: number;
  searchReasons: string[];
  graph: RoomGraph | null;
  fit: FitResult;
  rules: RuleHit[];
  work: { items: WorkItem[]; weeksToOpen: [number, number]; costRange: [number, number]; tiAllowance?: number };
  finalScore: number;
  escalations: { question: string; outcome: string }[];
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
  zoning_records: "Which zone is the parcel in today, and does it permit our use by right?",
};

export const displayName = (name: string) =>
  name.split(" · ")[0].replace(/\s*[-–]\s*[\d,]+\s*(?:SF|sq\.?\s*ft)\s*$/i, "").trim();

export function finalScore(fit: FitResult, rules: RuleHit[], searchScore: number, hasGraph: boolean): number {
  const penalty = rules.reduce((s, r) => s + (r.status === "fail" ? 25 : r.status === "warn" ? 4 : r.status === "unknown" ? 1 : 0), 0);
  const base = hasGraph ? fit.score * 0.65 + searchScore * 0.35 : 45 + searchScore * 0.2;
  return Math.max(0, Math.round(base - penalty));
}

export function buildReport(spec: RequirementSpec, e: Evaluation, rank: number): ShellReport {
  const { shell, graph, fit, rules, work } = e;
  const sources: Evidence[] = [
    ...(shell.propertyId ? [{ source: "costar", ref: `property ${shell.propertyId}`, confidence: 0.9 }] : []),
    ...(shell.homesListingId ? [{ source: "costar", ref: `residential listing ${shell.homesListingId}`, confidence: 0.9 }] : []),
    ...(shell.listing && !shell.homesListingId ? [{ source: "costar", ref: `listing ${shell.listing.listingId}`, confidence: 0.8 }] : []),
    ...(graph ? [{ source: "matterport", ref: `${graph.sid} (${graph.rooms.length} rooms, ${graph.panoCount} panos)`, confidence: 0.85 }] : []),
    ...rules.flatMap((r) => r.evidence),
  ].filter((s, i, a) => a.findIndex((x) => x.ref === s.ref) === i);

  const unknowns = rules
    .filter((r) => r.status === "unknown" || (r.status === "warn" && QUESTIONS[r.rule]))
    .map((r) => ({ topic: r.rule.replace(/_/g, " "), question: QUESTIONS[r.rule] ?? r.detail }));
  for (const u of fit.unknowns) unknowns.push({ topic: "room", question: `Can you confirm ${u.split(":")[0].replace(/ #\d+$/, "")} access within or next to the suite?` });
  for (const x of e.escalations) if (/unresolved|not observed/i.test(x.outcome)) unknowns.push({ topic: "scan detail", question: x.question });

  const matched = fit.assignment.filter((a) => a.roomId).length;
  const fails = rules.filter((r) => r.status === "fail");
  const verdict = fit.hardFails.length || fails.length ? "Conditional fit"
    : e.finalScore >= 70 ? "Strong fit" : e.finalScore >= 50 ? "Workable with changes" : "Long shot";
  const cost = work.costRange[1] ? `$${Math.round(work.costRange[0] / 1000)}k–$${Math.round(work.costRange[1] / 1000)}k of known work` : "no build-out identified so far";
  const area = graph ? `${Math.round(graph.totalAreaSqft).toLocaleString()} sf scanned` : "";
  const rooms = fit.assignment.length ? `${matched}/${fit.assignment.length} requested rooms map onto measured rooms (${area}).` : `${area}.`;
  const unclear = fit.unknowns.length ? ` ${fit.unknowns.length} required room(s) could not be identified in the scan.` : "";
  const summary = graph
    ? `${rooms}${unclear} Expect ${cost}, ${work.weeksToOpen[0]}–${work.weeksToOpen[1]} weeks to open.`
    : `Record-only: no room scan, so room fit is not verified. Expect ${cost} once measured.`;

  const contact = shell.listing?.contact?.name?.split(" ")[0];
  const asks = unknowns.slice(0, 4).map((u) => `- ${u.question}`).join("\n");
  const draftMessage = `Hi${contact ? ` ${contact}` : ""},\n\nI'm looking for space for a ${spec.useType} in ${spec.city === "houston" ? "Houston" : "Los Angeles"}${spec.sizeSqft ? ` (about ${spec.sizeSqft[0].toLocaleString()}–${spec.sizeSqft[1].toLocaleString()} sf)` : ""} and ${displayName(shell.name)} at ${shell.address} looks promising.\n\nCould you help with a few questions?\n${asks || "- Is the space available, and what are the terms?"}\n\nThanks!`;

  return {
    shellId: shell.id,
    rank,
    name: shell.name.includes(" · ") ? `${displayName(shell.name)} · ${shell.name.split(" · ").slice(1).join(" · ")}` : displayName(shell.name),
    address: shell.address,
    verdict,
    summary,
    matchScore: Math.max(0, Math.min(100, e.finalScore)),
    sqft: shell.sqft,
    useTags: shell.useTags,
    reasons: e.searchReasons.slice(0, 3),
    fit,
    rules,
    work: work.items,
    weeksToOpen: work.weeksToOpen,
    costRange: work.costRange,
    tiAllowance: work.tiAllowance,
    unknowns,
    inside: shell.sid ? { sid: shell.sid } : undefined,
    above: shell.lat != null && shell.lon != null ? { lat: shell.lat, lon: shell.lon, provider: "Esri World Imagery", overlays: [{ kind: "pin", lat: shell.lat, lon: shell.lon, label: shell.name }] } : undefined,
    floorplan: graph ?? undefined,
    draftMessage,
    badge: graph ? "scan-verified" : "record-only",
    sources,
    listing: shell.listing,
  };
}
