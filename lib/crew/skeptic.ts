import { competitorCount, transitCount } from "../neighborhood/summarize";
import type { SiteFile } from "../neighborhood/types";
import { useCategory } from "../reason/rules";
import { exclusiveScan } from "../reason/exclusive";
import { buildoutCheck } from "../reason/buildout";
import type { RequirementSpec } from "../types";
import type { Evaluation } from "../agent/report";
import { roomCounts, shortfalls } from "../reason/fit";

// The Skeptic argues against the top pick before Hermit recommends it. Each concern cites a number; the pick
// keeps its spot only if the runner-up has the same or worse problems.
export type Concern = { text: string; weight: number; source: string };
const WALK_IN = new Set(["salon", "retail", "restaurant", "fitness", "medical"]);

export function concerns(spec: RequirementSpec, e: Evaluation, site: SiteFile | null): Concern[] {
  const out: Concern[] = [];
  const use = useCategory(spec.useType);
  const stops = transitCount(site);
  if (WALK_IN.has(use) && stops === 0) out.push({ text: "No bus or rail stop mapped within a 5-minute walk, so walk-in customers may be rare.", weight: 2, source: "OpenStreetMap" });
  // A same-category business on the block is the classic deal-killer: it may hold an exclusive.
  const ex = exclusiveScan(site, spec.useType).conflicts[0];
  if (ex) out.push({ text: `${ex.name} (${ex.what}) is ${ex.where}; it may hold an exclusive that blocks your use.`, weight: 3, source: "OpenStreetMap (CoStar tenant records when loaded)" });
  const missing = buildoutCheck(spec.useType, e.graph).filter((b) => b.status === "unverified" && b.item !== "Grease interceptor");
  if (use === "restaurant" && missing.some((b) => b.item === "Kitchen hood")) out.push({ text: "No kitchen hood seen in the scan, so the kitchen may need a full build-out.", weight: 2, source: "Matterport scan" });
  const rivals = competitorCount(site, use);
  if (rivals != null && rivals >= 8) out.push({ text: `${rivals} competitors within a 10-minute walk.`, weight: 1, source: "OpenStreetMap" });
  if (WALK_IN.has(use) && site && !site.traffic) out.push({ text: "No traffic count nearby, so passing traffic is unproven.", weight: 1, source: site.traffic === null ? "TxDOT / Caltrans" : "none" });
  const soon = spec.moveInBy === "asap" || spec.moveInBy === "1-3m";
  if (soon && e.work.weeksToOpen[1] > 14) out.push({ text: `You want to open soon, but this needs up to ${e.work.weeksToOpen[1]} weeks.`, weight: 2, source: "work estimate" });
  if (e.graph) for (const s of shortfalls(spec, roomCounts(spec, e.fit, e.graph))) out.push({ text: `${s}.`, weight: 2, source: "Matterport room graph" });
  if (e.fit.unknowns.length >= 2) out.push({ text: `${e.fit.unknowns.length} rooms you need couldn't be identified from the scan's room labels.`, weight: 1, source: "Matterport room graph" });
  if (!e.graph) out.push({ text: "No 3D scan, so nothing inside has been seen.", weight: 2, source: "none" });
  return out;
}

export const weight = (c: Concern[]) => c.reduce((s, x) => s + x.weight, 0);
