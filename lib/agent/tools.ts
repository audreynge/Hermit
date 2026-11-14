import { z } from "zod";
import { AGENTS, consult, needsAgent, type AgentId, type Verdict } from "../crew";
import { searchShells, type Candidate } from "../query/shells";
import { fit as fitRooms } from "../reason/fit";
import { IMPLIED_FIXTURES } from "../reason/labels";
import { checkRules } from "../reason/rules";
import { estimateWork } from "../reason/work";
import type { ParcelZone } from "../regs/zoning";
import { screeningFindings, type Finding, type RegQuery } from "../regs/research";
import { similarScans } from "../similarity/layout";
import { seedRooms } from "../uses/packs";
import type { Evidence, RequirementSpec, RoomGraph, RuleHit, Shell, ShellReport, Similarity, TraceEvent } from "../types";
import { buildReport, displayName, scoreLines, total, type Evaluation } from "./report";
import { auditInput, checkReport, mustHaves, type Auditor } from "./verify";

export type AgentDeps = {
  shells: (spec: RequirementSpec) => Shell[];
  graph: (sid: string) => RoomGraph | null;
  zoning?: (lat: number, lon: number) => Promise<ParcelZone | null>;
  research?: (q: RegQuery) => Promise<{ findings: Finding[]; fromCache: boolean }>;
};
export const BUDGET = { toolCalls: 25, roomGraphs: 8, inspections: 4, ms: 40_000, researchMs: 20_000, auditMs: 12_000 };

let seq = 0;
const rid = (p: string) => `${p}_${(++seq).toString(36)}`;

const CONSULTABLE = ["code", "access", "systems", "surveyor"] as const;
export const ToolInputs = {
  search_shells: z.object({}),
  match_layout: z.object({}),
  screen_sites: z.object({ shellIds: z.array(z.string()).max(20) }),
  evaluate_candidates: z.object({ shellIds: z.array(z.string()).max(8) }),
  consult_specialist: z.object({ agent: z.enum(CONSULTABLE), shellIds: z.array(z.string()).min(1).max(8), why: z.string().optional() }),
  inspect_view: z.object({ shellId: z.string(), question: z.string() }),
  drop_candidate: z.object({ drops: z.array(z.object({ shellId: z.string(), reason: z.string() })).min(1).max(20) }),
  submit_reports: z.object({ shellIds: z.array(z.string()).max(5) }),
  research_regulations: z.object({}),
};
export type ToolName = keyof typeof ToolInputs;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  search_shells: "Retrieve every candidate space that passes the RequirementSpec's hard filters from the local index, ranked (city, mode, size, prior use, scan evidence). Call first. (Scout.)",
  match_layout: "Only when the spec has a drawn layout: compare it (room program, adjacency, total size, footprint shape) against every scanned candidate in the city and re-rank the candidate list by layout similarity. Call right after search_shells.",
  screen_sites: "Cheap record-only screen of up to 20 candidates: zoning, parking, power, sprinklers, bays, availability. Returns per-candidate pass/fail/unknown flags. A candidate whose record fails a user must-have is dropped automatically (dropped: true).",
  evaluate_candidates: "Composite evaluation of up to 8 candidates: loads the Matterport room graph, runs room assignment (Hungarian), rule checks, the Inspector's verdict and work/cost estimates. At most 8 room graphs per run. Must-have failures and missing required rooms are dropped automatically (dropped: true).",
  consult_specialist: "Hand evaluated candidates to one specialist: code (zoning/parking/fire/power), access (corridor widths, floors, stairs; only useful if the user needs step-free access), systems (HVAC/power, hidden infrastructure), surveyor (aerial site check). A specialist veto removes the candidate.",
  inspect_view: "Check cached scan metadata (room tags, Matterport object annotations) for one candidate to answer a narrow question such as whether a sink exists. At most 4 per run.",
  drop_candidate: "Remove one or more candidates from consideration, each with the evidence-based reason that rules it out. Batch all drops from one review into a single call.",
  submit_reports: "Finish: produce Shell Reports for up to 5 evaluated, non-vetoed candidates in your chosen rank order. An independent verifier then re-checks every report against the must-haves and sources.",
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
  similarity = new Map<string, Similarity>();
  reports: ShellReport[] | null = null;
  audit: Auditor | null = null; // independent LLM verifier, set by the planner when a provider is available
  regulations: Finding[] = [];
  researched = false;
  private researchJob: Promise<{ findings: Finding[]; fromCache: boolean; timedOut?: boolean }> | null = null;
  get canResearch() { return !!this.deps.research; }
  consulted = new Set<AgentId>();
  vetoes = new Map<string, Verdict>();
  spec: RequirementSpec;

  constructor(public userSpec: RequirementSpec, public emit: (e: TraceEvent) => void, private deps: AgentDeps) {
    // Rooms the user never described come from the use pack, so a missing sink or restroom counts as work.
    this.spec = { ...userSpec, rooms: seedRooms(userSpec) };
  }

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
    if (name === "submit_reports") await this.verify();
    return { resultId, ...result };
  }

  private async exec(name: ToolName, args: Record<string, never>): Promise<{ result: object; summary: string }> {
    switch (name) {
      case "search_shells": return this.search();
      case "match_layout": return this.matchLayout();
      case "screen_sites": return this.screen(args.shellIds);
      case "evaluate_candidates": return this.evaluate(args.shellIds);
      case "consult_specialist": return this.consultMany(args.agent, args.shellIds, args.why);
      case "inspect_view": return this.inspect(args.shellId, args.question);
      case "drop_candidate": return this.drop(args.drops);
      case "submit_reports": return this.submit(args.shellIds);
      case "research_regulations": return this.research();
    }
  }

  // Research runs in the background from the first search so it never sits on the critical path.
  private startResearch() {
    if (this.researchJob || !this.deps.research) return;
    const q = { city: this.spec.city, useType: this.spec.useType };
    const timeout = new Promise<{ findings: Finding[]; fromCache: boolean; timedOut: boolean }>((res) =>
      setTimeout(() => res({ findings: screeningFindings(q), fromCache: false, timedOut: true }), BUDGET.researchMs));
    this.researchJob = Promise.race([this.deps.research(q).catch(() => ({ findings: screeningFindings(q), fromCache: false })), timeout]);
  }

  private search() {
    this.startResearch();
    const out = searchShells(this.spec, this.deps.shells(this.spec));
    this.candidates = out.results;
    this.emit({ type: "funnel", id: rid("ev"), stages: out.stages });
    const pathText = out.stages.map((s) => `${s.count.toLocaleString()} ${s.label}`).join(" → ");
    return {
      result: { considered: out.considered, rejected: out.rejected, stages: out.stages.map((s) => ({ label: s.label, count: s.count })), top: out.results.map((c) => ({ id: c.shell.id, name: displayName(c.shell.name), score: c.score, reasons: c.reasons, scan: !!c.shell.sid })) },
      summary: `${pathText}; ${out.results.length} kept`,
    };
  }

  private matchLayout() {
    const { scale, rooms, results } = similarScans(this.spec, this.deps.shells(this.spec), this.deps.graph);
    if (!rooms) return { result: { error: "spec has no drawn layout" }, summary: "skipped: no drawn layout in the spec" };
    for (const r of results) this.similarity.set(r.candidate.shell.id, r.sim);
    const ranked = results
      .map(({ candidate: c, sim }) => ({ ...c, score: Math.round(c.score * 0.4 + sim.score * 0.6), reasons: [`Layout ${sim.score}% similar to your drawing`, ...c.reasons] }))
      .sort((a, b) => b.score - a.score || a.shell.id.localeCompare(b.shell.id));
    const seen = new Set(ranked.map((c) => c.shell.id));
    this.candidates = [...ranked, ...this.candidates.filter((c) => !seen.has(c.shell.id))];
    const best = results[0];
    const at = scale === 1 ? "" : ` at ${Math.round(scale * 100)}% of the drawn area`;
    return {
      result: { compared: results.length, scale, top: ranked.map((c) => ({ id: c.shell.id, similarity: this.similarity.get(c.shell.id)!.score, breakdown: this.similarity.get(c.shell.id)!.breakdown })) },
      summary: `compared your ${rooms}-room layout${at} with ${results.length} scanned floor plans; most similar ${best ? `${best.sim.score}% (${best.candidate.shell.id})` : "none"}`,
    };
  }

  private shell(id: string) {
    return this.candidates.find((c) => c.shell.id === id);
  }

  private async research() {
    if (!this.deps.research) return { result: { findings: [] }, summary: "no regulation source configured" };
    this.startResearch();
    const { findings, fromCache, timedOut } = await this.researchJob!;
    this.regulations = findings;
    this.researched = true;
    const by = (j: Finding["jurisdiction"]) => findings.filter((f) => f.jurisdiction === j).length;
    const parts = (["city", "county", "state", "federal"] as const).filter((j) => by(j)).map((j) => `${j} ${by(j)}`);
    return {
      result: { findings: findings.map((f) => ({ topic: f.topic, jurisdiction: f.jurisdiction, requirement: f.requirement, certainty: f.certainty })) },
      summary: `${findings.length} rules (${parts.join(", ") || "none"})${fromCache ? " from cache" : ""}${timedOut ? "; research timed out, showing screening rules" : ""}`,
    };
  }

  private screen(ids: string[]) {
    const rows = ids.flatMap((id) => {
      const c = this.shell(id);
      if (!c || this.dropped.has(id)) return [];
      const flags = checkRules(this.spec, c.shell);
      this.screened.set(id, { shell: c.shell, flags });
      return [{ id, dropped: this.enforce(id, flags), fails: flags.filter((f) => f.status === "fail").map((f) => `${f.rule}: ${f.detail}`), unknown: flags.filter((f) => f.status === "unknown").map((f) => f.rule) }];
    });
    const failing = rows.filter((r) => r.fails.length).length;
    const auto = rows.filter((r) => r.dropped).length;
    return { result: { rows }, summary: `screened ${rows.length} site records; ${failing} with a recorded hard conflict${auto ? `; ${auto} dropped for a failed must-have` : ""}` };
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
      const similarity = this.similarity.get(id);
      const lines = scoreLines(this.spec, c.shell, graph, fit, rules);
      const e: Evaluation = { shell: c.shell, searchScore: c.score, searchReasons: c.reasons, graph, fit, rules, work, lines, finalScore: 0, escalations: [], verdicts: [], similarity };
      rescore(e);
      this.evaluated.set(id, e);
      // A missing room is work to build, not a failed must-have; only a far-too-small measured area drops here.
      if (!this.enforce(id, rules, fit.hardFails.filter((f) => f.startsWith("Measured area")))) this.verdict(consult("inspector", this.spec, e), e);
      return [this.row(e)];
    });
    return { result: { rows }, summary: `Inspector walked ${rows.filter((r) => r.scan).length} scans (room graphs read: ${this.graphReads}/${BUDGET.roomGraphs})` };
  }

  evaluateQuietly(ids: string[]) {
    return this.evaluate(ids);
  }

  private verdict(v: Verdict, e: Evaluation) {
    e.verdicts = [...e.verdicts.filter((x) => x.agent !== v.agent), v];
    this.emit({ type: "verdict", id: rid("ev"), verdict: v });
    if (v.status === "veto" && !this.dropped.has(e.shell.id)) {
      const evidence = v.claims.flatMap((c) => c.evidence).slice(0, 4);
      this.dropped.add(e.shell.id);
      this.vetoes.set(e.shell.id, v);
      this.emit({ type: "veto", id: rid("ev"), agent: v.agent, shellId: e.shell.id, name: displayName(e.shell.name), reason: v.headline, evidence });
    }
  }

  handoffNeeded(agent: AgentId) {
    return needsAgent(agent, this.userSpec).needed;
  }

  handoff(agent: AgentId, ids: string[], why?: string) {
    const need = needsAgent(agent, this.userSpec);
    this.emit({ type: "handoff", id: rid("ev"), to: agent, shellIds: ids, why: why ?? need.why, skipped: !need.needed });
    return need.needed;
  }

  private consultMany(agent: AgentId, ids: string[], why?: string) {
    this.consulted.add(agent);
    this.handoff(agent, ids, why);
    const out = ids.flatMap((id) => {
      const e = this.evaluated.get(id);
      if (!e || this.dropped.has(id)) return [];
      const v = consult(agent, this.spec, e);
      this.verdict(v, e);
      // Code and Systems warnings come from rule hits already scored; Access measurements are new evidence.
      if (v.status === "warn" && agent === "access") { e.lines.push({ factor: "Access flag", earned: -2, max: 0, note: v.headline, source: "access" }); rescore(e); }
      return [{ id, status: v.status, headline: v.headline, questions: v.questions.length }];
    });
    const vetoes = out.filter((o) => o.status === "veto").length;
    return { result: { rows: out }, summary: `${AGENTS[agent].name} reviewed ${out.length}: ${vetoes} veto${vetoes === 1 ? "" : "es"}, ${out.filter((o) => o.status === "warn").length} flagged` };
  }

  private row(e: Evaluation) {
    return {
      id: e.shell.id, name: displayName(e.shell.name), dropped: this.dropped.has(e.shell.id), score: e.finalScore, fit: e.graph ? e.fit.score : null, scan: !!e.graph,
      hardFails: e.fit.hardFails, roomUnknowns: e.fit.unknowns, ruleFails: e.rules.filter((r) => r.status === "fail").map((r) => r.rule),
      unknowns: e.rules.filter((r) => r.status === "unknown").map((r) => r.rule),
      unverifiedFixtures: unverifiedFixtures(this.spec, e),
      workItems: e.work.items.length, weeks: e.work.weeksToOpen,
      inspector: e.verdicts.find((v) => v.agent === "inspector")?.status,
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
      const rooms = fixtures.length ? [] : e.graph.rooms.filter((r) => roomTypes.includes(r.label));
      const desc = e.graph.description ?? "";
      const sentences = desc.split(/(?<=\.)\s+/);
      const has = (x: string, w: string) => new RegExp(`\b${w}`, "i").test(x);
      const sentence = sentences.find((x) => fixtures.some((f) => has(x, f)) && roomTypes.some((r) => has(x, r)))
        ?? (roomTypes.length ? undefined : sentences.find((x) => [...fixtures, ...roomTypes].some((w) => has(x, w))));
      outcome = !fixtures.length && !roomTypes.length ? "unresolved: question names no fixture or room type Hermit can look up"
        : objs.length ? `observed: ${objs.map((o) => `${o.label} in room ${o.roomId ?? "?"} (conf ${o.confidence.toFixed(2)})`).join("; ")}`
        : rooms.length ? `observed: room tags ${rooms.map((r) => r.rawTags.join("/")).join("; ")}`
        : sentence ? `described, not tagged: Matterport's scan description says "${sentence.trim().slice(0, 160)}" (AI-written; ask to confirm)`
        : `not observed in ${e.graph.objects.length} object annotations / ${e.graph.rooms.length} room tags / scan description; treat as unknown`;
    }
    e?.escalations.push({ question, outcome });
    if (e && !outcome.startsWith("observed")) { e.lines.push({ factor: "Closer look unresolved", earned: outcome.startsWith("described") ? -1 : -3, max: 0, note: question, source: "inspect_view" }); rescore(e); }
    this.emit({ type: "escalate", id: rid("ev"), shellId: id, question, outcome });
    return { result: { outcome }, summary: outcome };
  }

  private drop(drops: { shellId: string; reason: string }[]) {
    const unknown = drops.filter((d) => !this.shell(d.shellId)).map((d) => d.shellId);
    if (unknown.length === drops.length) throw new Error(`not candidates from search_shells: ${unknown.join(", ")}`);
    const already = drops.filter((d) => this.dropped.has(d.shellId)).length;
    drops = drops.filter((d) => this.shell(d.shellId) && !this.dropped.has(d.shellId));
    for (const d of drops) this.dropOne(d.shellId, d.reason);
    return { result: { dropped: drops.map((d) => d.shellId), alreadyRemoved: already }, summary: drops.length ? `dropped ${drops.length}: ${drops.map((d) => displayName(this.shell(d.shellId)!.shell.name)).join(", ")}` : `${already} already removed by a specialist veto` };
  }

  // Code-enforced must-haves (every planner path): a recorded fail drops the candidate; unknown stays in, flagged, with a landlord question.
  private enforce(id: string, rules: RuleHit[], hardFails: string[] = []) {
    const must = mustHaves(this.spec);
    const why = [
      ...rules.filter((r) => r.status === "fail" && must.some((m) => m.rule === r.rule)).map((r) => `${r.rule}: ${r.detail} (must-have ${must.find((m) => m.rule === r.rule)!.need}; ${r.evidence.map((e) => `${e.source} ${e.ref}`).join(", ") || r.citation})`),
      ...hardFails,
    ];
    if (why.length) this.dropOne(id, why.join("; "));
    return why.length > 0;
  }

  private dropOne(id: string, reason: string) {
    if (this.dropped.has(id)) return;
    const e = this.evaluated.get(id);
    const s = this.screened.get(id);
    const evidence: Evidence[] = [
      ...(e?.rules ?? s?.flags ?? []).filter((r) => r.status === "fail").flatMap((r) => r.evidence),
      ...(e?.fit.hardFails.length && e.graph ? [{ source: "matterport", ref: `${e.graph.sid} room graph`, confidence: 0.8 }] : []),
    ];
    this.dropped.add(id);
    this.emit({ type: "drop", id: rid("ev"), shellId: id, reason, evidence });
  }

  private async submit(ids: string[]) {
    if (this.deps.research && !this.researched) {
      const t0 = Date.now();
      const r = await this.research();
      this.emit({ type: "tool", id: rid("ev"), tool: "research_regulations", args: {}, resultId: rid("research_regulations"), summary: r.summary, ms: Date.now() - t0 });
    }
    // Guardrail: a specialist with veto power that the user's needs call for reviews every finalist, whatever the planner chose.
    for (const agent of ["code", "access"] as const) {
      if (!needsAgent(agent, this.userSpec).needed) continue;
      const missed = ids.filter((id) => this.evaluated.has(id) && !this.dropped.has(id) && !this.evaluated.get(id)!.verdicts.some((v) => v.agent === agent));
      if (!missed.length) continue;
      this.emit({ type: "handoff", id: rid("ev"), to: agent, shellIds: missed, why: `Hermit's rule: ${AGENTS[agent].name} reviews every finalist before a report goes out` });
      for (const id of missed) this.verdict(consult(agent, this.spec, this.evaluated.get(id)!), this.evaluated.get(id)!);
    }
    // The planner picks which spaces to report; rank follows the evidence score so every position is explainable.
    const chosen = ids.filter((id) => this.evaluated.has(id) && !this.dropped.has(id))
      .sort((a, b) => this.evaluated.get(b)!.finalScore - this.evaluated.get(a)!.finalScore).slice(0, 5);
    if (ids.length && !chosen.length && !ids.some((id) => this.vetoes.has(id))) throw new Error(`none of ${ids.join(", ")} were evaluated (or all were dropped/vetoed); call evaluate_candidates first`);
    for (const id of chosen) {
      const e = this.evaluated.get(id)!;
      for (const a of ["estimator", "advocate"] as const) if (!e.verdicts.some((v) => v.agent === a)) e.verdicts.push(consult(a, this.spec, e));
    }
    this.reports = chosen.map((id, i) => buildReport(this.spec, this.evaluated.get(id)!, i + 1, this.regulations));
    const first = this.candidates[0];
    if (first && chosen[0] && chosen[0] !== first.shell.id) {
      const veto = this.vetoes.get(first.shell.id);
      const top = displayName(this.evaluated.get(chosen[0])!.shell.name), scout = displayName(first.shell.name);
      this.emit({ type: "rerank", id: rid("ev"), order: chosen, reason: veto
        ? `${AGENTS[veto.agent].name} vetoed the Scout's first pick, ${scout} (${veto.headline.charAt(0).toLowerCase()}${veto.headline.slice(1)}). ${top} takes the top spot.`
        : this.dropped.has(first.shell.id) ? `The Scout's first pick, ${scout}, was dropped. ${top} takes the top spot.`
        : `After walking the scans, ${top} outscored the Scout's first pick, ${scout}.` });
    }
    return { result: { reports: this.reports.length }, summary: `${this.reports.length} Shell Reports` };
  }

  // Verifier pass: deterministic re-check of every report (always), plus an independent LLM audit when a provider is set.
  // Rule violations demote a report to the bottom; LLM findings only flag (code, not the model, decides what fails).
  private async verify() {
    const reports = this.reports!;
    const t0 = Date.now();
    for (const r of reports) r.verification = checkReport(this.spec, r);
    let note = "";
    if (this.audit && reports.length) {
      try {
        const out = await Promise.race([
          this.audit.audit(auditInput(this.spec, reports)),
          new Promise<never>((_, no) => setTimeout(() => no(new Error(`no answer in ${BUDGET.auditMs / 1000}s`)), BUDGET.auditMs)),
        ]);
        for (const a of out.reports ?? []) {
          const v = reports.find((r) => r.shellId === a.shellId)?.verification;
          if (!v) continue;
          v.by.push(this.audit.name);
          if (!a.ok && a.issues?.length) {
            v.issues.push(...a.issues.map((i) => `${this.audit!.name} auditor: ${i}`));
            if (v.status === "verified") v.status = "flagged";
          }
        }
      } catch (e) {
        note = `; ${this.audit.name} auditor unavailable`;
        this.emit({ type: "error", id: rid("ev"), message: `${this.audit.name} verifier failed (${e instanceof Error ? e.message : e}); kept the rule-based verification.` });
      }
    }
    const demoted = reports.filter((r) => r.verification!.status === "demoted");
    if (demoted.length) {
      this.reports = [...reports.filter((r) => !demoted.includes(r)), ...demoted].map((r, i) => ({ ...r, rank: i + 1 }));
      this.emit({ type: "rerank", id: rid("ev"), order: this.reports.map((r) => r.shellId), reason: `Verifier moved ${demoted.map((r) => r.shellId).join(", ")} to the bottom: ${demoted[0].verification!.issues[0]}` });
    }
    const flagged = reports.filter((r) => r.verification!.status === "flagged").length;
    const must = mustHaves(this.spec).length;
    this.emit({
      type: "tool", id: rid("ev"), tool: "verify_reports", args: { shellIds: reports.map((r) => r.shellId) }, resultId: rid("verify_reports"), ms: Date.now() - t0,
      summary: `Verified ${reports.length} report${reports.length === 1 ? "" : "s"} against ${must} must-have${must === 1 ? "" : "s"}: ${demoted.length} demoted, ${flagged} flagged (${["rules", ...(this.audit && !note ? [this.audit.name] : [])].join(" + ")})${note}`,
    });
  }
}

// Last step when the budget is spent: evaluate any unevaluated picks inside the single submit call.
export async function finalize(run: Run, ids: string[]) {
  const missing = ids.filter((id) => !run.evaluated.has(id));
  if (missing.length) await run.evaluateQuietly(missing);
  return run.call("submit_reports", { shellIds: ids.filter((id) => run.evaluated.has(id) && !run.dropped.has(id)) });
}

const FIXTURE_WORDS = ["sink", "toilet", "shower", "bathtub", "tub", "hood", "drain", "range", "stove", "oven", "refrigerator", "dishwasher", "washer", "dryer", "elevator", "ramp"];
const ROOM_WORDS = ["bathroom", "restroom", "kitchen", "office", "bedroom", "reception", "conference", "storage", "utility", "garage", "exam"];

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

// Evidence score lines, blended 50/50 with layout similarity when the user drew a plan.
function rescore(e: Evaluation) {
  const base = total(e.lines);
  e.finalScore = e.similarity ? Math.round(base * 0.5 + e.similarity.score * 0.5) : base;
}

export const newEventId = () => rid("ev");
