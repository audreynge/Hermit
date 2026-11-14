// Hermit MCP server (stdio). Lets Gemini CLI (or any MCP client) act as Hermit's planner: it calls the same tool
// registry (Run.call) the in-app agent uses, with the same budgets and evidence rules. Run: npx tsx mcp/hermit-server.ts
// stdout is the protocol channel — never console.log here; diagnostics go to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runAgent } from "../lib/agent/loop";
import { newRunId, saveRun } from "../lib/agent/replay";
import { Run, TOOL_DESCRIPTIONS, ToolInputs, type ToolName } from "../lib/agent/tools";
import { loadRoomGraph, searchCandidates } from "../lib/query/load";
import { similarScans } from "../lib/similarity/layout";
import { parseText } from "../lib/spec/parse";
import { City, Mode, RequirementSpec, type ShellReport, type TraceEvent } from "../lib/types";

const deps = { shells: (s: RequirementSpec) => searchCandidates(s.city, s.mode === "home" ? ["home"] : ["business", "enterprise"]), graph: loadRoomGraph };
const runs = new Map<string, { run: Run; events: TraceEvent[]; seen: number }>();

const json = (x: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(x, null, 1) }] });
const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
// Reports carry full floor-plan polygons; a model needs the evidence, not the geometry.
const lean = (r: ShellReport) => ({ ...r, floorplan: r.floorplan ? { sid: r.floorplan.sid, totalAreaSqft: r.floorplan.totalAreaSqft, rooms: r.floorplan.rooms.length } : undefined, similarity: r.similarity && { ...r.similarity, layout: undefined } });

const server = new McpServer({ name: "hermit", version: "1.0.0" }, {
  instructions: "Hermit finds existing spaces in Houston or Los Angeles already built for a use. Flow: parse_request -> start_search -> search_shells -> (match_layout if a layout was drawn) -> screen_sites -> evaluate_candidates -> optional inspect_view/drop_candidate -> submit_reports. Or call find_spaces for the whole funnel in one step. Never invent measurements, compliance or availability; null fields are unknown.",
});

server.registerTool("parse_request", {
  description: "Turn a plain-English request (e.g. '1,500 sq ft dental clinic in Houston with 3 exam rooms and parking') into a Hermit RequirementSpec. Edit the spec if needed, then pass it to start_search or find_spaces.",
  inputSchema: { text: z.string().min(3).max(2000), city: City.optional(), mode: Mode.optional() },
}, async ({ text, city, mode }) => {
  try { return json(parseText(text, { ...(city ? { city } : {}), ...(mode ? { mode } : {}) })); } catch (e) { return fail(e); }
});

server.registerTool("find_spaces", {
  description: "Run Hermit's full search funnel for a RequirementSpec in one step (deterministic planner) and return up to 5 ranked Shell Reports with evidence, rule flags, work/cost ranges and unknowns. The trace is saved for replay in the app.",
  inputSchema: { spec: z.record(z.string(), z.unknown()).describe("RequirementSpec from parse_request") },
}, async ({ spec }) => {
  try {
    const s = RequirementSpec.parse(spec);
    const events: TraceEvent[] = [];
    const runId = newRunId();
    const reports = await runAgent(s, (e) => events.push(e), deps, { client: null, gemini: null, openai: null });
    await saveRun(runId, s, events);
    return json({ runId, replay: `/?replay=${runId}`, reports: reports.map(lean) });
  } catch (e) { return fail(e); }
});

server.registerTool("start_search", {
  description: "Start a step-by-step search you plan yourself. Returns a runId; pass it to the Hermit tools (search_shells, screen_sites, evaluate_candidates, ...). Budget: 25 tool calls, 8 room-graph evaluations, 4 inspections per run.",
  inputSchema: { spec: z.record(z.string(), z.unknown()).describe("RequirementSpec from parse_request") },
}, async ({ spec }) => {
  try {
    const s = RequirementSpec.parse(spec);
    const events: TraceEvent[] = [];
    const runId = newRunId();
    runs.set(runId, { run: new Run(s, (e) => events.push(e), deps), events, seen: 0 });
    return json({ runId, spec: s });
  } catch (e) { return fail(e); }
});

for (const name of Object.keys(ToolInputs) as ToolName[]) {
  server.registerTool(name, {
    description: `${TOOL_DESCRIPTIONS[name]} Requires runId from start_search.`,
    inputSchema: { runId: z.string(), ...ToolInputs[name].shape },
  }, async ({ runId, ...args }: { runId: string } & Record<string, unknown>) => {
    const r = runs.get(runId);
    if (!r) return fail(`unknown runId ${runId}; call start_search first`);
    try {
      // ponytail: the in-app 40 s wall-clock budget assumes a machine planner; a CLI user thinks between calls, so only the call-count budgets apply here.
      r.run.started = Date.now();
      const result = await r.run.call(name, args);
      const trace = r.events.slice(r.seen).filter((e) => e.type !== "tool");
      r.seen = r.events.length;
      if (name === "submit_reports" && r.run.reports) {
        r.events.push({ type: "report", id: `rep_${runId}`, reports: r.run.reports });
        await saveRun(runId, r.run.spec, r.events);
        return json({ runId, replay: `/?replay=${runId}`, reports: r.run.reports.map(lean) });
      }
      return json({ result, trace });
    } catch (e) { return fail(e); }
  });
}

const Block = z.object({ label: z.string().max(40), x: z.number().min(0).max(1000), y: z.number().min(0).max(1000), w: z.number().positive().max(500), h: z.number().positive().max(500) });
server.registerTool("similar_layouts", {
  description: "Rank real scanned floor plans by similarity to a drawn layout (rooms as rectangles in feet: label, x, y, w, h). scale 0.5-2 matches the drawing smaller/larger. Returns score, breakdown (program/adjacency/size/shape) and which drawn room paired with which scanned room.",
  inputSchema: { layout: z.array(Block).min(1).max(40), city: City, mode: Mode.default("business"), scale: z.number().min(0.25).max(4).default(1), limit: z.number().int().min(1).max(12).default(5) },
}, async ({ layout, city, mode, scale, limit }) => {
  try {
    const area = layout.reduce((s, b) => s + b.w * b.h, 0);
    const spec = RequirementSpec.parse({ mode, city, useType: "office", input: "layout", layout, sizeSqft: [area * scale, area * scale * 2] });
    const { results } = similarScans(spec, deps.shells(spec), loadRoomGraph);
    return json({ compared: results.length, results: results.slice(0, limit).map(({ candidate: { shell }, sim }) => ({ shellId: shell.id, sid: shell.sid, name: shell.name, address: shell.address, sqft: shell.sqft, similarity: { ...sim, layout: undefined } })) });
  } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
process.stderr.write("hermit MCP server ready\n");
