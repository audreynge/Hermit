import table from "../../rules/screening.json";
import type { FitResult, RequirementSpec, RuleHit, Shell, WorkItem } from "../types";
import { normalizeRoomLabel } from "./labels";
import { useCategory } from "./rules";

type CostKey = keyof typeof table.costs;
const SOURCE = table.sources.costs.url;

function row(key: CostKey, qty: number, reason: WorkItem["reason"], label?: string): WorkItem {
  const c = table.costs[key];
  return {
    item: label ?? c.label, qty, low: c.low * qty, high: c.high * qty,
    weeksLow: c.weeksLow, weeksHigh: c.weeksHigh, reason, source: SOURCE,
  };
}

export function estimateWork(spec: RequirementSpec, shell: Shell, fit: FitResult, rules: RuleHit[]) {
  const items: WorkItem[] = [];
  const restaurant = useCategory(spec.useType) === "restaurant";

  for (const e of fit.edits) {
    const m = e.match(/^(Build|Divide|Add) (.+?)(?: \(|$| to | for |$)/);
    if (!m) continue;
    if (m[1] === "Divide") items.push(row("divide_room", 1, "fit", e));
    else if (m[1] === "Add") items.push(row("add_fixture", 1, "fit", e));
    else {
      const label = normalizeRoomLabel([m[2].replace(/ #\d+$/, "")]);
      if (label === "bathroom") items.push(row("bathroom", 1, "fit"));
      else if (label === "kitchen") items.push(row(restaurant ? "commercial_kitchen" : "kitchen", 1, "fit"));
      else items.push(row("build_room", 1, "fit", e));
    }
  }

  const failed = (rule: string) => rules.some((r) => r.rule === rule && r.status === "fail");
  if (failed("electrical")) items.push(row("electrical_upgrade", 1, "code"));
  if (failed("fire") && shell.sqft) items.push({ ...row("esfr_retrofit_psf", shell.sqft, "code"), item: `${table.costs.esfr_retrofit_psf.label.replace(" (per sf)", "")}, ${shell.sqft.toLocaleString()} sf` });
  if (failed("drive_in_bays")) {
    const missing = (spec.needs.driveInBays ?? 0) - (shell.driveInBays ?? 0);
    if (missing > 0) items.push(row("drive_in_door", missing, "code"));
  }
  if (failed("accessibility")) items.push(row("ramp", 1, "code", "Accessible route (ramp/lift); elevator may be required"));

  const tiAllowance = spec.tiPerSqft && shell.sqft ? spec.tiPerSqft * shell.sqft : undefined;
  if (!items.length) return { items, weeksToOpen: [1, 4] as [number, number], costRange: [0, 0] as [number, number], tiAllowance };

  const [pLo, pHi] = table.permitWeeks[spec.city] as [number, number];
  const weeksToOpen: [number, number] = [
    pLo + Math.max(...items.map((i) => i.weeksLow)),
    pHi + items.reduce((s, i) => s + i.weeksHigh, 0),
  ];
  const lo = items.reduce((s, i) => s + i.low, 0);
  const hi = items.reduce((s, i) => s + i.high, 0);
  return { items, weeksToOpen, costRange: [lo, hi] as [number, number], tiAllowance };
}
