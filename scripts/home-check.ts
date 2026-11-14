// Sanity check: an apartment search must not get business checks (competitors, exclusives, walk-in traffic, licenses).
import { runAgent } from "../lib/agent/loop";
import { openingPlan } from "../lib/crew/planner";
import { loadSite } from "../lib/neighborhood/load";
import { competitors } from "../lib/neighborhood/summarize";
import { loadRoomGraph, loadShells } from "../lib/query/load";
import { useCategory } from "../lib/reason/rules";
import type { RequirementSpec, TraceEvent } from "../lib/types";

const spec: RequirementSpec = { mode: "home", city: "houston", useType: "home", beds: 2, rooms: [], needs: {}, priorities: {}, input: "chat" };
const ev: TraceEvent[] = [];
await runAgent(spec, (e) => ev.push(e), { shells: loadShells, graph: loadRoomGraph, site: loadSite }, { client: null, gemini: null });
const reports = (ev.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }>).reports;
const r = reports[0];
console.log("reports:", reports.length, "| top:", r?.name);
console.log("challenge:", JSON.stringify((ev.find((e) => e.type === "challenge") as { concerns?: string[] } | undefined)?.concerns ?? null));
console.log("areas event:", ev.some((e) => e.type === "areas"));
console.log("conflicts:", JSON.stringify(r?.conflicts), "| buildout:", r?.buildout?.map((b) => b.item).join(", "));
console.log("business questions:", r?.unknowns.filter((u) => /exclusive|competitor|use need landlord|license|zoning/i.test(u.question)).map((u) => u.question));
console.log("competitors card:", competitors(r?.inside?.sid ? loadSite(r.inside.sid) : null, useCategory(spec.useType)).headline);
console.log("plan steps:", openingPlan(spec, r).steps.map((s) => s.title).join(" → "));
