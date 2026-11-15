import { z } from "zod";
import { AGENTS, consult, needsAgent, type AgentId, type Verdict } from "../crew";
import { searchShells, type Candidate } from "../query/shells";
import { countLine, countTier, fit as fitRooms, isBathroom, missingOf, roomCounts, severe, shortfalls } from "../reason/fit";
import { IMPLIED_FIXTURES, normalizeRoomLabel } from "../reason/labels";
import { checkRules } from "../reason/rules";
import { estimateWork } from "../reason/work";
import type { ParcelZone } from "../regs/zoning";
import { screeningFindings, type Finding, type RegQuery } from "../regs/research";
import { similarScans } from "../similarity/layout";
import { seedRooms } from "../uses/packs";
import { concerns, weight } from "../crew/skeptic";
import { competitorCount, transitCount } from "../neighborhood/summarize";
import { useCategory } from "../reason/rules";
import { loadAerialCount } from "../vexcel/count";
import { loadPanoCheck } from "../vision/pano";
import type { SiteFile } from "../neighborhood/types";
import type { AerialCount, Evidence, PanoCheck, RequirementSpec, RoomGraph, RoomReq, RuleHit, Shell, ShellReport, Similarity, TraceEvent } from "../types";
import { an } from "../text";
import { buildReport, displayName, scoreLines, spaceName, total, type Evaluation } from "./report";
import { auditInput, checkReport, mustHaves, type Auditor } from "./verify";

export type AgentDeps = {
  shells: (spec: RequirementSpec) => Shell[];
  graph: (sid: string) => RoomGraph | null;
  site?: (sid: string) => SiteFile | null;
  zoning?: (lat: number, lon: number) => Promise<ParcelZone | null>;
  research?: (q: RegQuery) => Promise<{ findings: Finding[]; fromCache: boolean }>;
  aerial?: (sid: string) => AerialCount | null; // default: lib/vexcel/count.ts (null = not counted)
  panoCheck?: (sid: string, roomId: string, feature: string) => PanoCheck | null; // default: lib/vision/pano.ts cache
  look?: ((sid: string, roomId: string, features: string[]) => Promise<PanoCheck[]>) | null; // live photo check; default lib/vision/look.ts when keys are set
};
export const BUDGET = { toolCalls: 25, roomGraphs: 8, inspections: 4, liveLooks: 2, lookMs: 20_000, ms: 40_000, researchMs: 20_000, auditMs: 12_000 };

let seq = 0;
const rid = (p: string) => `${p}_${(++seq).toString(36)}`;

// The live photo check needs Matterport and Gemini keys; tests and keyless runs only read the cache.
const liveLook = (): AgentDeps["look"] =>
  process.env.VITEST || !process.env.GEMINI_API_KEY?.trim() || !process.env.MATTERPORTAPIKEY?.trim() || !process.env.MATTERPORTAPITOKEN?.trim()
    ? null
    : async (sid, roomId, features) => (await import("../vision/look")).checkRoom(sid, roomId, features);

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const plural = (w: string) => (/s$/.test(w) ? w : `${w}s`);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
// "exam rooms #1 and #2", "exam room #1 and the restroom"
function roomList(keys: string[]) {
  const by = new Map<string, string[]>();
  for (const k of keys) { const m = k.match(/^(.*) (#\d+)$/); const base = m ? m[1] : k; (by.get(base) ?? by.set(base, []).get(base)!).push(m ? m[2] : ""); }
  return list([...by].map(([base, nums]) => (nums.length > 1 && nums.every(Boolean) ? `${plural(base)} ${list(nums)}` : nums.map((n) => (n ? `${base} ${n}` : base)).join(" and "))));
}
const BASE_FACTORS = new Set(["Built for your use", "Rooms already built", "Size", "Layout and adjacency", "Code and site screens", "Hard fail cap", "Missing rooms you need"]);

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
  search_shells: "Retrieve every candidate space that passes the RequirementSpec's hard filters from the local index, ranked (city, mode, size, prior use, scan evidence). Call first, once; a repeat returns the same cached result. (Scout.)",
  match_layout: "Only when the spec has a drawn layout: compare it (room program, adjacency, total size, footprint shape) against every scanned candidate in the city and re-rank the candidate list by layout similarity. Call right after search_shells.",
  screen_sites: "Cheap record-only screen of up to 20 candidates: zoning, parking (CoStar record plus stalls counted on the Vexcel aerial), power, sprinklers, bays, availability. Returns per-candidate pass/fail/unknown flags. A candidate that fails a user must-have is dropped automatically (dropped: true).",
  evaluate_candidates: "Composite evaluation of up to 8 candidates: loads the Matterport room graph, runs room assignment (Hungarian), rule checks, the Inspector's verdict and work/cost estimates. At most 8 room graphs per run. Each row gives required room counts (rooms), what's short (missing) and fixtures you need that the scan hasn't confirmed (unverifiedFixtures). Must-have failures are dropped automatically (dropped: true). Rows with wouldDrop: true (a missing bathroom or 2+ missing primary rooms) are dropped at submit_reports unless fewer than 3 candidates would remain, in which case they are reported last. Ruled-out ids are refused.",
  consult_specialist: "Hand evaluated candidates to one specialist: code (zoning/parking/fire/power), access (corridor widths, floors, stairs; only useful if the user needs step-free access), systems (HVAC/power, hidden infrastructure), surveyor (Vexcel aerial: parking stalls and rooftop units counted around the building). A specialist veto removes the candidate.",
  inspect_view: "Look closer at one evaluated candidate: a vision model checks real Matterport panorama photos of the rooms you need for one fixture (e.g. 'Is there a sink in the exam rooms?'). Answers seen / not seen / couldn't tell, with the photo. Use it when an unverifiedFixtures entry could change the ranking. At most 4 per run (2 may be fresh photo checks).",
  drop_candidate: "Remove one or more candidates from consideration, each with the evidence-based reason that rules it out. Batch all drops from one review into a single call.",
  submit_reports: "Finish: produce Shell Reports for up to 5 evaluated, non-vetoed candidates. Rank is set in code: spaces with every required room count come first, then by evidence score. An independent verifier then re-checks every report against the must-haves and sources.",
  research_regulations: "Look up the city, county, state and federal rules (zoning, business and professional licenses, occupancy, health, parking, accessibility, fire, signage) that apply to this use in this city, from official sources only. Call once per search; results are attached to every report.",
};

type Target = { req: string; roomId: string };

export class Run {
  calls = 0;
  graphReads = 0;
  inspections = 0;
  liveLooks = 0;
  started = Date.now();
  candidates: Candidate[] = [];
  screened = new Map<string, { shell: Shell; flags: ReturnType<typeof checkRules> }>();
  evaluated = new Map<string, Evaluation>();
  dropped = new Set<string>();
  dropReasons = new Map<string, { reason: string; evidence: Evidence[] }>();
  similarity = new Map<string, Similarity>();
  reports: ShellReport[] | null = null;
  audit: Auditor | null = null; // independent LLM verifier, set by the planner when a provider is available
  regulations: Finding[] = [];
  researched = false;
  private researchJob: Promise<{ findings: Finding[]; fromCache: boolean; timedOut?: boolean }> | null = null;
  private searchResult: { result: object; summary: string } | null = null;
  private aerials = new Map<string, AerialCount | null>();
  private photoChecks = new Map<string, PanoCheck[]>(); // every photo check known per shell (cached or live)
  private lookErrors: string[] = []; // live photo-check failures, for the tool result only (never shown as an outcome)
  get canResearch() { return !!this.deps.research; }
  consulted = new Set<AgentId>();
  vetoes = new Map<string, Verdict>();
  swappedFrom: string | null = null;
  spec: RequirementSpec;

  constructor(public userSpec: RequirementSpec, public emit: (e: TraceEvent) => void, private deps: AgentDeps) {
    // Rooms the user never described come from the use pack, so a missing sink or restroom counts as work.
    this.spec = { ...userSpec, rooms: withRecordCounts(userSpec, seedRooms(userSpec)) };
    if (deps.look === undefined) this.deps = { ...deps, look: liveLook() };
  }

  counts(e: Evaluation) {
    return roomCounts(this.spec, e.fit, e.graph);
  }

  // Required room counts outrank everything: met, then unconfirmed, then short (fewest missing first); score breaks ties.
  byRoomFit = (a: Evaluation, b: Evaluation) => {
    const ca = this.counts(a), cb = this.counts(b);
    const miss = (c: typeof ca) => c.reduce((s, x) => s + missingOf(x), 0);
    return countTier(ca) - countTier(cb) || miss(ca) - miss(cb) || b.finalScore - a.finalScore;
  };

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
    // search_shells takes no arguments, so a repeat is always the same search: hand back the first answer.
    if (this.searchResult) return {
      result: { ...this.searchResult.result, note: "Same search as before, so this is the cached result. Move on: screen_sites, evaluate_candidates or inspect_view." },
      summary: "repeat search: returned the cached result",
    };
    this.startResearch();
    const out = searchShells(this.spec, this.deps.shells(this.spec));
    this.candidates = out.results;
    this.emit({ type: "funnel", id: rid("ev"), stages: out.stages });
    this.scoutAreas(out.results.map((c) => c.shell));
    const pathText = out.stages.map((s) => `${s.count.toLocaleString()} ${s.label}`).join(" → ");
    this.searchResult = {
      result: { considered: out.considered, rejected: out.rejected, stages: out.stages.map((s) => ({ label: s.label, count: s.count })), top: out.results.map((c) => ({ id: c.shell.id, name: displayName(c.shell.name), score: c.score, reasons: c.reasons, scan: !!c.shell.sid })) },
      summary: `${pathText}; ${out.results.length} kept`,
    };
    return this.searchResult;
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

  private nameOf(id: string) {
    const s = this.evaluated.get(id)?.shell ?? this.shell(id)?.shell;
    return s ? spaceName(s) : id;
  }

  private aerialOf(s: Shell) {
    if (!s.sid) return null;
    if (!this.aerials.has(s.sid)) this.aerials.set(s.sid, (this.deps.aerial ?? loadAerialCount)(s.sid));
    return this.aerials.get(s.sid) ?? null;
  }

  // A planner asking about a space that's already out gets told so, with the reason, instead of a silent skip.
  private refusal(id: string) {
    if (!this.dropped.has(id)) return null;
    const veto = this.vetoes.get(id);
    return `${this.nameOf(id)} was already ruled out${veto ? ` by ${AGENTS[veto.agent].name}` : ""}: ${lowerFirst(veto?.headline ?? this.dropReasons.get(id)?.reason.replace(/^[^:]*: /, "") ?? "dropped earlier").replace(/\.$/, "")}. Pick a candidate that is still in.`;
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
    const refused = ids.flatMap((id) => { const r = this.refusal(id); return r ? [{ id, reason: r }] : []; });
    const rows = ids.flatMap((id) => {
      const c = this.shell(id);
      if (!c || this.dropped.has(id)) return [];
      const flags = checkRules(this.spec, c.shell, undefined, { aerial: this.aerialOf(c.shell) });
      this.screened.set(id, { shell: c.shell, flags });
      return [{ id, dropped: this.enforce(id, flags), fails: flags.filter((f) => f.status === "fail").map((f) => `${f.rule}: ${f.detail}`), unknown: flags.filter((f) => f.status === "unknown").map((f) => f.rule) }];
    });
    const failing = rows.filter((r) => r.fails.length).length;
    const auto = rows.filter((r) => r.dropped).length;
    return { result: { rows, ...(refused.length ? { refused } : {}) }, summary: `screened ${rows.length} site records; ${failing} with a recorded hard conflict${auto ? `; ${auto} dropped for a failed must-have` : ""}` };
  }

  private async evaluate(ids: string[]) {
    const zones = new Map<string, ParcelZone | null>();
    if (this.deps.zoning) await Promise.all(ids.map(async (id) => {
      const s = this.shell(id)?.shell;
      if (!this.dropped.has(id) && s?.city === "los_angeles" && s.lat != null && s.lon != null) zones.set(id, await this.deps.zoning!(s.lat, s.lon).catch(() => null));
    }));
    return this.evaluateWith(ids, zones);
  }

  private evaluateWith(ids: string[], zones: Map<string, ParcelZone | null>) {
    const refused = ids.flatMap((id) => { const r = this.refusal(id); return r ? [{ id, reason: r }] : []; });
    const fresh: Evaluation[] = [];
    const seen = ids.flatMap((id) => {
      const c = this.shell(id);
      if (!c || this.dropped.has(id)) return [];
      if (this.evaluated.has(id)) return [this.evaluated.get(id)!];
      let graph: RoomGraph | null = null;
      if (c.shell.sid && this.graphReads < BUDGET.roomGraphs) {
        this.graphReads++;
        graph = this.deps.graph(c.shell.sid);
      }
      const aerial = this.aerialOf(c.shell);
      const fit = graph ? fitRooms(this.spec, graph) : { score: 0, assignment: [], edits: [], breakdown: {}, hardFails: [], unknowns: [] };
      const rules = checkRules(this.spec, c.shell, graph ?? undefined, { parcelZone: zones.get(id) ?? null, aerial });
      const work = estimateWork(this.spec, c.shell, fit, rules);
      const similarity = this.similarity.get(id);
      const lines = scoreLines(this.spec, c.shell, graph, fit, rules);
      const e: Evaluation = { shell: c.shell, searchScore: c.score, searchReasons: c.reasons, graph, fit, rules, work, lines, finalScore: 0, escalations: [], verdicts: [], similarity, aerial };
      rescore(e);
      this.evaluated.set(id, e);
      // Must-haves and a far-too-small measured area drop here; required room counts are enforced at submit, after every veto.
      if (!this.enforce(id, rules, fit.hardFails.filter((f) => f.startsWith("Measured area")))) fresh.push(e);
      return [e];
    });
    for (const e of fresh) if (!this.dropped.has(e.shell.id)) this.verdict(consult("inspector", this.spec, e), e);
    const rows = seen.map((e) => this.row(e));
    if (!rows.length && refused.length) return { result: { error: "every id you sent was already ruled out", refused }, summary: `refused ${refused.length}: already ruled out` };
    return { result: { rows, ...(refused.length ? { refused } : {}) }, summary: `Inspector walked ${rows.filter((r) => r.scan).length} scans (room graphs read: ${this.graphReads}/${BUDGET.roomGraphs})${refused.length ? `; refused ${refused.length} already ruled out` : ""}` };
  }

  evaluateQuietly(ids: string[]) {
    return this.evaluate(ids);
  }

  private verdict(v: Verdict, e: Evaluation) {
    e.verdicts = [...e.verdicts.filter((x) => x.agent !== v.agent), v];
    this.emit({ type: "verdict", id: rid("ev"), verdict: v });
    if (v.status === "veto" && !this.dropped.has(e.shell.id)) {
      const evidence = v.claims.flatMap((c) => c.evidence).slice(0, 4);
      const name = spaceName(e.shell);
      this.dropped.add(e.shell.id);
      this.vetoes.set(e.shell.id, v);
      this.emit({ type: "veto", id: rid("ev"), agent: v.agent, shellId: e.shell.id, name: displayName(e.shell.name), reason: `${name}: ${lowerFirst(v.headline)}`, evidence });
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

  // Missing a bathroom or 2+ primary rooms drops the space, worst first, as long as 3 evaluated candidates remain.
  private enforceCounts() {
    const alive = [...this.evaluated.values()].filter((e) => !this.dropped.has(e.shell.id));
    let left = alive.length;
    for (const e of alive.filter((x) => severe(this.counts(x))).sort((a, b) => this.byRoomFit(b, a))) {
      if (left <= 3) break;
      this.dropOne(e.shell.id, shortfalls(this.spec, this.counts(e)).join("; "));
      left--;
    }
  }

  private row(e: Evaluation) {
    const counts = this.counts(e);
    return {
      id: e.shell.id, name: displayName(e.shell.name), dropped: this.dropped.has(e.shell.id), score: e.finalScore, fit: e.graph ? e.fit.score : null, scan: !!e.graph,
      rooms: countLine(this.spec, counts, !!e.graph), missing: shortfalls(this.spec, counts), wouldDrop: severe(counts),
      hardFails: e.fit.hardFails, roomUnknowns: e.fit.unknowns, ruleFails: e.rules.filter((r) => r.status === "fail").map((r) => r.rule),
      unknowns: e.rules.filter((r) => r.status === "unknown").map((r) => r.rule),
      unverifiedFixtures: unverifiedFixtures(this.spec, e),
      workItems: e.work.items.length, weeks: e.work.weeksToOpen,
      inspector: e.verdicts.find((v) => v.agent === "inspector")?.status,
    };
  }

  // Re-run the room fit with every fixture Hermit saw in the scan photos, so a room with a visible sink can take the
  // exam-room slot. Score lines added by specialists (access flags, closer-look notes) are kept.
  private refit(e: Evaluation) {
    if (!e.graph) return;
    const extras = e.lines.filter((l) => !BASE_FACTORS.has(l.factor));
    e.fit = fitRooms(this.spec, seenGraph(e));
    e.work = estimateWork(this.spec, e.shell, e.fit, e.rules);
    e.lines = [...scoreLines(this.spec, e.shell, e.graph, e.fit, e.rules), ...extras];
    rescore(e);
  }

  // Rooms (by requirement key) that the question is about and that need this fixture.
  private targets(e: Evaluation, feature: string, rooms: string[]): Target[] {
    const reqOf = (key: string) => this.spec.rooms.find((r) => key === r.label || key.startsWith(`${r.label} #`));
    const named = (key: string) => { const r = reqOf(key); return !rooms.length || (r ? rooms.some((w) => r.label.toLowerCase().includes(w) || normalizeRoomLabel([r.label]) === normalizeRoomLabel([w])) : false); };
    const rows = e.fit.assignment.filter((a) => a.roomId && named(a.req));
    const needing = rows.filter((a) => reqOf(a.req)?.fixtures?.some((f) => f.toLowerCase() === feature));
    return (needing.length ? needing : rooms.length ? rows : []).map((a) => ({ req: a.req, roomId: a.roomId! }));
  }

  private checkOf(id: string, roomId: string, feature: string) {
    return this.photoChecks.get(id)?.find((c) => c.roomId === roomId && c.feature.toLowerCase() === feature) ?? null;
  }

  private addChecks(id: string, checks: PanoCheck[]) {
    const have = this.photoChecks.get(id) ?? [];
    const key = (c: PanoCheck) => `${c.roomId}|${c.feature.toLowerCase()}`;
    const fresh = new Map(checks.map((c) => [key(c), c]));
    this.photoChecks.set(id, [...have.filter((c) => !fresh.has(key(c))), ...fresh.values()]);
  }

  private async lookLive(sid: string, roomId: string, features: string[]): Promise<PanoCheck[] | string> {
    const look = this.deps.look;
    if (!look) return "no saved photo check for it";
    if (this.liveLooks >= BUDGET.liveLooks) return this.lookErrors.length ? "the photo check couldn't run" : "this search's fresh photo checks were used up";
    this.liveLooks++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        look(sid, roomId, features),
        new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error(`no answer in ${BUDGET.lookMs / 1000}s`)), BUDGET.lookMs); }),
      ]);
    } catch (err) {
      // A provider failure (no credits, timeout) won't fix itself mid-run: stop asking and use the cache only.
      this.liveLooks = BUDGET.liveLooks;
      this.lookErrors.push(err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160));
      if (this.lookErrors.length === 1) this.emit({ type: "error", id: rid("ev"), message: `Live photo check unavailable (${this.lookErrors[0].split(":")[0]}); Hermit uses saved photo checks only for the rest of this search.` });
      return "the photo check couldn't run";
    } finally {
      clearTimeout(timer);
    }
  }

  // "Hermit looked closer": a vision model's answer on real scan photos of the rooms the question is about.
  // Cached answers first; at most BUDGET.liveLooks fresh ones per run. seen resolves the fixture, not_seen leaves the
  // "Add … to …" work item, couldn't tell becomes a question for the landlord.
  private async inspect(id: string, question: string) {
    const refused = this.refusal(id);
    if (refused) return { result: { error: refused }, summary: `refused: ${this.nameOf(id)} was already ruled out` };
    const e = this.evaluated.get(id);
    if (this.inspections >= BUDGET.inspections) return { result: { error: "inspection budget exhausted" }, summary: "skipped: inspection budget exhausted" };
    this.inspections++;
    const words = new Set((question.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => w.replace(/s$/, "")));
    const q = question.toLowerCase();
    const specFixtures = [...new Set(this.spec.rooms.flatMap((r) => r.fixtures ?? []).map((f) => f.toLowerCase()))];
    const feature = specFixtures.find((f) => q.includes(f)) ?? FIXTURE_WORDS.find((f) => words.has(f));
    const rooms = [...new Set([...this.spec.rooms.map((r) => r.label.toLowerCase()).filter((l) => q.includes(l)), ...ROOM_WORDS.filter((r) => words.has(r))])];
    const name = spaceName(e?.shell ?? this.shell(id)?.shell ?? { name: id, address: "" });
    const sid = e?.graph?.sid;
    const targets = e && sid && feature ? this.targets(e, feature, rooms) : [];
    if (!e || !sid || !feature || !targets.length) return this.inspectMetadata(id, e, question, words);

    // Every cached answer for this fixture in the scan, then fresh photo checks for target rooms nobody looked at yet.
    const cached = e.graph!.rooms.flatMap((r) => { const c = (this.deps.panoCheck ?? loadPanoCheck)(sid, r.id, feature); return c ? [c] : []; });
    this.addChecks(id, cached);
    const notes: string[] = [];
    for (const t of targets) {
      if (this.checkOf(id, t.roomId, feature)) continue;
      const fixtures = this.spec.rooms.find((r) => t.req === r.label || t.req.startsWith(`${r.label} #`))?.fixtures ?? [feature];
      const live = await this.lookLive(sid, t.roomId, [...new Set([feature, ...fixtures.map((f) => f.toLowerCase())])]);
      if (typeof live === "string") { notes.push(live); break; }
      this.addChecks(id, live);
    }
    e.seen = (this.photoChecks.get(id) ?? []).filter((c) => c.result === "seen");
    this.refit(e);
    const after = this.targets(e, feature, rooms);
    const results = after.map((t) => ({ ...t, check: this.checkOf(id, t.roomId, feature) }));
    const seenR = results.filter((r) => r.check?.result === "seen");
    const notR = results.filter((r) => r.check?.result === "not_seen");
    const unclearR = results.filter((r) => r.check?.result === "unclear");
    const unlooked = results.filter((r) => !r.check);
    const result: PanoCheck["result"] = results.length && seenR.length === results.length ? "seen" : notR.length ? "not_seen" : "unclear";

    const clauses: string[] = [];
    if (seenR.length) clauses.push(`${an(feature)} is visible in ${roomList(seenR.map((r) => r.req))}`);
    if (notR.length) clauses.push(`no ${feature} in ${roomList(notR.map((r) => r.req))}`);
    if (unclearR.length) clauses.push(`couldn't tell if ${roomList(unclearR.map((r) => r.req))} ${unclearR.length > 1 ? "have" : "has"} ${an(feature)} (${lowerFirst(unclearR[0].check!.note.replace(/\.$/, ""))})`);
    if (unlooked.length) clauses.push(`${roomList(unlooked.map((r) => r.req))} ${unlooked.length > 1 ? "weren't" : "wasn't"} looked at${notes[0] ? ` (${notes[0]})` : ""}`);
    const outcome = `Looked closer at ${name}: ${clauses.join("; ")}.`;
    const evidence: Evidence[] = results.flatMap((r) => (r.check ? [{ source: "Matterport scan photo", ref: r.check.panoId ? `pano:${r.check.panoId} face ${r.check.face ?? "?"}` : `${sid}/${r.roomId} (no photo inside the room)`, confidence: r.check.confidence }] : []));

    // Report: the photo checks behind this answer; couldn't-tell rooms become landlord questions.
    const byKey = new Map((e.checks ?? []).map((c) => [`${c.roomId}|${c.feature}`, c]));
    for (const r of results) if (r.check) byKey.set(`${r.check.roomId}|${r.check.feature}`, r.check);
    e.checks = [...byKey.values()];
    for (const r of [...unclearR, ...unlooked])
      (e.extraUnknowns ??= []).push({ topic: "looked closer", question: `Is there ${an(feature)} in ${r.req}? ${r.check ? r.check.note : "Hermit didn't get to look at that room's photos."}` });
    if (unclearR.length || unlooked.length) { e.lines.push({ factor: "Closer look: couldn't tell", earned: -2, max: 0, note: `${an(feature)} in ${roomList([...unclearR, ...unlooked].map((r) => r.req))}`, source: "inspect_view (scan photos)" }); rescore(e); }
    e.escalations.push({ question, outcome, result, evidence });
    this.emit({ type: "escalate", id: rid("ev"), shellId: id, question, outcome, result, evidence });
    return { result: { outcome, result, rooms: results.map((r) => ({ room: r.req, result: r.check?.result ?? "not looked at", note: r.check?.note })), unverifiedFixtures: unverifiedFixtures(this.spec, e), ...(this.lookErrors.length ? { photoCheckError: this.lookErrors.at(-1) } : {}) }, summary: outcome };
  }

  // No photo check applies (no scan, no fixture named, or no matching room): read Matterport's own tags and description.
  private inspectMetadata(id: string, e: Evaluation | undefined, question: string, words: Set<string>) {
    let outcome: string;
    let result: PanoCheck["result"] = "unclear";
    if (!e?.graph) outcome = "unresolved: no cached scan for this candidate";
    else {
      const fixtures = FIXTURE_WORDS.filter((f) => words.has(f));
      const roomTypes = ROOM_WORDS.filter((r) => words.has(r));
      const objs = e.graph.objects.filter((o) => fixtures.includes(o.label.replace(/s$/, "")));
      const rooms = fixtures.length ? [] : e.graph.rooms.filter((r) => roomTypes.includes(r.label));
      const desc = e.graph.description ?? "";
      const sentences = desc.split(/(?<=\.)\s+/);
      const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const has = (x: string, w: string) => new RegExp(`\\b${esc(w)}`, "i").test(x);
      const sentence = sentences.find((x) => fixtures.some((f) => has(x, f)) && roomTypes.some((r) => has(x, r)))
        ?? (roomTypes.length ? undefined : sentences.find((x) => [...fixtures, ...roomTypes].some((w) => has(x, w))));
      if (objs.length || rooms.length) result = "seen";
      outcome = !fixtures.length && !roomTypes.length ? "unresolved: question names no fixture or room type Hermit can look up"
        : objs.length ? `observed: ${objs.map((o) => `${o.label} in room ${o.roomId ?? "?"} (conf ${o.confidence.toFixed(2)})`).join("; ")}`
        : rooms.length ? `observed: room tags ${rooms.map((r) => r.rawTags.join("/")).join("; ")}`
        : sentence ? `described, not tagged: Matterport's scan description says "${sentence.trim().slice(0, 160)}" (AI-written; ask to confirm)`
        : `not observed in ${e.graph.objects.length} object annotations / ${e.graph.rooms.length} room tags / scan description; treat as unknown`;
    }
    const evidence: Evidence[] = e?.graph ? [{ source: "matterport", ref: `${e.graph.sid} objectAnnotations + generatedDescription`, confidence: 0.5 }] : [];
    e?.escalations.push({ question, outcome, result, evidence });
    if (e && !outcome.startsWith("observed")) { e.lines.push({ factor: "Closer look unresolved", earned: outcome.startsWith("described") ? -1 : -3, max: 0, note: question, source: "inspect_view" }); rescore(e); }
    this.emit({ type: "escalate", id: rid("ev"), shellId: id, question, outcome, result, evidence });
    return { result: { outcome, result }, summary: outcome };
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
    const why = [...rules.filter((r) => r.status === "fail" && must.some((m) => m.rule === r.rule)).map((r) => r.detail.replace(/\.$/, "")), ...hardFails];
    if (why.length) this.dropOne(id, why.join("; "));
    return why.length > 0;
  }

  // Every drop names the space and carries the evidence that ruled it out.
  private dropOne(id: string, reason: string) {
    if (this.dropped.has(id)) return;
    const e = this.evaluated.get(id);
    const s = this.screened.get(id);
    const shell = e?.shell ?? s?.shell ?? this.shell(id)?.shell;
    const name = shell ? spaceName(shell) : id;
    const named = shell && (reason.includes(name) || reason.includes(displayName(shell.name))) ? reason : `${name}: ${lowerFirst(reason)}`;
    const evidence: Evidence[] = [
      ...(e?.rules ?? s?.flags ?? []).filter((r) => r.status === "fail").flatMap((r) => [...r.evidence].sort((a, b) => Number(b.source.startsWith("Vexcel")) - Number(a.source.startsWith("Vexcel")))),
      ...(e?.graph && (e.fit.hardFails.length || severe(this.counts(e))) ? [{ source: "matterport", ref: `${e.graph.sid} room graph`, confidence: 0.8 }] : []),
    ].filter((x, i, a) => a.findIndex((y) => y.ref === x.ref && y.source === x.source) === i);
    this.dropped.add(id);
    this.dropReasons.set(id, { reason: /[.!?]$/.test(named) ? named : `${named}.`, evidence });
    this.emit({ type: "drop", id: rid("ev"), shellId: id, reason: this.dropReasons.get(id)!.reason, evidence });
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
    // Concerns never lift a space over one with more of the rooms you need.
    const others = chosen.slice(1).filter((id) => countTier(this.counts(this.evaluated.get(id)!)) === countTier(this.counts(top)))
      .map((id) => ({ id, e: this.evaluated.get(id)!, c: concerns(this.spec, this.evaluated.get(id)!, site(id)) }));
    const clean = killer(mine) ? others.find((o) => !killer(o.c) && o.e.finalScore >= top.finalScore - 10) : undefined;
    const second = others[0];
    const alt = clean ?? (second && weight(mine) >= 3 && weight(second.c) + 2 <= weight(mine) && second.e.finalScore >= top.finalScore - 6 ? second : undefined);
    if (alt) {
      this.swappedFrom = top.shell.id;
      this.skepticWhy = { concerns: mine.map((c) => c.text), clean: !!clean, alt: alt.id };
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
  private skepticWhy: { concerns: string[]; clean: boolean; alt: string } | null = null;

  // Guardrail: for the top 2 finalists, a fixture you need (a sink in the exam rooms) that the scan hasn't confirmed
  // gets a closer look, whether or not the planner asked for one.
  private async lookCloser(chosen: string[]) {
    for (const id of chosen.slice(0, 2)) {
      const e = this.evaluated.get(id)!;
      if (!e.graph || this.inspections >= BUDGET.inspections) continue;
      const looked = new Set(e.escalations.flatMap((x) => (x.result ? FIXTURE_WORDS.filter((f) => x.question.toLowerCase().includes(f)) : [])));
      const f = unverifiedFixtures(this.spec, e).find((x) => !looked.has(x.toLowerCase()));
      if (!f) continue;
      const question = `Is there ${an(f)} in the ${fixtureRooms(this.spec, e, f) || "rooms you need"}?`;
      this.emit({ type: "handoff", id: rid("ev"), to: "inspector", shellIds: [id], why: `Hermit's rule: the Inspector looks closer at a finalist when a fixture you need isn't confirmed (${f} at ${spaceName(e.shell)})` });
      const t0 = Date.now();
      const r = await this.inspect(id, question);
      this.emit({ type: "tool", id: rid("ev"), tool: "inspect_view", args: { shellId: id, question }, resultId: rid("inspect_view"), summary: r.summary, ms: Date.now() - t0 });
    }
  }

  private async submit(ids: string[]) {
    if (this.deps.research && !this.researched) {
      const t0 = Date.now();
      const r = await this.research();
      this.emit({ type: "tool", id: rid("ev"), tool: "research_regulations", args: {}, resultId: rid("research_regulations"), summary: r.summary, ms: Date.now() - t0 });
    }
    // Guardrail: a specialist with veto power that the user's needs call for reviews every finalist, whatever the planner chose.
    const guard = (list: string[]) => { for (const agent of ["code", "access"] as const) {
      if (!needsAgent(agent, this.userSpec).needed) continue;
      const missed = list.filter((id) => this.evaluated.has(id) && !this.dropped.has(id) && !this.evaluated.get(id)!.verdicts.some((v) => v.agent === agent));
      if (!missed.length) continue;
      this.emit({ type: "handoff", id: rid("ev"), to: agent, shellIds: missed, why: `Hermit's rule: ${AGENTS[agent].name} reviews every finalist before a report goes out` });
      for (const id of missed) this.verdict(consult(agent, this.spec, this.evaluated.get(id)!), this.evaluated.get(id)!);
    } };
    guard(ids);
    this.enforceCounts();
    // The planner picks which spaces to report; rank follows room counts, then the evidence score.
    const picked = ids.filter((id) => this.evaluated.has(id) && !this.dropped.has(id));
    // Short spaces kept only because fewer than 3 would remain still go out, last, saying what's missing.
    if (picked.length < 3) picked.push(...[...this.evaluated.values()]
      .filter((e) => !this.dropped.has(e.shell.id) && !picked.includes(e.shell.id) && severe(this.counts(e)))
      .sort(this.byRoomFit).slice(0, 3 - picked.length).map((e) => e.shell.id));
    guard(picked);
    const rank = (list: string[]) => list.filter((id) => !this.dropped.has(id)).sort((a, b) => this.byRoomFit(this.evaluated.get(a)!, this.evaluated.get(b)!));
    await this.lookCloser(rank(picked));
    const chosen = rank(picked).slice(0, 5);
    if (ids.length && !chosen.length && !ids.some((id) => this.vetoes.has(id))) throw new Error(`none of ${ids.join(", ")} were evaluated (or all were dropped/vetoed); call evaluate_candidates first`);
    for (const id of chosen) {
      const e = this.evaluated.get(id)!;
      for (const a of ["estimator", "advocate"] as const) if (!e.verdicts.some((v) => v.agent === a)) e.verdicts.push(consult(a, this.spec, e));
      // The Surveyor's aerial read goes on every report, consulted or not, so the Above evidence is never missing.
      if (!e.verdicts.some((v) => v.agent === "surveyor")) e.verdicts.push(consult("surveyor", this.spec, e));
    }
    this.skeptic(chosen);
    this.reports = chosen.map((id, i) => { const e = this.evaluated.get(id)!; return buildReport(this.spec, e, i + 1, this.regulations, e.shell.sid && this.deps.site ? this.deps.site(e.shell.sid) : null); });
    const first = this.candidates[0];
    if (first && chosen[0] && chosen[0] !== first.shell.id) {
      const { reason, evidence } = this.whyTop(first.shell.id, chosen[0]);
      this.emit({ type: "rerank", id: rid("ev"), order: chosen, reason, evidence });
    }
    return { result: { reports: this.reports.length }, summary: `${this.reports.length} Shell Reports` };
  }

  // Why the top pick isn't the Scout's first pick, quoting the evidence that decided it.
  private whyTop(firstId: string, topId: string): { reason: string; evidence: Evidence[] } {
    const top = this.evaluated.get(topId)!;
    const topName = spaceName(top.shell), scout = this.nameOf(firstId);
    const firstEval = this.evaluated.get(firstId);
    const veto = this.vetoes.get(firstId);
    const dropped = this.dropReasons.get(firstId);
    if (this.swappedFrom === firstId && this.skepticWhy)
      return { reason: `Changed the top pick: ${this.skepticWhy.concerns[0].replace(/\.$/, "")} at ${scout}. ${topName} has ${this.skepticWhy.clean ? "no competitor on its block" : "fewer red flags"}.`, evidence: [{ source: "Skeptic", ref: this.skepticWhy.concerns.join(" | "), confidence: 0.5 }] };
    if (veto)
      return { reason: `Changed the top pick: ${AGENTS[veto.agent].name} ruled out ${scout} (${lowerFirst(veto.headline.replace(/\.$/, ""))}).`, evidence: veto.claims.flatMap((c) => c.evidence).slice(0, 4) };
    if (dropped)
      return { reason: `Changed the top pick: ${dropped.reason.startsWith(scout) ? `${scout} was dropped (${lowerFirst(dropped.reason.slice(scout.length + 2).replace(/\.$/, ""))})` : `${scout} was dropped (${lowerFirst(dropped.reason.replace(/\.$/, ""))})`}.`, evidence: dropped.evidence };
    if (!firstEval)
      return { reason: `Changed the top pick: ${scout} ranked first on the record search, but its rooms were never walked; ${topName} is the best of the spaces Hermit walked.`, evidence: [] };
    // Looked closer: a fixture you need is visible at the top pick but not confirmed at the Scout's pick.
    for (const c of top.checks ?? []) {
      if (c.result !== "seen") continue;
      // The Scout's pick may not have been inspected this run: read its saved photo checks for the same rooms.
      let theirs = (firstEval.checks ?? []).filter((x) => x.feature === c.feature);
      if (!theirs.length && firstEval.graph) theirs = this.targets(firstEval, c.feature.toLowerCase(), [])
        .flatMap((t) => { const k = (this.deps.panoCheck ?? loadPanoCheck)(firstEval.graph!.sid, t.roomId, c.feature); return k ? [k] : []; });
      if (theirs.some((x) => x.result === "seen")) continue;
      const room = this.spec.rooms.find((r) => r.fixtures?.some((f) => f.toLowerCase() === c.feature.toLowerCase()))?.label ?? "room";
      const what = `${room.replace(/ /g, "-")} ${plural(c.feature)}`;
      const seenRefs = (top.checks ?? []).filter((x) => x.feature === c.feature && x.result === "seen");
      const not = theirs.some((x) => x.result === "not_seen");
      const why = !theirs.length ? "weren't looked at" : not ? "aren't there in its photos" : "couldn't be confirmed";
      return {
        reason: `Changed the top pick: ${topName}'s ${what} are visible in the scan photos; ${scout}'s ${why}${!not && theirs[0]?.note ? ` (${lowerFirst(theirs[0].note.replace(/\.$/, ""))})` : ""}.`,
        evidence: [...seenRefs, ...theirs].map((x) => ({ source: "Matterport scan photo", ref: x.panoId ? `pano:${x.panoId} face ${x.face ?? "?"}` : `${x.sid}/${x.roomId} (no photo inside the room)`, confidence: x.confidence })),
      };
    }
    const a = this.counts(top), b = this.counts(firstEval);
    const miss = (c: typeof a) => c.reduce((s, x) => s + missingOf(x), 0);
    if (countTier(a) < countTier(b) || miss(a) < miss(b)) {
      const short = shortfalls(this.spec, b)[0] ?? countLine(this.spec, b);
      return { reason: `Changed the top pick: ${topName} has more of the rooms you need already built (${countLine(this.spec, a)}); ${scout}: ${lowerFirst(short)}.`, evidence: [top.graph, firstEval.graph].flatMap((g) => (g ? [{ source: "matterport", ref: `${g.sid} room graph`, confidence: 0.8 }] : [])) };
    }
    const gap = top.lines.filter((l) => l.max > 0).map((l) => ({ l, o: firstEval.lines.find((x) => x.factor === l.factor) })).filter((x) => x.o)
      .sort((x, y) => (y.l.earned - y.o!.earned) - (x.l.earned - x.o!.earned))[0];
    if (gap && gap.l.earned > gap.o!.earned)
      return { reason: `Changed the top pick: ${topName} scores higher on ${gap.l.factor.toLowerCase()} (${gap.l.note}) than ${scout} (${gap.o!.note}).`, evidence: [{ source: gap.l.source, ref: gap.l.note, confidence: 0.6 }, { source: gap.o!.source, ref: gap.o!.note, confidence: 0.6 }] };
    const pen = firstEval.lines.filter((l) => l.earned < 0).sort((x, y) => x.earned - y.earned)[0];
    return { reason: `Changed the top pick: ${scout} lost points for ${pen ? `${lowerFirst(pen.factor)} (${pen.note})` : "its evidence"}; ${topName} scored ${top.finalScore} vs ${firstEval.finalScore}.`, evidence: pen ? [{ source: pen.source, ref: pen.note, confidence: 0.5 }] : [] };
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
      const names = demoted.map((r) => this.nameOf(r.shellId));
      this.emit({ type: "rerank", id: rid("ev"), order: this.reports.map((r) => r.shellId), reason: `The verifier moved ${list(names)} to the bottom: ${lowerFirst(demoted[0].verification!.issues[0])}.`, evidence: demoted[0].rules.filter((h) => h.status === "fail").flatMap((h) => h.evidence).slice(0, 4) });
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
  const missing = ids.filter((id) => !run.evaluated.has(id) && !run.dropped.has(id));
  if (missing.length) await run.evaluateQuietly(missing);
  return run.call("submit_reports", { shellIds: ids.filter((id) => run.evaluated.has(id) && !run.dropped.has(id)) });
}

const FIXTURE_WORDS = ["sink", "toilet", "shower", "bathtub", "tub", "hood", "drain", "range", "stove", "oven", "refrigerator", "dishwasher", "washer", "dryer", "elevator", "ramp"];
const ROOM_WORDS = ["bathroom", "restroom", "kitchen", "office", "bedroom", "reception", "conference", "storage", "utility", "garage", "exam"];

// Fixtures the spec asks for in a matched room that neither the room type, Matterport's tags nor a scan photo shows.
export function unverifiedFixtures(spec: RequirementSpec, e: Evaluation): string[] {
  if (!e.graph) return [];
  const g = seenGraph(e);
  const out = new Set<string>();
  for (const a of e.fit.assignment) {
    if (!a.roomId) continue;
    const req = spec.rooms.find((r) => a.req === r.label || a.req.startsWith(`${r.label} #`));
    const room = g.rooms.find((r) => r.id === a.roomId)!;
    const have = new Set([...(IMPLIED_FIXTURES[room.label] ?? []), ...g.objects.filter((o) => o.roomId === room.id).map((o) => o.label.toLowerCase())]);
    for (const f of req?.fixtures ?? []) if (!have.has(f.toLowerCase())) out.add(f);
  }
  return [...out];
}

// "the exam rooms": the requested rooms where this fixture is still unconfirmed, for a plain question.
export function fixtureRooms(spec: RequirementSpec, e: Evaluation, f: string): string {
  if (!e.graph) return "";
  const g = seenGraph(e);
  const labels = new Set<string>();
  for (const a of e.fit.assignment) {
    const req = spec.rooms.find((r) => a.req === r.label || a.req.startsWith(`${r.label} #`));
    const room = a.roomId ? g.rooms.find((r) => r.id === a.roomId) : undefined;
    if (!req?.fixtures?.includes(f) || !room) continue;
    const have = new Set([...(IMPLIED_FIXTURES[room.label] ?? []), ...g.objects.filter((o) => o.roomId === room.id).map((o) => o.label.toLowerCase())]);
    if (!have.has(f.toLowerCase())) labels.add(req.count > 1 ? plural(req.label) : req.label);
  }
  return list([...labels]);
}

// The room graph plus every fixture a scan photo showed ("seen"), for fitting only; the report keeps the measured graph.
function seenGraph(e: Evaluation): RoomGraph {
  const seen = [...(e.seen ?? []), ...(e.checks ?? [])].filter((c) => c.result === "seen");
  return seen.length ? { ...e.graph!, objects: [...e.graph!.objects, ...seen.map((c) => ({ label: c.feature.toLowerCase(), roomId: c.roomId, confidence: c.confidence }))] } : e.graph!;
}

// Bedrooms and baths typed as numbers override the pack's counts (0 = none required, e.g. a studio); a half bath is
// still a room.
function withRecordCounts(spec: RequirementSpec, rooms: RoomReq[]): RoomReq[] {
  let out = rooms;
  const set = (match: (label: string) => boolean, label: string, n: number | undefined) => {
    if (n == null) return;
    const first = out.find((r) => match(r.label));
    out = out.filter((r) => !match(r.label));
    if (n > 0) out.push({ ...(first ?? { hard: false }), label: first?.label ?? label, count: n });
  };
  set(isBathroom, "bathroom", spec.baths == null ? undefined : Math.ceil(spec.baths));
  set((l) => normalizeRoomLabel([l]) === "bedroom", "bedroom", spec.beds);
  return out;
}

// Evidence score lines, blended 50/50 with layout similarity when the user drew a plan.
function rescore(e: Evaluation) {
  const base = total(e.lines);
  e.finalScore = e.similarity ? Math.round(base * 0.5 + e.similarity.score * 0.5) : base;
}

export const newEventId = () => rid("ev");
