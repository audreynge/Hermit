// Scouts query variants for a run where the Skeptic flags a deal-killer and the crew swaps its top pick.
import { runAgent } from "../lib/agent/loop";
import { loadSite } from "../lib/neighborhood/load";
import { loadRoomGraph, loadShells } from "../lib/query/load";
import type { RequirementSpec, TraceEvent } from "../lib/types";

for (const city of ["houston", "los_angeles"] as const)
  for (const useType of ["bakery cafe", "salon", "retail shop", "medical clinic", "fitness studio"])
    for (const sizeSqft of [[800, 1800], [1200, 2500], [2000, 4000]] as [number, number][]) {
      const spec: RequirementSpec = { mode: "business", city, useType, sizeSqft, rooms: [], needs: {}, priorities: {}, input: "chat", avgPrice: 12, daysOpen: 6 };
      const ev: TraceEvent[] = [];
      await runAgent(spec, (e) => ev.push(e), { shells: loadShells, graph: loadRoomGraph, site: loadSite }, { client: null, gemini: null });
      const c = ev.find((e) => e.type === "challenge") as Extract<TraceEvent, { type: "challenge" }> | undefined;
      const top = (ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>).reports[0];
      if (c) console.log(`${city} ${useType} ${sizeSqft} | ${c.outcome} | ${c.name}: ${c.concerns.join(" ")} | top: ${top?.name} | conflicts on top: ${top?.conflicts?.length ?? 0}`);
    }
