import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { RequirementSpec, TraceEvent } from "../types";
import { BUDGET, finalize, newEventId, Run, TOOL_DESCRIPTIONS, ToolInputs, unverifiedFixtures, type AgentDeps, type ToolName } from "./tools";

export type { AgentDeps };
import { MODEL } from "./model";
import { outputText, type OpenAIClient, type ResponseItem } from "../llm/openai";
import { geminiText, type GeminiClient, type GeminiContent } from "../llm/gemini";
import { an } from "../text";

type Client = Pick<Anthropic, "beta">;
type Opts = { client?: Client | null; gemini?: GeminiClient | null; openai?: OpenAIClient | null };

export async function runAgent(spec: RequirementSpec, emit: (e: TraceEvent) => void, deps: AgentDeps, opts: Opts = {}) {
  const client = opts.client !== undefined ? opts.client : process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  const run = new Run(spec, emit, deps);
  let planner: "claude" | "gemini" | "openai" | "deterministic" = "deterministic";
  const llm = client ? { name: "claude" as const, label: "Claude", go: () => claudeLoop(run, client) }
    : opts.gemini ? { name: "gemini" as const, label: "Gemini", go: () => geminiLoop(run, opts.gemini!) }
    : opts.openai ? { name: "openai" as const, label: "OpenAI", go: () => openaiLoop(run, opts.openai!) } : null;
  if (llm) {
    try {
      await llm.go();
      planner = llm.name;
    } catch (e) {
      emit({ type: "error", id: newEventId(), message: `${llm.label} planner failed (${e instanceof Error ? e.message : e}); finishing deterministically.` });
    }
  }
  if (!run.reports) await deterministic(run);
  emit({ type: "report", id: newEventId(), reports: run.reports ?? [] });
  emit({ type: "done", id: newEventId(), ms: Date.now() - run.started, toolCalls: run.calls, planner });
  return run.reports ?? [];
}

const ordered = (run: Run) =>
  [...run.evaluated.values()].filter((e) => !run.dropped.has(e.shell.id)).sort((a, b) => b.finalScore - a.finalScore || a.shell.id.localeCompare(b.shell.id));

// One fixable code gap is priced as work; zoning conflicts or stacked gaps rule a candidate out.
const dealbreaker = (failedRules: string[]) => failedRules.includes("zoning") || failedRules.length >= 2;

async function deterministic(run: Run) {
  const fresh = !run.candidates.length;
  if (fresh) {
    run.emit({ type: "plan", id: newEventId(), text: `Search ${run.spec.city === "houston" ? "Houston" : "Los Angeles"} for ${an(run.spec.useType)}; screen 20 site records, measure up to ${BUDGET.roomGraphs} scans, verify uncertain fixtures, report the best 5.` });
    await run.call("search_shells", {});
    if (run.spec.layout?.length && !run.overBudget()) await run.call("match_layout", {});
  }
  if (!run.candidates.length) return finalize(run, []);
  const top20 = run.candidates.slice(0, 20).map((c) => c.shell.id).filter((id) => !run.dropped.has(id));
  if (top20.length && !run.screened.size && !run.overBudget()) {
    const s = (await run.call("screen_sites", { shellIds: top20 })) as { rows: { id: string; fails: string[] }[] };
    const drops = s.rows.flatMap((r) => (dealbreaker(r.fails.map((f) => f.split(":")[0])) ? [{ shellId: r.id, reason: r.fails.join("; ") }] : []));
    if (drops.length && !run.overBudget()) await run.call("drop_candidate", { drops });
  }
  if (!run.evaluated.size && !run.overBudget()) {
    const next = run.candidates.map((c) => c.shell.id).filter((id) => !run.dropped.has(id)).slice(0, 8);
    if (next.length) {
      const ev = (await run.call("evaluate_candidates", { shellIds: next })) as { rows: { id: string; hardFails: string[]; ruleFails: string[] }[] };
      const drops = ev.rows.flatMap((r) => {
        const why = r.hardFails[0] ?? (dealbreaker(r.ruleFails) ? `fails ${r.ruleFails.join(", ")} screen` : null);
        return why ? [{ shellId: r.id, reason: why }] : [];
      });
      if (drops.length && !run.overBudget()) await run.call("drop_candidate", { drops });
    }
  }

  for (const e of ordered(run).slice(0, 2)) {
    const asks = [
      ...e.fit.unknowns.map((u) => `Is there ${an(u.split(":")[0].replace(/ #\d+$/, ""))} in the scanned space?`),
      ...unverifiedFixtures(run.spec, e).map((f) => {
        const rooms = run.spec.rooms.filter((r) => r.fixtures?.includes(f)).map((r) => (r.count > 1 ? `${r.label}s` : r.label));
        return `Is there ${an(f)} in the ${rooms.join(" or ") || "requested rooms"}?`;
      }),
    ];
    for (const question of asks.slice(0, 1)) {
      if (run.inspections >= BUDGET.inspections || run.overBudget()) break;
      const res = (await run.call("inspect_view", { shellId: e.shell.id, question })) as { outcome: string };
      if (!res.outcome.startsWith("observed")) e.finalScore -= 3;
    }
  }

  const final = ordered(run);
  const searchOrder = run.candidates.map((c) => c.shell.id);
  if (final.length && searchOrder[0] !== final[0].shell.id) {
    run.emit({
      type: "rerank", id: newEventId(), order: final.slice(0, 5).map((e) => e.shell.id),
      reason: `Measured evidence moved ${final[0].shell.id} to the top (search leader ${searchOrder[0]} ${run.dropped.has(searchOrder[0]) ? "was dropped" : "scored lower after evaluation"}).`,
    });
  }
  if (run.canResearch && !run.researched && !run.overBudget()) await run.call("research_regulations", {});
  const picks = final.length ? final.slice(0, 5).map((e) => e.shell.id) : run.candidates.filter((c) => !run.dropped.has(c.shell.id)).slice(0, 5).map((c) => c.shell.id);
  await finalize(run, picks);
}

const SYSTEM = `You are Hermit's search planner. You find existing commercial or residential spaces that already fit the user's RequirementSpec and show what work is left.
Work from evidence. Tools compute geometry, rules and costs deterministically; never invent measurements, compliance, or availability.
Funnel: search_shells (top 50; regulation research starts automatically) -> match_layout if the spec has a drawn layout -> screen_sites on up to 20 -> evaluate_candidates on up to ${BUDGET.roomGraphs} promising ones -> inspect_view only when one uncertain fact could change the ranking (max ${BUDGET.inspections}) -> drop_candidate for anything with a documented hard conflict -> submit_reports with up to 5 ids in your final rank order.
Budget: at most ${BUDGET.toolCalls} tool calls. Batch independent ids into one call. Null record fields are unknown, not passes.
Before each tool call, say in one short sentence what you are checking and why.`;

async function claudeLoop(run: Run, client: Client) {
  const tools = (Object.keys(ToolInputs) as ToolName[]).map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    input_schema: z.toJSONSchema(ToolInputs[name]) as Anthropic.Beta.BetaTool["input_schema"],
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `RequirementSpec:\n${JSON.stringify(run.spec)}` },
  ];

  while (!run.reports && !run.overBudget()) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools,
      messages,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    messages.push({ role: "assistant", content: res.content });
    for (const b of res.content) if (b.type === "text" && b.text.trim()) run.emit({ type: "plan", id: newEventId(), text: b.text.trim() });
    if (res.stop_reason !== "tool_use") break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      try {
        if (!(b.name in ToolInputs)) throw new Error(`unknown tool ${b.name}`);
        const out = await run.call(b.name as ToolName, b.input);
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) });
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
  const input: ResponseItem[] = [{ type: "message", role: "user", content: `RequirementSpec:\n${JSON.stringify(run.spec)}` }];

  while (!run.reports && !run.overBudget()) {
    const { output } = await client.respond({ instructions: SYSTEM, tools, input, reasoning: { effort: "low" } });
    input.push(...output);
    const text = outputText(output);
    if (text) run.emit({ type: "plan", id: newEventId(), text });
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
    name, description: TOOL_DESCRIPTIONS[name], parametersJsonSchema: z.toJSONSchema(ToolInputs[name]),
  }));
  const contents: GeminiContent[] = [{ role: "user", parts: [{ text: `RequirementSpec:\n${JSON.stringify(run.spec)}` }] }];

  while (!run.reports && !run.overBudget()) {
    const turn = await client.generate({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ functionDeclarations }] });
    contents.push(turn);
    const text = geminiText(turn);
    if (text) run.emit({ type: "plan", id: newEventId(), text });
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
