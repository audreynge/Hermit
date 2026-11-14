// Run one search against the local bundle and print the trace. Usage: npx tsx --env-file=.env scripts/try.ts ["spoken request"] [--det]
import { runAgent } from "../lib/agent/loop";
import { loadRoomGraph, loadShells } from "../lib/query/load";
import { loadSite } from "../lib/neighborhood/load";
import { parseText } from "../lib/spec/parse";
import type { TraceEvent } from "../lib/types";

const text = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "Medical clinic in Houston, 2,000-4,000 sf, 2 exam rooms off a hallway, a small lab, parking for 10, one wheelchair user on staff";
const spec = { ...parseText(text, { city: "houston" }), input: "text" as const };
console.log("spec", JSON.stringify(spec));
const t0 = Date.now();
const show = (e: TraceEvent) => {
  const s = (() => { switch (e.type) {
    case "funnel": return e.stages.map((x) => `${x.count} ${x.label}`).join(" → ");
    case "tool": return `${e.tool}: ${e.summary}`;
    case "verdict": return `${e.verdict.agent} on ${e.verdict.shellId}: ${e.verdict.status} — ${e.verdict.headline}`;
    case "veto": return `VETO by ${e.agent}: ${e.name} — ${e.reason}`;
    case "handoff": return `→ ${e.to}${e.skipped ? " (skipped)" : ""}: ${e.why}`;
    case "report": return e.reports.map((r) => `#${r.rank} ${r.name} ${r.matchScore}% [${r.score.map((l) => `${l.factor} ${l.earned}/${l.max}`).join(", ")}]`).join("\n   ");
    case "plan": return e.text; case "escalate": return `${e.question} → ${e.outcome}`; case "rerank": return e.reason; case "drop": return `drop ${e.shellId}: ${e.reason}`;
    case "error": return e.message; case "done": return `${e.planner} ${e.toolCalls} calls ${e.ms}ms`; default: return "";
  } })();
  if (s) console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${e.type.padEnd(8)} ${s}`);
};
runAgent(spec, show, { shells: loadShells, graph: loadRoomGraph, site: loadSite }, process.argv.includes("--det") ? { client: null, gemini: false } : {});
