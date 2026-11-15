// Records golden demo runs so /studio?replay=<id> runs with zero network.
// Usage: npx tsx --env-file=.env scripts/record-demo.ts [id] ["spoken request"] [--det] [--json] [--keep-anyway]
//   --det          deterministic planner (same crew and evidence, fixed order) for a reproducible replay
//   --json         also write <data>/replay/<id>.json, the offline copy lib/agent/replay.ts falls back to
//   --keep-anyway  save even if the run lacks the demo beats (a named drop or veto, an escalate with a result, a rerank)
// With DATABASE_URL="" the run goes to the local SQLite (<data>/hermit.db) instead of Postgres.
// Uses the same tools as the live /api/agent route. The events are saved exactly as the run emitted them.
import fs from "node:fs";
import path from "node:path";
import { runAgent } from "../lib/agent/loop";
import { saveRun } from "../lib/agent/replay";
import { dbFile } from "../lib/db";
import { dataDir, getShell, loadRoomGraph, searchCandidates } from "../lib/query/load";
import { loadSite } from "../lib/neighborhood/load";
import { lookupZoning } from "../lib/regs/zoning";
import { researchRegulations } from "../lib/regs/research";
import { geminiClient } from "../lib/llm/gemini";
import { parseText } from "../lib/spec/parse";
import type { TraceEvent } from "../lib/types";

const PRIYA = "I'm a pediatrician opening my own clinic in Houston. 1,500 to 3,500 sq ft, 2 exam rooms with sinks off a hallway, a small lab, a waiting room, step-free entry, parking for 10.";
const GOLDEN: Record<string, string> = {
  demo: "Office in Houston, 2,500-5,000 sf, 4 private offices and a conference room, one wheelchair user on staff",
  clinic: "Medical clinic in Houston, 1,500-3,000 sf, 2 exam rooms with sinks off a hallway, a small lab, parking for 10",
  swap: "Medical clinic in Los Angeles, 1,200-2,500 sf",
  priya: PRIYA,
  "priya-det": PRIYA,
};
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const id = args[0] ?? "demo";
const text = args[1] ?? GOLDEN[id];
if (!text) throw new Error(`no request for replay "${id}"`);
const det = flags.has("--det");
const spec = { ...parseText(text, { city: "houston" }), input: "text" as const, avgPrice: id === "swap" ? 150 : undefined, daysOpen: id === "swap" ? 5 : undefined };
const events: TraceEvent[] = [{ type: "run", id: "run", runId: id, replay: false }];
const gemini = det ? null : await geminiClient();
if (!det && !gemini && !process.env.ANTHROPIC_API_KEY) console.warn("no planner key: this run will be deterministic");
const reports = await runAgent(spec, (e) => events.push(e), {
  shells: (s) => searchCandidates(s.city, s.mode === "home" ? ["home"] : ["business", "enterprise"]),
  graph: loadRoomGraph, site: loadSite, zoning: (lat, lon) => lookupZoning(lat, lon), research: (q) => researchRegulations(q),
}, det ? { client: null, gemini: null, openai: null } : { gemini });

// Summary of what the run actually emitted.
const name = (sid: string) => getShell(sid)?.name ?? sid;
const of = <K extends TraceEvent["type"]>(k: K) => events.filter((e): e is Extract<TraceEvent, { type: K }> => e.type === k);
const done = of("done").at(-1);
console.log(`spec: ${JSON.stringify({ useType: spec.useType, city: spec.city, sqft: spec.sizeSqft, rooms: spec.rooms, needs: spec.needs })}`);
console.log(`planner: ${done?.planner ?? "?"} · ${done?.toolCalls ?? 0} tool calls · ${done?.ms ?? 0} ms · ${events.length} events`);
for (const f of of("funnel")) console.log(`funnel: ${f.stages.map((s) => `${s.label} ${s.count}`).join(" -> ")}`);
for (const e of of("drop")) console.log(`drop: ${name(e.shellId)} (${e.shellId}): ${e.reason}`);
for (const e of of("veto")) console.log(`veto [${e.agent}]: ${e.name} (${e.shellId}): ${e.reason}`);
for (const e of of("escalate")) console.log(`escalate: ${name(e.shellId)}: ${e.question} -> result ${e.result ?? "none"}: ${e.outcome}`);
for (const e of of("rerank")) console.log(`rerank: ${e.reason} [${e.order.slice(0, 3).map(name).join(", ")}]`);
for (const e of of("challenge")) console.log(`challenge: ${e.name}: ${e.outcome}: ${e.detail}`);
for (const e of of("error")) console.log(`error: ${e.message}`);
reports.slice(0, 3).forEach((r, i) => console.log(`#${i + 1}: ${r.name} (${r.shellId}) score ${r.matchScore}`));

const beats = {
  namedDropOrVeto: of("drop").length > 0 || of("veto").some((e) => !!e.name),
  escalateWithResult: of("escalate").some((e) => !!e.result),
  rerank: of("rerank").length > 0,
};
// A run asked for an LLM planner that fell back to the deterministic one is not that recording.
const plannerOk = det || done?.planner !== "deterministic";
if (!plannerOk) console.log(`the LLM planner did not run (fell back to ${done?.planner})`);
const ok = plannerOk && Object.values(beats).every(Boolean);
console.log(`demo beats: ${JSON.stringify(beats)}`);
if (!ok && !flags.has("--keep-anyway")) {
  console.log(`not saved: "${id}" ${plannerOk ? "lacks a demo beat" : "was not planned by the LLM"}`);
  process.exit(2);
}
await saveRun(id, spec, events);
if (flags.has("--json")) {
  const dir = path.join(dataDir(), "replay");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, createdAt: new Date().toISOString(), spec, events }));
}
console.log(`recorded "${id}" in ${process.env.DATABASE_URL ? "Postgres" : dbFile()}${flags.has("--json") ? ` and ${path.join(dataDir(), "replay", `${id}.json`)}` : ""}: ${reports.length} reports`);
process.exit(0);
