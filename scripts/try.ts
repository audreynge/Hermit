import { runAgent } from "../lib/agent/loop";
import { loadRoomGraph, loadShells } from "../lib/query/load";
import { parseText } from "../lib/spec/parse";
import type { TraceEvent } from "../lib/types";

const q = process.argv[2];
const spec = parseText(q);
const ev: TraceEvent[] = [];
const t = Date.now();
const reports = await runAgent(spec, (e) => ev.push(e), { shells: loadShells, graph: loadRoomGraph }, { client: null });
console.log(JSON.stringify({ spec: { mode: spec.mode, city: spec.city, use: spec.useType, size: spec.sizeSqft, rooms: spec.rooms.map((r) => `${r.count}x${r.label}`), needs: spec.needs } }));
for (const e of ev) {
  if (e.type === "tool") console.log("tool", e.tool, "|", e.summary);
  else if (e.type === "drop") console.log("drop", e.shellId, "|", e.reason.slice(0, 110));
  else if (e.type === "escalate") console.log("esc ", e.shellId, "|", e.outcome.slice(0, 100));
  else if (e.type === "rerank") console.log("rerank", e.reason);
}
for (const r of reports) console.log(r.rank, r.badge, r.verdict, "|", r.name.slice(0, 60), "| fit", r.fit.score, "|", r.summary.slice(0, 120));
console.log("ms", Date.now() - t);
