import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AGENTS } from "../crew";
import { cleanWording } from "../llm/wording";
import type { RequirementSpec, TraceEvent } from "../types";
import { displayName } from "./report";
import { BUDGET, finalize, newEventId, Run, TOOL_DESCRIPTIONS, ToolInputs, unverifiedFixtures, type AgentDeps, type ToolName } from "./tools";
import { MODEL } from "./model";
import { outputText, type OpenAIClient, type ResponseItem } from "../llm/openai";
import { cleanSchema, geminiJson, geminiText, type GeminiClient, type GeminiContent } from "../llm/gemini";
import { AUDIT_PROMPT, AUDIT_SCHEMA, type AuditResult, type Auditor } from "./verify";
import { an } from "../text";

export type { AgentDeps };

type Client = Pick<Anthropic, "beta">;
type Opts = { client?: Client | null; gemini?: GeminiClient | null; openai?: OpenAIClient | null };

export async function runAgent(spec: RequirementSpec, emit: (e: TraceEvent) => void, deps: AgentDeps, opts: Opts = {}) {
  const client = opts.client !== undefined ? opts.client : process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  const run = new Run(spec, emit, deps);
  let planner: "claude" | "gemini" | "openai" | "deterministic" = "deterministic";
  const llm = client ? { name: "claude" as const, label: "Claude", go: () => claudeLoop(run, client), audit: claudeAudit(client) }
    : opts.gemini ? { name: "gemini" as const, label: "Gemini", go: () => geminiLoop(run, opts.gemini!), audit: geminiAudit(opts.gemini) }
    : opts.openai ? { name: "openai" as const, label: "OpenAI", go: () => openaiLoop(run, opts.openai!), audit: openaiAudit(opts.openai) } : null;
  if (llm) {
    run.audit = llm.audit;
    try {
      await llm.go();
      planner = llm.name;
    } catch (e) {
      run.audit = null;
      emit({ type: "error", id: newEventId(), message: `${llm.label} planner failed (${e instanceof Error ? e.message : e}); the crew finishes deterministically.` });
    }
  }
  if (!run.reports) await deterministic(run);
  emit({ type: "report", id: newEventId(), reports: run.reports ?? [] });
  emit({ type: "done", id: newEventId(), ms: Date.now() - run.started, toolCalls: run.calls, planner });
  return run.reports ?? [];
}

const alive = (run: Run) => [...run.evaluated.values()].filter((e) => !run.dropped.has(e.shell.id));
const ordered = (run: Run) => alive(run).sort((a, b) => run.byRoomFit(a, b) || a.shell.id.localeCompare(b.shell.id));
const plan = (run: Run, text: string) => run.emit({ type: "plan", id: newEventId(), text: cleanWording(text) });

// One fixable code gap is priced as work; a zoning conflict or stacked gaps rule a candidate out.
const dealbreaker = (failedRules: string[]) => failedRules.includes("zoning") || failedRules.length >= 2;

// The fallback planner: the same tools and vetoes, in a fixed but evidence-driven order.
async function deterministic(run: Run) {
  const city = run.spec.city === "houston" ? "Houston" : "Los Angeles";
  const fresh = !run.candidates.length;
  if (fresh) {
    plan(run, `Scout searches every scan for ${an(run.spec.useType)} in ${city}. Then the Inspector walks the best ${BUDGET.roomGraphs}, Code${run.spec.needs.wheelchair || run.spec.needs.stepFree ? ", Access" : ""} and Systems review what's left, and the best 5 are audited against your must-haves.`);
    await run.call("search_shells", {});
    if (run.spec.layout?.length && !run.overBudget()) await run.call("match_layout", {});
  }
  if (!run.candidates.length) return finalize(run, []);
  const top20 = run.candidates.slice(0, 20).map((c) => c.shell.id).filter((id) => !run.dropped.has(id));
  if (top20.length && !run.screened.size && !run.overBudget()) {
    const s = (await run.call("screen_sites", { shellIds: top20 })) as { rows: { id: string; dropped: boolean; fails: string[] }[] };
    const drops = s.rows.flatMap((r) => (!r.dropped && dealbreaker(r.fails.map((f) => f.split(":")[0])) ? [{ shellId: r.id, reason: r.fails.join("; ") }] : []));
    if (drops.length && !run.overBudget()) await run.call("drop_candidate", { drops });
  }

  if (!run.evaluated.size && !run.overBudget()) {
    const next = run.candidates.map((c) => c.shell.id).filter((id) => !run.dropped.has(id)).slice(0, 8);
    if (next.length) {
      const ev = (await run.call("evaluate_candidates", { shellIds: next })) as { rows: { id: string; dropped: boolean; hardFails: string[]; ruleFails: string[] }[] };
      const drops = ev.rows.flatMap((r) => {
        if (r.dropped) return [];
        const why = r.hardFails[0] ?? (dealbreaker(r.ruleFails) ? `fails ${r.ruleFails.join(", ")} screen` : null);
        return why ? [{ shellId: r.id, reason: why }] : [];
      });
      if (drops.length && !run.overBudget()) await run.call("drop_candidate", { drops });
    }
  }

  const ids = () => alive(run).map((e) => e.shell.id);
  for (const agent of ["code", "access", "systems"] as const) {
    if (run.consulted.has(agent) || run.overBudget() || !ids().length) continue;
    if (!run.handoffNeeded(agent)) { run.handoff(agent, ids()); run.consulted.add(agent); continue; }
    await run.call("consult_specialist", { agent, shellIds: ids() });
  }

  for (const e of ordered(run).slice(0, 2)) {
    if (run.inspections >= BUDGET.inspections || run.overBudget() || e.escalations.length) continue;
    const asks = [
      ...e.fit.unknowns.map((u) => `Is there ${an(u.split(":")[0].replace(/ #\d+$/, ""))} in the scanned space?`),
      ...e.fit.edits.flatMap((x) => { const m = x.match(/^Add (.+?) to (.+)$/); return m ? [`Does the ${m[2].replace(/ #\d+$/, "")} have ${an(m[1])}?`] : []; }),
      ...unverifiedFixtures(run.spec, e).map((f) => {
        const rooms = run.spec.rooms.filter((r) => r.fixtures?.includes(f)).map((r) => (r.count > 1 ? `${r.label}s` : r.label));
        return `Is there ${an(f)} in the ${rooms.join(" or ") || "requested rooms"}?`;
      }),
    ];
    if (asks[0]) {
      plan(run, `${displayName(e.shell.name)} is a contender, but one fact could move it: ${asks[0].replace(/\?$/, "")}. The Inspector takes a closer look.`);
      await run.call("inspect_view", { shellId: e.shell.id, question: asks[0] });
    }
  }

  if (!run.consulted.has("surveyor") && !run.overBudget() && ids().length) await run.call("consult_specialist", { agent: "surveyor", shellIds: ordered(run).slice(0, 5).map((e) => e.shell.id) });

  const final = ordered(run);
  if (run.canResearch && !run.researched && !run.overBudget()) await run.call("research_regulations", {});
  const picks = final.length ? final.slice(0, 5).map((e) => e.shell.id) : run.candidates.filter((c) => !run.dropped.has(c.shell.id)).slice(0, 5).map((c) => c.shell.id);
  await finalize(run, picks);
}

const SYSTEM = `You are the planner for Hermit's crew. Hermit finds existing spaces already built for the user's RequirementSpec and shows the work left.
Your crew: ${Object.entries(AGENTS).map(([k, a]) => `${a.name} (${k}) ${a.does}`).join("; ")}.
Work from evidence; tools compute geometry, rules and costs. Never invent measurements, compliance or availability. Null fields are unknown, not passes.
Plan cost-aware: search_shells first (regulation research starts automatically); match_layout right after if the spec has a drawn layout; screen_sites (cheap) on up to 20; evaluate_candidates (expensive, max ${BUDGET.roomGraphs}) on the highest-ranked search results in rank order, skipping only ones screening already ruled out; consult_specialist only where the user's needs make that specialist matter (Access only if they need step-free access); inspect_view only when one uncertain fact could change the ranking (max ${BUDGET.inspections}).
Must-haves the user selected are enforced in code: a candidate whose record fails one is dropped automatically (rows show dropped: true); don't submit those. Unknown is not a fail. Required room counts (bathrooms, and the use's primary rooms such as exam rooms, offices or bedrooms) are the top priority: a space with every count met always ranks above one without; evaluate rows show the counts (rooms) and shortfalls (missing). Quote those counts exactly and never call an unconfirmed room present. A specialist veto is binding. When a veto removes the leading candidate, say so. Finish with submit_reports (≤5 ids, best first); an independent verifier then audits them. Budget: ${BUDGET.toolCalls} tool calls.
Before each tool call, write one short sentence saying what you're checking and why.`;

const toolList = () => (Object.keys(ToolInputs) as ToolName[]).map((name) => ({ name, description: TOOL_DESCRIPTIONS[name], schema: z.toJSONSchema(ToolInputs[name]) }));

async function claudeLoop(run: Run, client: Client) {
  const tools = toolList().map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as Anthropic.Beta.BetaTool["input_schema"] }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `RequirementSpec:\n${JSON.stringify(run.userSpec)}` }];
  while (!run.reports && !run.overBudget()) {
    const res = await client.beta.messages.create({
      model: MODEL, max_tokens: 4096, system: SYSTEM, tools, messages,
      output_config: { effort: "medium" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    });
    messages.push({ role: "assistant", content: res.content });
    for (const b of res.content) if (b.type === "text" && b.text.trim()) plan(run, b.text.trim());
    if (res.stop_reason !== "tool_use") break;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      try {
        if (!(b.name in ToolInputs)) throw new Error(`unknown tool ${b.name}`);
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(await run.call(b.name as ToolName, b.input)) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: b.id, content: String(e instanceof Error ? e.message : e), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
}

// Same tools, same Run.call dispatch and budgets, through the OpenAI Responses API (function tools, stateless: full input each turn).
async function openaiLoop(run: Run, client: OpenAIClient) {
  const tools = (Object.keys(ToolInputs) as ToolName[]).map((name) => ({
    type: "function", name, description: TOOL_DESCRIPTIONS[name], parameters: z.toJSONSchema(ToolInputs[name]), strict: false,
  }));
  const input: ResponseItem[] = [{ type: "message", role: "user", content: `RequirementSpec:\n${JSON.stringify(run.userSpec)}` }];

  while (!run.reports && !run.overBudget()) {
    const { output } = await client.respond({ instructions: SYSTEM, tools, input, reasoning: { effort: "low" } });
    input.push(...output);
    const text = outputText(output);
    if (text) plan(run, text);
    const calls = output.filter((o) => o.type === "function_call") as (ResponseItem & { call_id: string; name: string; arguments: string })[];
    if (!calls.length) break;
    for (const c of calls) {
      let out: string;
      try {
        if (!(c.name in ToolInputs)) throw new Error(`unknown tool ${c.name}`);
        out = JSON.stringify(await run.call(c.name as ToolName, JSON.parse(c.arguments || "{}")));
      } catch (e) {
        out = `Error: ${e instanceof Error ? e.message : e}`;
      }
      input.push({ type: "function_call_output", call_id: c.call_id, output: out });
    }
  }
}

// Same tools and Run.call dispatch through Gemini function calling. Model turns go back verbatim (thought signatures included).
async function geminiLoop(run: Run, client: GeminiClient) {
  const functionDeclarations = (Object.keys(ToolInputs) as ToolName[]).map((name) => ({
    name, description: TOOL_DESCRIPTIONS[name], parametersJsonSchema: cleanSchema(z.toJSONSchema(ToolInputs[name])),
  }));
  const contents: GeminiContent[] = [{ role: "user", parts: [{ text: `RequirementSpec:\n${JSON.stringify(run.userSpec)}` }] }];

  while (!run.reports && !run.overBudget()) {
    const turn = await client.generate({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ functionDeclarations }] });
    contents.push(turn);
    const text = geminiText(turn);
    if (text) plan(run, text);
    const calls = turn.parts.flatMap((p) => (p.functionCall ? [p.functionCall] : []));
    if (!calls.length) break;
    const parts = [];
    for (const c of calls) {
      let response: object;
      try {
        if (!(c.name in ToolInputs)) throw new Error(`unknown tool ${c.name}`);
        response = { result: await run.call(c.name as ToolName, c.args ?? {}) };
      } catch (e) {
        response = { error: e instanceof Error ? e.message : String(e) };
      }
      parts.push({ functionResponse: { ...(c.id ? { id: c.id } : {}), name: c.name, response } });
    }
    contents.push({ role: "user", parts });
  }
}

// Independent verifier: a fresh call with its own auditor prompt and none of the planner's conversation.
const json = (t: string) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as AuditResult;
const claudeAudit = (client: Client): Auditor => ({
  name: "Claude",
  audit: async (prompt) => {
    const res = await client.beta.messages.create({ model: MODEL, max_tokens: 2048, system: AUDIT_PROMPT, messages: [{ role: "user", content: prompt }], output_config: { effort: "low" } });
    return json(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  },
});
const geminiAudit = (g: GeminiClient): Auditor => ({ name: "Gemini", audit: async (prompt) => (await geminiJson(g, AUDIT_PROMPT, [{ text: prompt }], AUDIT_SCHEMA)) as AuditResult });
const openaiAudit = (c: OpenAIClient): Auditor => ({
  name: "OpenAI",
  audit: async (prompt) => json(outputText((await c.respond({
    instructions: AUDIT_PROMPT, input: [{ type: "message", role: "user", content: prompt }], reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: "audit", schema: AUDIT_SCHEMA, strict: false } },
  })).output)),
});
