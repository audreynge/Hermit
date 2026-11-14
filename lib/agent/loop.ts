import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AGENTS } from "../crew";
import { cleanSchema, generate, hasGemini, type Content, type Part } from "../llm/gemini";
import { cleanWording } from "../llm/wording";
import type { RequirementSpec, TraceEvent } from "../types";
import { displayName } from "./report";
import { BUDGET, finalize, newEventId, Run, TOOL_DESCRIPTIONS, ToolInputs, unverifiedFixtures, type AgentDeps, type ToolName } from "./tools";
import { MODEL } from "./model";

export type { AgentDeps };

type Client = Pick<Anthropic, "beta">;
type Opts = { client?: Client | null; gemini?: boolean };
type Planner = "claude" | "gemini" | "deterministic";

export async function runAgent(spec: RequirementSpec, emit: (e: TraceEvent) => void, deps: AgentDeps, opts: Opts = {}) {
  const client = opts.client !== undefined ? opts.client : process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  const useGemini = opts.gemini ?? (opts.client === undefined && hasGemini());
  const run = new Run(spec, emit, deps);
  let planner: Planner = "deterministic";
  try {
    if (client) { await claudeLoop(run, client); planner = "claude"; }
    else if (useGemini) { await geminiLoop(run); planner = "gemini"; }
  } catch (e) {
    emit({ type: "error", id: newEventId(), message: `${client ? "Claude" : "Gemini"} planner failed (${e instanceof Error ? e.message : e}); the crew finishes deterministically.` });
  }
  if (!run.reports) await deterministic(run);
  emit({ type: "report", id: newEventId(), reports: run.reports ?? [] });
  emit({ type: "done", id: newEventId(), ms: Date.now() - run.started, toolCalls: run.calls, planner });
  return run.reports ?? [];
}

const alive = (run: Run) => [...run.evaluated.values()].filter((e) => !run.dropped.has(e.shell.id));
const ordered = (run: Run) => alive(run).sort((a, b) => b.finalScore - a.finalScore || a.shell.id.localeCompare(b.shell.id));
const plan = (run: Run, text: string) => run.emit({ type: "plan", id: newEventId(), text: cleanWording(text) });

// One fixable code gap is priced as work; a zoning conflict or stacked gaps rule a candidate out.
const dealbreaker = (failedRules: string[]) => failedRules.includes("zoning") || failedRules.length >= 2;

// The fallback planner: the same tools and vetoes, in a fixed but evidence-driven order.
async function deterministic(run: Run) {
  const city = run.spec.city === "houston" ? "Houston" : "Los Angeles";
  if (!run.candidates.length) {
    plan(run, `Scout searches every scan for a ${run.spec.useType} in ${city}. Then the Inspector walks the best ${BUDGET.roomGraphs}, and Code${run.spec.needs.wheelchair || run.spec.needs.stepFree ? ", Access" : ""} and Systems review what's left.`);
    await run.call("search_shells", {});
  }
  if (!run.candidates.length) return finalize(run, []);

  if (!run.screened.size && !run.overBudget()) {
    const top20 = run.candidates.slice(0, 20).map((c) => c.shell.id).filter((id) => !run.dropped.has(id));
    const s = (await run.call("screen_sites", { shellIds: top20 })) as { rows: { id: string; fails: string[] }[] };
    const drops = s.rows.flatMap((r) => (dealbreaker(r.fails.map((f) => f.split(":")[0])) ? [{ shellId: r.id, reason: r.fails.join("; ") }] : []));
    if (drops.length && !run.overBudget()) await run.call("drop_candidate", { drops });
  }

  if (!run.evaluated.size && !run.overBudget()) {
    const next = run.candidates.map((c) => c.shell.id).filter((id) => !run.dropped.has(id)).slice(0, BUDGET.roomGraphs);
    if (next.length) await run.call("evaluate_candidates", { shellIds: next });
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
      ...e.fit.unknowns.map((u) => `Is there a ${u.split(":")[0].replace(/ #\d+$/, "")} in the scanned space?`),
      ...e.fit.edits.flatMap((x) => { const m = x.match(/^Add (.+?) to (.+)$/); return m ? [`Does the ${m[2].replace(/ #\d+$/, "")} have a ${m[1]}?`] : []; }),
    ];
    if (asks[0]) {
      plan(run, `${displayName(e.shell.name)} is a contender, but one fact could move it: ${asks[0].replace(/\?$/, "")}. The Inspector takes a closer look.`);
      await run.call("inspect_view", { shellId: e.shell.id, question: asks[0] });
    }
  }

  if (!run.consulted.has("surveyor") && !run.overBudget() && ids().length) await run.call("consult_specialist", { agent: "surveyor", shellIds: ordered(run).slice(0, 5).map((e) => e.shell.id) });

  const final = ordered(run);
  const picks = final.length ? final.slice(0, 5).map((e) => e.shell.id) : run.candidates.filter((c) => !run.dropped.has(c.shell.id)).slice(0, 5).map((c) => c.shell.id);
  await finalize(run, picks);
}

const SYSTEM = `You are the planner for Hermit's crew. Hermit finds existing spaces already built for the user's RequirementSpec and shows the work left.
Your crew: ${Object.entries(AGENTS).map(([k, a]) => `${a.name} (${k}) ${a.does}`).join("; ")}.
Work from evidence; tools compute geometry, rules and costs. Never invent measurements, compliance or availability. Null fields are unknown, not passes.
Plan cost-aware: search_shells first; screen_sites (cheap) on up to 20; evaluate_candidates (expensive, max ${BUDGET.roomGraphs}) on the highest-ranked search results in rank order, skipping only ones screening already ruled out; consult_specialist only where the user's needs make that specialist matter (Access only if they need step-free access); inspect_view only when one uncertain fact could change the ranking (max ${BUDGET.inspections}).
A specialist veto is binding. When a veto removes the leading candidate, say so. Finish with submit_reports (≤5 ids, best first). Budget: ${BUDGET.toolCalls} tool calls.
Before each tool call, write one short sentence saying what you're checking and why.`;

const toolList = () => (Object.keys(ToolInputs) as ToolName[]).map((name) => ({ name, description: TOOL_DESCRIPTIONS[name], schema: z.toJSONSchema(ToolInputs[name]) }));

async function geminiLoop(run: Run) {
  const tools = [{ functionDeclarations: toolList().map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: cleanSchema(t.schema) })) }];
  const contents: Content[] = [{ role: "user", parts: [{ text: `RequirementSpec:\n${JSON.stringify(run.userSpec)}` }] }];
  for (let turn = 0; turn < 14 && !run.reports && !run.overBudget(); turn++) {
    const { parts } = await generate({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools, generationConfig: { temperature: 0.2 } }, 15_000);
    if (!parts.length) break;
    contents.push({ role: "model", parts });
    for (const p of parts) if (p.text?.trim()) plan(run, p.text.trim());
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) break;
    const responses: Part[] = [];
    for (const p of calls) {
      const { name, args, id } = p.functionCall!;
      let response: Record<string, unknown>;
      try {
        if (!(name in ToolInputs)) throw new Error(`unknown tool ${name}`);
        response = { result: await run.call(name as ToolName, args ?? {}) };
      } catch (e) {
        response = { error: e instanceof Error ? e.message : String(e) };
      }
      responses.push({ functionResponse: { name, response, ...(id ? { id } : {}) } });
    }
    contents.push({ role: "user", parts: responses });
  }
}

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
