import { countLine, needLine, roomCounts, shortfalls } from "../reason/fit";
import type { RequirementSpec, ShellReport, Verification } from "../types";

// Each must-have the user selected, with the rule that screens it. A recorded "fail" on one rules the candidate out; null stays unknown.
export function mustHaves(spec: RequirementSpec): { need: string; rule: string }[] {
  const n = spec.needs;
  return [
    ...(n.heavyPower || n.threePhase ? [{ need: n.threePhase ? "three-phase power" : "heavy power", rule: "electrical" }] : []),
    ...(n.esfr ? [{ need: "ESFR sprinklers", rule: "fire" }] : []),
    ...(n.driveInBays ? [{ need: `${n.driveInBays} drive-in bay(s)`, rule: "drive_in_bays" }] : []),
    ...(n.parking || n.parkingStalls ? [{ need: n.parkingStalls ? `${n.parkingStalls} parking stalls` : "on-site parking", rule: "onsite_parking" }] : []),
    ...(n.groundFloor ? [{ need: "ground floor", rule: "ground_floor" }] : []),
    ...(n.wheelchair || n.stepFree ? [{ need: n.wheelchair ? "wheelchair access" : "step-free access", rule: "accessibility" }] : []),
    ...(spec.beds != null ? [{ need: `${spec.beds} bedrooms`, rule: "bedrooms" }] : []),
    ...(spec.baths != null ? [{ need: `${spec.baths} baths`, rule: "bathrooms" }] : []),
  ];
}

/** Deterministic audit of one report: every must-have re-checked, every pass/fail claim needs a source. Never upgrades unknowns. */
export function checkReport(spec: RequirementSpec, r: ShellReport): Verification {
  const violations: string[] = [];
  const issues: string[] = [];
  for (const m of mustHaves(spec)) {
    const hit = r.rules.find((x) => x.rule === m.rule);
    if (hit?.status === "fail") violations.push(`fails must-have ${m.need}: ${hit.detail}`);
    else if ((!hit || hit.status === "unknown") && !r.unknowns.some((u) => u.topic === m.rule.replace(/_/g, " "))) issues.push(`${m.need} is unverified and has no landlord question`);
  }
  for (const f of r.fit.hardFails) violations.push(f);
  if (r.floorplan) violations.push(...shortfalls(spec, roomCounts(spec, r.fit, true)));
  for (const h of r.rules) if ((h.status === "pass" || h.status === "fail") && !h.evidence.length) issues.push(`${h.rule} ${h.status} has no cited record`);
  for (const w of r.work) if (!w.source) issues.push(`work item "${w.item}" has no source`);
  if (r.badge === "scan-verified" && !r.floorplan) issues.push("labelled scan-verified without a room graph");
  if (!r.sources.length) issues.push("no sources");
  return { status: violations.length ? "demoted" : issues.length ? "flagged" : "verified", issues: [...violations, ...issues], by: ["rules"] };
}

export const AUDIT_PROMPT = `You are an independent auditor checking a property-search assistant's reports. You did not write them.
For each report, check: does any must-have the user selected have a recorded "fail"? Is anything stated as passing, verified, compliant or available without a cited source or with status unknown? Does the summary or verdict claim more than the rules and evidence show? Do its room counts match roomCounts exactly, and does it call any unconfirmed room present?
Statuses: pass = recorded evidence meets it; fail = recorded evidence contradicts it; warn = partly supported with open questions; unknown = not on record. Warn and unknown are acceptable when the report lists a landlord question for them; do not ask for them to become fail.
Flag only real problems: an unknown or warn presented as a pass or as verified in the verdict/summary, a must-have fail, a pass with no evidence, or a claim the evidence does not support. Be specific; set ok true with no issues if a report is sound.
Return JSON only: {"reports":[{"shellId":string,"ok":boolean,"issues":[string]}]}.`;

export const AUDIT_SCHEMA = {
  type: "object", required: ["reports"],
  properties: { reports: { type: "array", items: { type: "object", required: ["shellId", "ok", "issues"], properties: { shellId: { type: "string" }, ok: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } } } } },
};

export type AuditResult = { reports: { shellId: string; ok: boolean; issues: string[] }[] };
export type Auditor = { name: string; audit: (prompt: string) => Promise<AuditResult> };

/** What the auditor sees: the must-haves and each report's claims with their evidence, nothing truncated. */
export const auditInput = (spec: RequirementSpec, reports: ShellReport[]) => JSON.stringify({
  mustHaves: mustHaves(spec).map((m) => m.need),
  requiredRooms: spec.rooms.filter((r) => r.hard).map((r) => r.label),
  requiredRoomCounts: needLine(spec, roomCounts(spec, { score: 0, assignment: [], edits: [], breakdown: {}, hardFails: [], unknowns: [] }, false)),
  reports: reports.map((r) => ({
    shellId: r.shellId, verdict: r.verdict, summary: r.summary, badge: r.badge, hardFails: r.fit.hardFails,
    roomCounts: r.floorplan ? countLine(spec, roomCounts(spec, r.fit, true)) : "no scan: unconfirmed", shortRooms: r.floorplan ? shortfalls(spec, roomCounts(spec, r.fit, true)) : [],
    rules: r.rules.filter((h) => !h.rule.startsWith("reg_")).map((h) => ({ rule: h.rule, status: h.status, detail: h.detail, evidence: h.evidence.map((e) => `${e.source}: ${e.ref}`) })),
    unknowns: r.unknowns.map((u) => u.question),
  })),
});
