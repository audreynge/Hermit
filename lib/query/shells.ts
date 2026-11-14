import { useCategory } from "../reason/rules";
import type { RequirementSpec, Shell } from "../types";

export type Candidate = { shell: Shell; score: number; reasons: string[] };

export const MIN_SLACK = 0.85;
const INDUSTRIAL = new Set(["warehouse", "manufacturing"]);
const NEIGHBOR_USES: Record<string, string[]> = {
  medical: ["office"], salon: ["retail", "office"], office: ["medical"], retail: ["salon", "restaurant", "showroom"],
  restaurant: ["retail"], warehouse: ["manufacturing", "showroom"], manufacturing: ["warehouse"], fitness: ["retail", "warehouse"],
};

function modeOk(spec: RequirementSpec, s: Shell): boolean {
  if (spec.mode === "home") return s.mode === "home";
  if (s.mode === "home") return false;
  if (spec.mode === "enterprise") return s.mode === "enterprise";
  return s.mode === "business" || INDUSTRIAL.has(useCategory(spec.useType));
}

export function searchShells(spec: RequirementSpec, shells: Shell[], limit = 50) {
  const use = useCategory(spec.useType);
  let rejected = 0;
  const results: Candidate[] = [];

  for (const s of shells) {
    if (s.city !== spec.city || !modeOk(spec, s)) { rejected++; continue; }
    if (s.constructionStatus && !["Existing", "UnderRenovation", "Unknown"].includes(s.constructionStatus)) { rejected++; continue; }
    // The minimum is hard beyond 15% short (MIN_SLACK); within it the space stays, ranked lower and labelled honestly.
    if (spec.sizeSqft && s.sqft && (s.sqft < spec.sizeSqft[0] * MIN_SLACK || s.sqft > spec.sizeSqft[1] * 3)) { rejected++; continue; }
    if (spec.beds != null && s.beds != null && s.beds < spec.beds) { rejected++; continue; }
    const price = s.listing?.price;
    if (spec.mode === "home" && price && ((spec.budgetTotal && price > spec.budgetTotal * 1.25) || (spec.budgetMonthly && price < 50000 && price > spec.budgetMonthly * 1.25))) { rejected++; continue; }

    let score = 0;
    const reasons: string[] = [];
    if (s.useTags.includes(use)) { score += 40; reasons.push(`Prior use matches (${use})`); }
    else if (s.useTags.some((t) => NEIGHBOR_USES[use]?.includes(t))) { score += 15; reasons.push(`Adjacent prior use (${s.useTags.join(", ")})`); }
    if (s.sid) { score += 15; reasons.push("Matterport scan available"); }
    if (s.listing?.status === "active") { score += 10; reasons.push("Active listing on record"); }
    const want = spec.transaction === "buy" ? "sale" : spec.transaction === "lease" ? "lease" : null;
    if (want && s.listing?.kind === want) { score += 8; reasons.push(want === "sale" ? "For sale" : "For lease"); }
    if (s.buildingClass === "A") score += 5;
    if (s.buildingClass === "B") score += 3;
    if (spec.sizeSqft) {
      if (!s.sqft) reasons.push("Size unknown until scan is measured");
      else {
        const [lo, hi] = spec.sizeSqft;
        const mid = (lo + hi) / 2;
        const inRange = s.sqft >= lo && s.sqft <= hi;
        score += inRange ? 20 : Math.max(0, 20 - (Math.abs(s.sqft - mid) / mid) * 20) - (s.sqft < lo ? 10 : 0);
        reasons.push(`${s.sqft.toLocaleString()} sf (${s.sqftSource ?? "record"})${inRange ? " in range" : s.sqft < lo ? ` below the ${lo.toLocaleString()} sf minimum` : ""}`);
      }
    }
    if (spec.mode === "home") {
      if (spec.beds != null && s.beds === spec.beds) { score += 10; reasons.push(`${s.beds} bedrooms`); }
      if (spec.baths != null && s.baths != null && s.baths >= spec.baths) score += 5;
      if (price && (spec.budgetTotal ?? spec.budgetMonthly) && price <= (spec.budgetTotal ?? spec.budgetMonthly)!) { score += 10; reasons.push(`$${price.toLocaleString()} within budget`); }
    }
    if (spec.needs.heavyPower && s.heavyPower) { score += 10; reasons.push("Heavy power on record"); }
    if (spec.needs.driveInBays && (s.driveInBays ?? 0) >= spec.needs.driveInBays) { score += 10; reasons.push(`${s.driveInBays} drive-in bays`); }
    results.push({ shell: s, score: Math.round(score), reasons });
  }

  results.sort((a, b) => b.score - a.score || a.shell.id.localeCompare(b.shell.id));
  return { results: results.slice(0, limit), rejected, considered: shells.length };
}
