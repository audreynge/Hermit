import { z } from "zod";
import { searchShells, type Candidate } from "../query/shells";
import { fit as fitRooms } from "../reason/fit";
import { IMPLIED_FIXTURES } from "../reason/labels";
import { checkRules } from "../reason/rules";
import { estimateWork } from "../reason/work";
import type { ParcelZone } from "../regs/zoning";
import type { Finding, RegQuery } from "../regs/research";
import type { Evidence, RequirementSpec, RoomGraph, Shell, ShellReport, TraceEvent } from "../types";
import { buildReport, finalScore, type Evaluation } from "./report";

export type AgentDeps = {
  shells: (spec: RequirementSpec) => Shell[];
  graph: (sid: string) => RoomGraph | null;
  zoning?: (lat: number, lon: number) => Promise<ParcelZone | null>;
  research?: (q: RegQuery) => Promise<{ findings: Finding[]; fromCache: boolean }>;
};
export const BUDGET = { toolCalls: 25, roomGraphs: 8, inspections: 4, ms: 40_000 };

let seq = 0;
const rid = (p: string) => `${p}_${(++seq).toString(36)}`;

export const ToolInputs = {
  search_shells: z.object({}),
  screen_sites: z.object({ shellIds: z.array(z.string()).max(20) }),
  evaluate_candidates: z.object({ shellIds: z.array(z.string()).max(8) }),
  inspect_view: z.object({ shellId: z.string(), question: z.string() }),
  drop_candidate: z.object({ drops: z.array(z.object({ shellId: z.string(), reason: z.string() })).min(1).max(20) }),
  submit_reports: z.object({ shellIds: z.array(z.string()).max(5) }),
  research_regulations: z.object({}),
};
export type ToolName = keyof typeof ToolInputs;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  search_shells: "Retrieve the top 50 candidate spaces for the user's RequirementSpec from the local index (city, mode, size, prior use, scan evidence). Call first.",
  screen_sites: "Cheap record-only screen of up to 20 candidates: zoning, parking, power, sprinklers, bays, availability. Returns per-candidate pass/fail/unknown flags.",
  evaluate_candidates: "Composite evaluation of up to 8 candidates: loads the Matterport room graph, runs room assignment (Hungarian), rule checks and work/cost estimates. At most 8 room graphs per run.",
  inspect_view: "Check cached scan metadata (room tags, Matterport object annotations) for one candidate to answer a narrow question such as whether a sink exists. At most 4 per run.",
  drop_candidate: "Remove one or more candidates from consideration, each with the evidence-based reason that rules it out. Batch all drops from one review into a single call.",
  submit_reports: "Finish: produce Shell Reports for up to 5 evaluated candidates in your chosen rank order.",
  research_regulations: "Look up the city, county, state and federal rules (zoning, business and professional licenses, occupancy, health, parking, accessibility, fire, signage) that apply to this use in this city, from official sources only. Call once per search; results are attached to every report.",
};

export class Run {
  calls = 0;
  graphReads = 0;
  inspections = 0;
  started = Date.now();
  candidates: Candidate[] = [];
  screened = new Map<string, { shell: Shell; flags: ReturnType<typeof checkRules> }>();
  evaluated = new Map<string, Evaluation>();
  dropped = new Set<string>();
  reports: ShellReport[] | null = null;
  regulations: Finding[] = [];
  get canResearch() { return !!this.deps.research; }

  constructor(public spec: RequirementSpec, public emit: (e: TraceEvent) => void, private deps: AgentDeps) {}

  overBudget() {
    return this.calls >= BUDGET.toolCalls || Date.now() - this.started > BUDGET.ms;
  }

  async call(name: ToolName, rawArgs: unknown): Promise<unknown> {
    const args = ToolInputs[name].parse(rawArgs ?? {});
    if (name !== "submit_reports" && this.overBudget())
      throw new Error(`tool budget exhausted (${BUDGET.toolCalls} calls or ${BUDGET.ms / 1000}s); call submit_reports with evaluated ids now`);
    this.calls++;
    const t0 = Date.now();
    const resultId = rid(name);
    const { result, summary } = await this.exec(name, args as never);
    this.emit({ type: "tool", id: rid("ev"), tool: name, args, resultId, summary, ms: Date.now() - t0 });
    return { resultId, ...result };
  }

  private async exec(name: ToolName, args: Record<string, never>): Promise<{ result: object; summary: string }> {
    switch (name) {
      case "search_shells": return this.search();
      case "screen_sites": return this.screen(args.shellIds);
      case "evaluate_candidates": return this.evaluate(args.shellIds);
      case "inspect_view": return this.inspect(args.shellId, args.question);
      case "drop_candidate": return this.drop(args.drops);
      case "submit_reports": return this.submit(args.shellIds);
      case "research_regulations": return this.research();
    }
  }

  private search() {
    const out = searchShells(this.spec, this.deps.shells(this.spec));
    this.candidates = out.results;
    return {
      result: { considered: out.considered, rejected: out.rejected, top: out.results.slice(0, 20).map((c) => ({ id: c.shell.id, score: c.score, reasons: c.reasons.slice(0, 3), scan: !!c.shell.sid })) },
      summary: `${out.considered} indexed → ${out.rejected} rejected by hard filters → top ${out.results.length} kept`,
    };
  }

  private shell(id: string) {
    return this.candidates.find((c) => c.shell.id === id);
  }

  private async research() {
    if (!this.deps.research) return { result: { findings: [] }, summary: "no regulation source configured" };
    const { findings, fromCache } = await this.deps.research({ city: this.spec.city, useType: this.spec.useType });
    this.regulations = findings;
    const by = (j: Finding["jurisdiction"]) => findings.filter((f) => f.jurisdiction === j).length;
    const parts = (["city", "county", "state", "federal"] as const).filter((j) => by(j)).map((j) => `${j} ${by(j)}`);
    return {
      result: { findings: findings.map((f) => ({ topic: f.topic, jurisdiction: f.jurisdiction, requirement: f.requirement, certainty: f.certainty })) },
      summary: `${findings.length} rules (${parts.join(", ") || "none"})${fromCache ? " from cache" : ""}`,
    };
  }

  private screen(ids: string[]) {
    const rows = ids.flatMap((id) => {
      const c = this.shell(id);
      if (!c || this.dropped.has(id)) return [];
      const flags = checkRules(this.spec, c.shell);
      this.screened.set(id, { shell: c.shell, flags });
      return [{ id, fails: flags.filter((f) => f.status === "fail").map((f) => `${f.rule}: ${f.detail}`), unknown: flags.filter((f) => f.status === "unknown").map((f) => f.rule) }];
    });
    const failing = rows.filter((r) => r.fails.length).length;
    return { result: { rows }, summary: `screened ${rows.length} site records; ${failing} with a recorded hard conflict` };
  }

  private async evaluate(ids: string[]) {
    const zones = new Map<string, ParcelZone | null>();
    if (this.deps.zoning) await Promise.all(ids.map(async (id) => {
      const s = this.shell(id)?.shell;
      if (s?.city === "los_angeles" && s.lat != null && s.lon != null) zones.set(id, await this.deps.zoning!(s.lat, s.lon).catch(() => null));
    }));
    return this.evaluateWith(ids, zones);
  }

  private evaluateWith(ids: string[], zones: Map<string, ParcelZone | null>) {
    const rows = ids.flatMap((id) => {
      const c = this.shell(id);
      if (!c || this.dropped.has(id)) return [];
      if (this.evaluated.has(id)) return [this.row(this.evaluated.get(id)!)];
      let graph: RoomGraph | null = null;
      if (c.shell.sid && this.graphReads < BUDGET.roomGraphs) {
        this.graphReads++;
        graph = this.deps.graph(c.shell.sid);
      }
      const fit = graph ? fitRooms(this.spec, graph) : { score: 0, assignment: [], edits: [], breakdown: {}, hardFails: [], unknowns: [] };
      const rules = checkRules(this.spec, c.shell, graph ?? undefined, { parcelZone: zones.get(id) ?? null });
      const work = estimateWork(this.spec, c.shell, fit, rules);
      const e: Evaluation = { shell: c.shell, searchScore: c.score, searchReasons: c.reasons, graph, fit, rules, work, finalScore: finalScore(fit, rules, c.score, !!graph), escalations: [] };
      this.evaluated.set(id, e);
      return [this.row(e)];
    });
    return { result: { rows }, summary: `evaluated ${rows.length} (room graphs read: ${this.graphReads}/${BUDGET.roomGraphs})` };
  }

  evaluateQuietly(ids: string[]) {
    return this.evaluate(ids);
  }

  private row(e: Evaluation) {
    return {
      id: e.shell.id, score: e.finalScore, fit: e.graph ? e.fit.score : null, scan: !!e.graph,
      hardFails: e.fit.hardFails, roomUnknowns: e.fit.unknowns, ruleFails: e.rules.filter((r) => r.status === "fail").map((r) => r.rule),
      unknowns: e.rules.filter((r) => r.status === "unknown").map((r) => r.rule),
      unverifiedFixtures: unverifiedFixtures(this.spec, e),
      cost: e.work.costRange, weeks: e.work.weeksToOpen,
    };
  }

  private inspect(id: string, question: string) {
    const e = this.evaluated.get(id);
    if (this.inspections >= BUDGET.inspections) return { result: { error: "inspection budget exhausted" }, summary: "skipped: inspection budget exhausted" };
    this.inspections++;
    let outcome: string;
    if (!e?.graph) outcome = "unresolved: no cached scan for this candidate";
    else {
      const words = new Set((question.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => w.replace(/s$/, "")));
      const fixtures = FIXTURE_WORDS.filter((f) => words.has(f));
      const roomTypes = ROOM_WORDS.filter((r) => words.has(r));
      const objs = e.graph.objects.filter((o) => fixtures.includes(o.label.replace(/s$/, "")));
      const rooms = e.graph.rooms.filter((r) => roomTypes.includes(r.label));
      outcome = !fixtures.length && !roomTypes.length ? "unresolved: question names no fixture or room type Hermit can look up"
        : objs.length
        ? `observed: ${objs.map((o) => `${o.label} in room ${o.roomId ?? "?"} (conf ${o.confidence.toFixed(2)})`).join("; ")}`
        : rooms.length ? `observed: room tags ${rooms.map((r) => r.rawTags.join("/")).join("; ")}`
        : `not observed in ${e.graph.objects.length} object annotations / ${e.graph.rooms.length} room tags; treat as unknown`;
    }
    e?.escalations.push({ question, outcome });
    this.emit({ type: "escalate", id: rid("ev"), shellId: id, question, outcome });
    return { result: { outcome }, summary: outcome };
  }

  private drop(drops: { shellId: string; reason: string }[]) {
    const unknown = drops.filter((d) => !this.shell(d.shellId)).map((d) => d.shellId);
    if (unknown.length === drops.length) throw new Error(`not candidates from search_shells: ${unknown.join(", ")}`);
    drops = drops.filter((d) => this.shell(d.shellId));
    for (const d of drops) this.dropOne(d.shellId, d.reason);
    return { result: { dropped: drops.map((d) => d.shellId) }, summary: `dropped ${drops.length}: ${drops.map((d) => d.shellId).join(", ")}` };
  }

  private dropOne(id: string, reason: string) {
    const e = this.evaluated.get(id);
    const s = this.screened.get(id);
    const evidence: Evidence[] = [
      ...(e?.rules ?? s?.flags ?? []).filter((r) => r.status === "fail").flatMap((r) => r.evidence),
      ...(e?.fit.hardFails.length && e.graph ? [{ source: "matterport", ref: `${e.graph.sid} room graph`, confidence: 0.8 }] : []),
    ];
    this.dropped.add(id);
    this.emit({ type: "drop", id: rid("ev"), shellId: id, reason, evidence });
  }

  private submit(ids: string[]) {
    const chosen = ids.filter((id) => this.evaluated.has(id) && !this.dropped.has(id)).slice(0, 5);
    if (ids.length && !chosen.length) throw new Error(`none of ${ids.join(", ")} were evaluated (or all were dropped); call evaluate_candidates first`);
    this.reports = chosen.map((id, i) => buildReport(this.spec, this.evaluated.get(id)!, i + 1, this.regulations));
    return { result: { reports: this.reports.length }, summary: `${this.reports.length} Shell Reports` };
  }
}

// Last step when the budget is spent: evaluate any unevaluated picks inside the single submit call.
export async function finalize(run: Run, ids: string[]) {
  const missing = ids.filter((id) => !run.evaluated.has(id));
  if (missing.length) await run.evaluateQuietly(missing);
  return run.call("submit_reports", { shellIds: ids.filter((id) => run.evaluated.has(id)) });
}

const FIXTURE_WORDS = ["sink", "toilet", "shower", "bathtub", "tub", "hood", "drain", "range", "stove", "oven", "refrigerator", "dishwasher", "washer", "dryer"];
const ROOM_WORDS = ["bathroom", "kitchen", "office", "bedroom", "reception", "conference", "storage", "utility", "garage"];

export function unverifiedFixtures(spec: RequirementSpec, e: Evaluation): string[] {
  if (!e.graph) return [];
  const out = new Set<string>();
  for (const a of e.fit.assignment) {
    if (!a.roomId) continue;
    const req = spec.rooms.find((r) => a.req === r.label || a.req.startsWith(`${r.label} #`));
    const room = e.graph.rooms.find((r) => r.id === a.roomId)!;
    const have = new Set([...(IMPLIED_FIXTURES[room.label] ?? []), ...e.graph.objects.filter((o) => o.roomId === room.id).map((o) => o.label)]);
    for (const f of req?.fixtures ?? []) if (!have.has(f)) out.add(f);
  }
  return [...out];
}

export const newEventId = () => rid("ev");
