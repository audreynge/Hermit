// Searches query variants for runs where a specialist vetoes a candidate (demo scouting). Deterministic planner only.
import { runAgent } from "../lib/agent/loop";
import { loadRoomGraph, loadShells } from "../lib/query/load";
import type { RequirementSpec, TraceEvent } from "../lib/types";

const base = (o: Partial<RequirementSpec>): RequirementSpec => ({ mode: "business", city: "houston", useType: "medical clinic", rooms: [], needs: {}, priorities: {}, input: "chat", ...o });
const cases: [string, RequirementSpec][] = [];
for (const city of ["houston", "los_angeles"] as const)
  for (const useType of ["medical clinic", "office", "physical therapy clinic"])
    for (const sizeSqft of [[1500, 3000], [2000, 4000], [2500, 5000], [3000, 6000]] as [number, number][])
      cases.push([`${city} ${useType} ${sizeSqft}`, base({ city, useType, sizeSqft, needs: { wheelchair: true, stepFree: true } })]);
for (const [name, spec] of cases) {
  const ev: TraceEvent[] = [];
  await runAgent(spec, (e) => ev.push(e), { shells: loadShells, graph: loadRoomGraph }, { client: null, gemini: null });
  const vetoes = ev.filter((e) => e.type === "veto") as Extract<TraceEvent, { type: "veto" }>[];
  const swap = ev.find((e) => e.type === "rerank") as Extract<TraceEvent, { type: "rerank" }> | undefined;
  const top = (ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>).reports[0];
  if (vetoes.length) console.log(`${name} | vetoes: ${vetoes.map((v) => `${v.agent}→${v.name}: ${v.reason}`).join(" ; ")} | swap: ${swap?.reason ?? "-"} | top: ${top?.name}`);
}
