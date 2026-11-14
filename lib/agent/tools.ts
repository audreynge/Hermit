import { z } from "zod";
import { AGENTS, consult, needsAgent, type AgentId, type Verdict } from "../crew";
import { searchShells, type Candidate } from "../query/shells";
import { fit as fitRooms } from "../reason/fit";
import { IMPLIED_FIXTURES } from "../reason/labels";
import { checkRules } from "../reason/rules";
import { estimateWork } from "../reason/work";
import { seedRooms } from "../uses/packs";
import { concerns, weight } from "../crew/skeptic";
import { competitorCount, transitCount } from "../neighborhood/summarize";
import { useCategory } from "../reason/rules";
import type { SiteFile } from "../neighborhood/types";
import type { Evidence, RequirementSpec, RoomGraph, Shell, ShellReport, TraceEvent } from "../types";
import { buildReport, displayName, scoreLines, total, type Evaluation } from "./report";

export type AgentDeps = { shells: () => Shell[]; graph: (sid: string) => RoomGraph | null; site?: (sid: string) => SiteFile | null };
export const BUDGET = { toolCalls: 25, roomGraphs: 8, inspections: 4, ms: 40_000 };

let seq = 0;
const rid = (p: string) => `${p}_${(++seq).toString(36)}`;

const CONSULTABLE = ["code", "access", "systems", "surveyor"] as const;
export const ToolInputs = {
  search_shells: z.object({}),
  screen_sites: z.object({ shellIds: z.array(z.string()).max(20) }),
  evaluate_candidates: z.object({ shellIds: z.array(z.string()).max(8) }),
  consult_specialist: z.object({ agent: z.enum(CONSULTABLE), shellIds: z.array(z.string()).min(1).max(8), why: z.string().optional() }),
  inspect_view: z.object({ shellId: z.string(), question: z.string() }),
  drop_candidate: z.object({ drops: z.array(z.object({ shellId: z.string(), reason: z.string() })).min(1).max(20) }),
  submit_reports: z.object({ shellIds: z.array(z.string()).max(5) }),
};
export type ToolName = keyof typeof ToolInputs;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  search_shells: "Scout: run the funnel over every scan in the index (city, space type, size, prior use) and return the top 50 with stage counts. Call first.",
  screen_sites: "Cheap record-only screen of up to 20 candidates: zoning, parking, power, sprinklers, availability. Returns pass/fail/unknown flags.",
  evaluate_candidates: `Inspector walks up to ${BUDGET.roomGraphs} scans: loads each Matterport room graph, measures rooms, maps the user's rooms onto them (Hungarian assignment), prices the work. Expensive; only for plausible candidates.`,
  consult_specialist: "Hand evaluated candidates to one specialist: code (zoning/parking/fire/power), access (corridor widths, floors, stairs; only useful if the user needs step-free access), systems (HVAC/power, hidden infrastructure), surveyor (aerial site check). A specialist veto removes the candidate.",
  inspect_view: "Inspector takes a closer look at one candidate's scan (room tags, object annotations, Matterport's scan description) to answer one narrow question, e.g. whether exam rooms have sinks. At most 4 per run.",
  drop_candidate: "Remove candidates with the evidence-based reason that rules each out. Batch drops into one call.",
  submit_reports: "Finish: produce Shell Reports for up to 5 evaluated, non-vetoed candidates in your chosen rank order.",
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
  consulted = new Set<AgentId>();
  vetoes = new Map<string, Verdict>();
  swappedFrom: string | null = null;
  reports: ShellReport[] | null = null;
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
    const { result, summary } = this.exec(name, args as never);
    this.emit({ type: "tool", id: rid("ev"), tool: name, args, resultId, summary, ms: Date.now() - t0 });
    return { resultId, ...result };
  }

  private exec(name: ToolName, args: Record<string, never>): { result: object; summary: string } {
    switch (name) {
      case "search_shells": return this.search();
      case "screen_sites": return this.screen(args.shellIds);
      case "evaluate_candidates": return this.evaluate(args.shellIds);
      case "consult_specialist": return this.consultMany(args.agent, args.shellIds, args.why);
      case "inspect_view": return this.inspect(args.shellId, args.question);
      case "drop_candidate": return this.drop(args.drops);
      case "submit_reports": return this.submit(args.shellIds);
    }
  }

  private search() {
    const out = searchShells(this.spec, this.deps.shells());
    this.candidates = out.results;
    this.emit({ type: "funnel", id: rid("ev"), stages: out.stages });
    this.scoutAreas(out.results.map((c) => c.shell));
    const pathText = out.stages.map((s) => `${s.count.toLocaleString()} ${s.label}`).join(" → ");
    return {
      result: { stages: out.stages.map((s) => ({ label: s.label, count: s.count })), top: out.results.slice(0, 20).map((c) => ({ id: c.shell.id, name: displayName(c.shell.name), score: c.score, reasons: c.reasons.slice(0, 3), scan: !!c.shell.sid })) },
      summary: `${pathText}; top ${out.results.length} kept`,
    };
  }

  // Neighborhood scout: before any building is picked, which ZIP codes in the pool suit a walk-in business.
  private scoutAreas(shells: Shell[]) {
    if (!this.deps.site) return;
    const use = useCategory(this.spec.useType);
    const byZip = new Map<string, { spaces: number; transit: number; traffic: number; rivals: number }>();
    for (const s of shells) {
      const zip = s.address.match(/\b(77\d{3}|9[01]\d{3})\b/)?.[1];
      const site = s.sid ? this.deps.site(s.sid) : null;
      if (!zip || !site) continue;
      const z = byZip.get(zip) ?? { spaces: 0, transit: 0, traffic: 0, rivals: 0 };
      z.spaces++; z.transit += transitCount(site) ?? 0; z.traffic = Math.max(z.traffic, site.traffic?.aadt ?? 0); z.rivals += competitorCount(site, use) ?? 0;
      byZip.set(zip, z);
    }
    const ranked = [...byZip].map(([zip, z]) => ({ zip, z, score: z.transit / z.spaces + z.traffic / 15000 - (z.rivals / z.spaces) / 6 + Math.min(2, z.spaces / 3) }))
      .sort((a, b) => b.score - a.score).slice(0, 3);
    if (ranked.length < 2) return;
    this.emit({ type: "areas", id: rid("ev"), areas: ranked.map(({ zip, z }) => ({ zip, spaces: z.spaces, why: [z.transit ? `${Math.round(z.transit / z.spaces)} transit stops per space` : "few transit stops", z.traffic ? `up to ${Math.round(z.traffic / 1000)}k cars a day` : null, `${Math.round(z.rivals / z.spaces)} competitor${Math.round(z.rivals / z.spaces) === 1 ? "" : "s"} nearby on average`].filter(Boolean).join(", ") })) });
  }

  private shell(id: string) {
    return this.candidates.find((c) => c.shell.id === id);
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

  private evaluate(ids: string[]) {
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
      const rules = checkRules(this.spec, c.shell, graph ?? undefined);
      const work = estimateWork(this.spec, c.shell, fit, rules);
      const lines = scoreLines(this.spec, c.shell, graph, fit, rules);
      const e: Evaluation = { shell: c.shell, searchScore: c.score, searchReasons: c.reasons, graph, fit, rules, work, lines, finalScore: total(lines), escalations: [], verdicts: [] };
      this.evaluated.set(id, e);
      this.verdict(consult("inspector", this.spec, e), e);
      return [this.row(e)];
    });
    return { result: { rows }, summary: `Inspector walked ${rows.filter((r) => r.scan).length} scans (room graphs read: ${this.graphReads}/${BUDGET.roomGraphs})` };
  }

  evaluateQuietly(ids: string[]) {
    this.evaluate(ids);
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
      if (v.status === "warn" && agent === "access") { e.lines.push({ factor: "Access flag", earned: -2, max: 0, note: v.headline, source: "access" }); e.finalScore = total(e.lines); }
      return [{ id, status: v.status, headline: v.headline, questions: v.questions.length }];
    });
    const vetoes = out.filter((o) => o.status === "veto").length;
    return { result: { rows: out }, summary: `${AGENTS[agent].name} reviewed ${out.length}: ${vetoes} veto${vetoes === 1 ? "" : "es"}, ${out.filter((o) => o.status === "warn").length} flagged` };
  }

  private row(e: Evaluation) {
    return {
      id: e.shell.id, name: displayName(e.shell.name), score: e.finalScore, fit: e.graph ? e.fit.score : null, scan: !!e.graph,
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
    if (e && !outcome.startsWith("observed")) { e.lines.push({ factor: "Closer look unresolved", earned: outcome.startsWith("described") ? -1 : -3, max: 0, note: question, source: "inspect_view" }); e.finalScore = total(e.lines); }
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

  // The Skeptic argues against the top pick. It keeps the spot only if the runner-up isn't clearly less risky.
  private skeptic(chosen: string[]) {
    if (!chosen.length) return;
    const site = (id: string) => { const sid = this.evaluated.get(id)!.shell.sid; return sid && this.deps.site ? this.deps.site(sid) : null; };
    const top = this.evaluated.get(chosen[0])!;
    const mine = concerns(this.spec, top, site(chosen[0]));
    if (!mine.length) return;
    for (const c of mine) top.lines.push({ factor: "Skeptic's concern", earned: -c.weight, max: 0, note: c.text, source: c.source });
    top.finalScore = total(top.lines);
    const killer = (c: typeof mine) => c.some((x) => x.weight >= 3);
    // A deal-killer (a possible exclusive next door) hands the top spot to the best finalist without one, if it's
    // close on score; otherwise the runner-up must be clearly less risky overall.
    const others = chosen.slice(1).map((id) => ({ id, e: this.evaluated.get(id)!, c: concerns(this.spec, this.evaluated.get(id)!, site(id)) }));
    const clean = killer(mine) ? others.find((o) => !killer(o.c) && o.e.finalScore >= top.finalScore - 10) : undefined;
    const second = others[0];
    const alt = clean ?? (second && weight(mine) >= 3 && weight(second.c) + 2 <= weight(mine) && second.e.finalScore >= top.finalScore - 6 ? second : undefined);
    if (alt) {
      this.swappedFrom = top.shell.id;
      for (const c of alt.c) alt.e.lines.push({ factor: "Skeptic's concern", earned: -c.weight, max: 0, note: c.text, source: c.source });
      alt.e.finalScore = total(alt.e.lines);
      chosen.splice(chosen.indexOf(alt.id), 1);
      chosen.unshift(alt.id);
    }
    const name = displayName(top.shell.name);
    this.emit({ type: "challenge", id: rid("ev"), shellId: top.shell.id, name, concerns: mine.map((c) => c.text), outcome: alt ? "swapped" : "survived",
      detail: alt ? `${displayName(alt.e.shell.name)} has ${clean ? "no competitor on its block" : "fewer red flags"}, so it moves to the top.`
        : second ? `${name} still wins: ${second.c.length ? `the alternatives have their own problems (${second.c[0].text.toLowerCase()})` : "its strengths outweigh these"}.` : `${name} is the only finalist.` });
  }

  private submit(ids: string[]) {
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
    this.skeptic(chosen);
    this.reports = chosen.map((id, i) => { const e = this.evaluated.get(id)!; return buildReport(this.spec, e, i + 1, e.shell.sid && this.deps.site ? this.deps.site(e.shell.sid) : null); });
    const first = this.candidates[0];
    if (first && chosen[0] && chosen[0] !== first.shell.id) {
      const veto = this.vetoes.get(first.shell.id);
      const top = displayName(this.evaluated.get(chosen[0])!.shell.name), scout = displayName(first.shell.name);
      const skeptic = this.swappedFrom === first.shell.id;
      this.emit({ type: "rerank", id: rid("ev"), order: chosen, reason: skeptic
        ? `The Skeptic flagged a possible exclusive conflict at the Scout's first pick, ${scout}. ${top} takes the top spot.`
        : veto
        ? `${AGENTS[veto.agent].name} vetoed the Scout's first pick, ${scout} (${veto.headline.charAt(0).toLowerCase()}${veto.headline.slice(1)}). ${top} takes the top spot.`
        : this.dropped.has(first.shell.id) ? `The Scout's first pick, ${scout}, was dropped. ${top} takes the top spot.`
        : `After walking the scans, ${top} outscored the Scout's first pick, ${scout}.` });
    }
    return { result: { reports: this.reports.length }, summary: `${this.reports.length} Shell Reports` };
  }
}

// Last step when the budget is spent: evaluate any unevaluated picks inside the single submit call.
export async function finalize(run: Run, ids: string[]) {
  const missing = ids.filter((id) => !run.evaluated.has(id));
  if (missing.length) run.evaluateQuietly(missing);
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

export const newEventId = () => rid("ev");
