// End-to-end check of the MCP server over stdio: npx tsx mcp/smoke.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "hermit-smoke", version: "1" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "mcp/hermit-server.ts"], stderr: "ignore" }));
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text);
};
const assert = (ok: unknown, msg: string) => { if (!ok) throw new Error(`FAIL ${msg}`); console.log(`ok  ${msg}`); };

const tools = (await client.listTools()).tools.map((t) => t.name);
assert(["parse_request", "find_spaces", "start_search", "search_shells", "match_layout", "submit_reports", "similar_layouts"].every((t) => tools.includes(t)), `lists ${tools.length} tools`);
const spec = await call("parse_request", { text: "1,500 sq ft dental clinic in Houston with 3 exam rooms and parking" });
assert(spec.city === "houston" && spec.rooms.length, `parse_request -> ${spec.useType}, ${spec.rooms.length} room types`);
const full = await call("find_spaces", { spec });
assert(full.reports.length > 0 && full.runId, `find_spaces -> ${full.reports.length} reports, top ${full.reports[0].name} (${full.reports[0].matchScore}%)`);
const { runId } = await call("start_search", { spec });
const s = await call("search_shells", { runId });
const ids = s.result.top.slice(0, 3).map((c: { id: string }) => c.id);
assert(ids.length, `search_shells -> ${s.result.top.length} candidates`);
await call("evaluate_candidates", { runId, shellIds: ids });
const done = await call("submit_reports", { runId, shellIds: ids });
assert(done.reports.length === ids.length && done.replay, `step-by-step submit_reports -> ${done.reports.length} reports, ${done.replay}`);
const sim = await call("similar_layouts", { city: "houston", layout: [{ label: "reception", x: 0, y: 0, w: 20, h: 12 }, { label: "office", x: 0, y: 12, w: 12, h: 10 }, { label: "bathroom", x: 12, y: 12, w: 8, h: 8 }] });
assert(sim.results.length, `similar_layouts -> compared ${sim.compared}, best ${sim.results[0].similarity.score}%`);
await client.close();
