import table from "../../rules/screening.json";
import { corridorWidth } from "../geometry/polygon";
import { packFor } from "../uses/packs";
import type { Evidence, RequirementSpec } from "../types";
import type { Evaluation } from "../agent/report";

// Hermit's specialists. Each one reads tool results for a candidate and returns a structured verdict.
// They are deterministic: the planner decides whom to consult, but cannot make one say something the evidence doesn't.
export type AgentId = "scout" | "inspector" | "surveyor" | "code" | "access" | "systems" | "estimator" | "advocate";
export type VerdictStatus = "pass" | "warn" | "veto" | "unknown";
export type Claim = { text: string; evidence: Evidence[] };
export type Verdict = { agent: AgentId; shellId: string; status: VerdictStatus; headline: string; claims: Claim[]; questions: string[] };

export const AGENTS: Record<AgentId, { name: string; role: string; cost: "cheap" | "moderate" | "expensive"; does: string }> = {
  scout: { name: "Scout", role: "broker", cost: "cheap", does: "searches the index and ranks by prior use, size and scan evidence" },
  inspector: { name: "Inspector", role: "walks the Matterport scan", cost: "expensive", does: "measures rooms, maps your layout onto them and reads the scan" },
  surveyor: { name: "Surveyor", role: "reads the site from above", cost: "moderate", does: "checks the aerial for footprint, surface parking and rooftop units" },
  code: { name: "Code", role: "zoning and code screener", cost: "cheap", does: "screens zoning, parking minimums, sprinklers and power against cited rules" },
  access: { name: "Access", role: "accessibility screener", cost: "moderate", does: "measures corridor widths, floors and entry evidence against ADA screening values" },
  systems: { name: "Systems", role: "HVAC and power", cost: "cheap", does: "sizes cooling and power for your use and lists what's hidden behind walls" },
  estimator: { name: "Estimator", role: "contractor", cost: "cheap", does: "prices the work left and the weeks to open" },
  advocate: { name: "Advocate", role: "your negotiator", cost: "cheap", does: "turns unknowns into broker questions and drafts the inquiry" },
};

const ADA_ROUTE_M = 0.915; // 36 in minimum clear width of an accessible route (2010 ADA Standards §403.5.1)
const scanRef = (e: Evaluation, what: string, confidence = 0.75): Evidence => ({ source: "matterport", ref: `${e.graph?.sid ?? e.shell.sid}.${what}`, confidence });
const ruleRef = (key: keyof typeof table.sources, confidence = 0.6): Evidence => ({ source: "rule", ref: table.sources[key].title, confidence });
const statusOf = (worst: VerdictStatus[]): VerdictStatus =>
  worst.includes("veto") ? "veto" : worst.includes("warn") ? "warn" : worst.length && worst.every((w) => w === "unknown") ? "unknown" : "pass";

export function needsAgent(agent: AgentId, spec: RequirementSpec): { needed: boolean; why: string } {
  const pack = packFor(spec);
  switch (agent) {
    case "access": return spec.needs.wheelchair || spec.needs.stepFree
      ? { needed: true, why: "you asked for step-free / wheelchair access" }
      : { needed: false, why: "you didn't ask for step-free access, so corridor measuring is skipped" };
    case "systems": return { needed: pack.hidden.length > 0 || !!spec.needs.heavyPower || !!spec.needs.kitchen, why: `${pack.label.toLowerCase()} spaces hide ${pack.hidden.slice(0, 2).join(" and ").toLowerCase()}` };
    default: return { needed: true, why: AGENTS[agent].does };
  }
}

export function consult(agent: AgentId, spec: RequirementSpec, e: Evaluation): Verdict {
  const v = SPECIALISTS[agent](spec, e);
  return { agent, shellId: e.shell.id, ...v };
}

type Out = Omit<Verdict, "agent" | "shellId">;
const SPECIALISTS: Record<AgentId, (spec: RequirementSpec, e: Evaluation) => Out> = {
  scout(_spec, e) {
    return { status: "pass", headline: e.searchReasons[0] ?? "Matches your search filters", claims: e.searchReasons.map((r) => ({ text: r, evidence: [{ source: "index", ref: `models_index ${e.shell.sid ?? e.shell.id}`, confidence: 0.7 }] })), questions: [] };
  },

  inspector(spec, e) {
    const g = e.graph;
    if (!g) return { status: "unknown", headline: "Record-only: no room scan to walk", claims: [], questions: ["Is there a 3D tour or floor plan of the space?"] };
    const claims: Claim[] = [{ text: `${g.rooms.length} measured rooms, ${Math.round(g.totalAreaSqft).toLocaleString()} sf net floor area`, evidence: [scanRef(e, "rooms[].dimensions.areaFloor", 0.85)] }];
    const matched = e.fit.assignment.filter((a) => a.roomId).length;
    if (e.fit.assignment.length) claims.push({ text: `${matched} of ${e.fit.assignment.length} rooms you need map onto measured rooms`, evidence: [scanRef(e, "room graph (Hungarian assignment)", 0.7)] });
    const advertised = e.shell.sqftSource === "scan name" ? e.shell.sqft : undefined;
    if (advertised && g.totalAreaSqft > 30) {
      const gap = Math.round(((advertised - g.totalAreaSqft) / advertised) * 100);
      if (Math.abs(gap) > 15) claims.push({ text: `Advertised ${advertised.toLocaleString()} sf vs ${Math.round(g.totalAreaSqft).toLocaleString()} sf measured (${Math.abs(gap)}% ${gap > 0 ? "smaller" : "larger"}; net vs gross differences are normal). A discrepancy to ask about.`, evidence: [scanRef(e, "dimensions.areaFloor", 0.8), { source: "index", ref: `scan name "${e.shell.name}"`, confidence: 0.6 }] });
    }
    for (const x of e.escalations) claims.push({ text: `Closer look: ${x.question} → ${x.outcome}`, evidence: [scanRef(e, "objectAnnotations + generatedDescription", 0.5)] });
    const status: VerdictStatus = e.fit.hardFails.length ? "veto" : e.fit.unknowns.length || !matched ? "warn" : "pass";
    const headline = e.fit.hardFails[0] ?? (status === "pass" ? `Walked ${g.rooms.length} rooms: your layout fits with ${e.fit.edits.length} change${e.fit.edits.length === 1 ? "" : "s"}` : `Walked ${g.rooms.length} rooms; ${e.fit.unknowns.length} room${e.fit.unknowns.length === 1 ? "" : "s"} couldn't be identified from scan labels`);
    return { status, headline, claims, questions: e.fit.unknowns.map((u) => `Can you confirm the ${u.split(":")[0].replace(/ #\d+$/, "")} in the space?`) };
  },

  surveyor(_spec, e) {
    const s = e.shell;
    if (s.lat == null || s.lon == null) return { status: "unknown", headline: "No coordinates on record, so no aerial check", claims: [], questions: ["What is the exact street address of the space?"] };
    const claims: Claim[] = [{ text: `Aerial imagery centred on ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`, evidence: [{ source: "aerial", ref: "Esri World Imagery (Vexcel credentials pending)", confidence: 0.6 }] }];
    claims.push({ text: "Surface parking and rooftop units need a stall count from Vexcel imagery; garages can't be counted from the air", evidence: [{ source: "aerial", ref: "not extracted", confidence: 0.3 }] });
    return { status: "unknown", headline: "Site located; parking still uncounted", claims, questions: ["How many parking stalls are assigned to this space, and is any of it garage parking?"] };
  },

  code(_spec, e) {
    const keys = ["zoning", "parking", "onsite_parking", "fire", "electrical", "drive_in_bays", "availability"];
    const hits = e.rules.filter((r) => keys.includes(r.rule));
    const statuses = hits.map((h): VerdictStatus => (h.rule === "zoning" && h.status === "fail" ? "veto" : h.status === "fail" ? "warn" : h.status === "pass" ? "pass" : h.status === "warn" ? "warn" : "unknown"));
    const zoning = hits.find((h) => h.rule === "zoning");
    const status = statusOf(statuses);
    return {
      status,
      headline: status === "veto" ? zoning!.detail : hits.find((h) => h.status === "fail")?.detail ?? (zoning?.detail ?? "No recorded code conflicts"),
      claims: hits.map((h) => ({ text: `${h.rule.replace(/_/g, " ")}: ${h.detail}`, evidence: [...h.evidence, { source: "rule", ref: h.citation, confidence: 0.6 }] })),
      questions: hits.filter((h) => h.status === "unknown").map((h) => h.detail.replace(/\.$/, "") + " — can you confirm?"),
    };
  },

  access(spec, e) {
    const g = e.graph;
    const claims: Claim[] = [];
    const statuses: VerdictStatus[] = [];
    const questions: string[] = ["Is the entry step-free, and is there an accessible restroom (60 in turning space) in the suite?"];
    if (!g) return { status: "unknown", headline: "No scan to measure; accessibility unverified", claims, questions };
    const floors = g.floorCount || e.shell.floorCount || 1;
    const desc = g.description ?? "";
    if (floors > 1) {
      const elevator = /elevator|lift/i.test(desc) || e.shell.elevator === true;
      statuses.push(elevator ? "warn" : "veto");
      claims.push({ text: `Scan spans ${floors} floors; ${elevator ? "an elevator is mentioned" : "no elevator recorded or seen in the scan description"}`, evidence: [scanRef(e, "floors"), ...(elevator ? [scanRef(e, "generatedDescription", 0.4)] : []), ruleRef("ada")] });
    }
    const halls = g.rooms.filter((r) => r.label === "hallway" && r.areaSqft > 25).map((r) => ({ r, w: corridorWidth(r.polygon) })).filter((h) => h.w != null && h.w > 0.3) as { r: (typeof g.rooms)[number]; w: number }[];
    if (halls.length) {
      const widest = Math.max(...halls.map((h) => h.w));
      const narrow = halls.filter((h) => h.w < ADA_ROUTE_M);
      const inches = (m: number) => Math.round(m * 39.37);
      if (widest < ADA_ROUTE_M) {
        statuses.push("veto");
        claims.push({ text: `Main corridor measures about ${inches(widest)} in clear; accessible routes need 36 in`, evidence: [scanRef(e, "hallway polygons (2·area/perimeter)", 0.6), ruleRef("ada")] });
      } else {
        statuses.push(narrow.length ? "warn" : "pass");
        claims.push({ text: `Main corridor about ${inches(widest)} in wide${narrow.length ? `; ${narrow.length} narrower segment${narrow.length > 1 ? "s" : ""} (~${inches(Math.min(...narrow.map((n) => n.w)))} in) to check` : ", above the 36 in route minimum"}`, evidence: [scanRef(e, "hallway polygons (2·area/perimeter)", 0.6), ruleRef("ada")] });
      }
    } else claims.push({ text: "No hallway geometry in the scan to measure", evidence: [scanRef(e, "rooms", 0.5)] });
    if (/\b(stairs|steps|step up|stairway)\b/i.test(desc)) {
      statuses.push("warn");
      claims.push({ text: "The scan description mentions stairs or steps", evidence: [scanRef(e, "generatedDescription", 0.4)] });
    }
    const accRule = e.rules.find((r) => r.rule === "accessibility");
    if (accRule?.status === "fail") statuses.push("veto");
    claims.push({ text: "Altering the space triggers path-of-travel upgrades (up to 20% of the alteration cost under the ADA)", evidence: [ruleRef("ada", 0.7)] });
    const status = statusOf(statuses.length ? statuses : ["unknown"]);
    const veto = claims.find((c) => /floors; no elevator|36 in$/.test(c.text));
    return { status, headline: status === "veto" ? veto?.text ?? "Accessible route not available" : claims[0]?.text ?? "Accessibility unverified", claims, questions };
  },

  systems(spec, e) {
    const pack = packFor(spec);
    const hits = e.rules.filter((r) => ["hvac", "electrical"].includes(r.rule));
    return {
      status: hits.some((h) => h.status === "fail") ? "warn" : "unknown",
      headline: hits.find((h) => h.rule === "hvac")?.detail ?? "Installed capacity is not recorded",
      claims: [
        ...hits.map((h) => ({ text: h.detail, evidence: [...h.evidence, { source: "rule", ref: h.citation, confidence: 0.5 }] })),
        { text: `Scans show fixtures, never infrastructure: ${pack.hidden.join("; ")}`, evidence: [{ source: "rule", ref: "Hermit screening rule: concealed systems are always unknown", confidence: 1 }] },
      ],
      questions: pack.hidden.map((h) => `${h}: what's in place today?`),
    };
  },

  estimator(_spec, e) {
    const w = e.work;
    const n = w.items.length;
    return {
      status: n ? "warn" : "pass",
      headline: n ? `${n} work item${n > 1 ? "s" : ""}, about ${w.weeksToOpen[0]}–${w.weeksToOpen[1]} weeks to open` : `No build-out found; ${w.weeksToOpen[0]}–${w.weeksToOpen[1]} weeks for permits and move-in`,
      claims: w.items.map((i) => ({ text: `${i.item}: ${i.weeksLow}–${i.weeksHigh} wk, $${Math.round(i.low / 1000)}k–$${Math.round(i.high / 1000)}k`, evidence: [{ source: "rule", ref: table.sources.costs.title, confidence: 0.4 }] })),
      questions: [],
    };
  },

  advocate(_spec, e) {
    return { status: "pass", headline: "Drafted an inquiry with your open questions", claims: [], questions: [] };
  },
};

export const SPECIALIST_ORDER: AgentId[] = ["inspector", "code", "access", "systems", "surveyor", "estimator"];
