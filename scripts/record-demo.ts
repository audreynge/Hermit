// Records golden demo runs into the active bundle's replay folder so /?replay=<id> runs with zero network.
// Usage: npx tsx --env-file=.env scripts/record-demo.ts [id] ["spoken request"]
import { runAgent } from "../lib/agent/loop";
import { saveRun } from "../lib/agent/replay";
import { dataDir, loadRoomGraph, loadShells } from "../lib/query/load";
import { loadSite } from "../lib/neighborhood/load";
import { parseText } from "../lib/spec/parse";
import type { TraceEvent } from "../lib/types";

const GOLDEN: Record<string, string> = {
  demo: "Office in Houston, 2,500-5,000 sf, 4 private offices and a conference room, one wheelchair user on staff",
  clinic: "Medical clinic in Houston, 1,500-3,000 sf, 2 exam rooms with sinks off a hallway, a small lab, parking for 10",
  swap: "Medical clinic in Los Angeles, 1,200-2,500 sf",
};
const id = process.argv[2] ?? "demo";
const text = process.argv.slice(3).find((a) => !a.startsWith("--")) ?? GOLDEN[id];
if (!text) throw new Error(`no request for replay "${id}"`);
const spec = { ...parseText(text, { city: "houston" }), input: "text" as const, avgPrice: id === "swap" ? 150 : undefined, daysOpen: id === "swap" ? 5 : undefined };
const events: TraceEvent[] = [{ type: "run", id: "run", runId: id, replay: false }];
// --det records with the deterministic planner (same crew and evidence, fixed order) for a reproducible replay.
const reports = await runAgent(spec, (e) => events.push(e), { shells: loadShells, graph: loadRoomGraph, site: loadSite }, process.argv.includes("--det") ? { client: null, gemini: null } : {});
await saveRun(id, spec, events);
const vetoes = events.filter((e) => e.type === "veto").length;
const planner = (events.at(-1) as Extract<TraceEvent, { type: "done" }>).planner;
console.log(`recorded "${id}" in ${dataDir()}: ${reports.length} reports, ${vetoes} vetoes, planner ${planner}, ${events.length} events`);
