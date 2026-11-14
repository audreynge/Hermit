import { useCategory } from "../reason/rules";
import type { RequirementSpec, ScanKind, Shell } from "../types";

export type Candidate = { shell: Shell; score: number; reasons: string[] };
export type Stage = { key: string; label: string; count: number; removed: { id: string; name: string; reason: string }[]; removedCount: number };

export const MIN_SLACK = 0.85;
const INDUSTRIAL = new Set(["warehouse", "manufacturing"]);
const NEIGHBOR_USES: Record<string, string[]> = {
  medical: ["office"], salon: ["retail", "office"], office: ["medical"], retail: ["salon", "restaurant", "showroom", "office"],
  restaurant: ["retail"], warehouse: ["manufacturing", "showroom"], manufacturing: ["warehouse"], fitness: ["retail", "warehouse", "office"],
};
const KIND_LABEL: Record<ScanKind, string> = {
  unit: "apartment unit", amenity: "apartment amenity (gym, pool, lounge)", home: "home", suite: "suite", office: "office",
  medical: "medical suite", salon: "salon", retail: "retail space", warehouse: "warehouse", other: "unclassified scan",
};
const KEEP_SAMPLES = 25;

function modeOk(spec: RequirementSpec, s: Shell): boolean {
  if (s.kind === "amenity" || s.kind === "other") return false;
  if (spec.mode === "home") return s.mode === "home";
  if (s.mode === "home") return false;
  if (spec.mode === "enterprise") return s.mode === "enterprise";
  return s.mode === "business" || INDUSTRIAL.has(useCategory(spec.useType));
}

export const sqftOf = (s: Shell) => s.sqft ?? s.measuredSqft;
const sqftSource = (s: Shell) => (s.sqft ? s.sqftSource ?? "record" : s.measuredSqft ? "measured from scan" : undefined);
const city = (c: string) => (c === "houston" ? "Houston" : c === "los_angeles" ? "Los Angeles" : "no location");

// Stage-by-stage funnel over the whole index. Every removal keeps a reason so "why not this one?" can be answered.
export function funnel(spec: RequirementSpec, shells: Shell[]) {
  const use = useCategory(spec.useType);
  const stages: Stage[] = [{ key: "indexed", label: "scans indexed", count: shells.length, removed: [], removedCount: 0 }];
  let pool = shells;
  const step = (key: string, label: string, test: (s: Shell) => string | null) => {
    const kept: Shell[] = [];
    const removed: Stage["removed"] = [];
    let removedCount = 0;
    for (const s of pool) {
      const why = test(s);
      if (why == null) kept.push(s);
      else { removedCount++; if (removed.length < KEEP_SAMPLES) removed.push({ id: s.id, name: s.name, reason: why }); }
    }
    pool = kept;
    stages.push({ key, label, count: kept.length, removed, removedCount });
  };

  step("city", `in ${city(spec.city)}`, (s) => (s.city === spec.city ? null : s.city === ("unknown" as never) ? "No location recorded for this scan" : `In ${city(s.city)}`));
  step("type", spec.mode === "home" ? "homes and apartment units" : spec.mode === "enterprise" ? "industrial spaces" : "commercial spaces (not apartment amenities)",
    (s) => (modeOk(spec, s) ? null : `It's ${s.kind ? `an ${KIND_LABEL[s.kind]}` : s.mode} scan`));
  step("built", "existing buildings", (s) => (s.constructionStatus && !["Existing", "UnderRenovation", "Unknown"].includes(s.constructionStatus) ? `Construction status is ${s.constructionStatus}` : null));
  if (spec.sizeSqft) {
    const [lo, hi] = spec.sizeSqft;
    // The record minimum is hard beyond 15% short (MIN_SLACK); within it the space stays, ranked lower and labelled honestly.
    // A scan-only (net) area is looser here; lib/reason/fit.ts applies SCAN_MIN_SLACK once rooms are measured.
    step("size", `${lo.toLocaleString()}–${hi.toLocaleString()} sf (or size unknown)`, (s) => {
      const a = sqftOf(s);
      if (!a) return null;
      const min = s.sqft ? lo * MIN_SLACK : lo * 0.5;
      return a < min ? `${a.toLocaleString()} sf (${sqftSource(s)}) is more than ${s.sqft ? "15%" : "half"} under your minimum` : a > hi * 3 ? `${a.toLocaleString()} sf (${sqftSource(s)}) is over 3× your maximum` : null;
    });
  }
  if (spec.mode !== "home") {
    step("use", `built for ${use} or a close use`, (s) =>
      s.useTags.includes(use) || s.useTags.some((t) => NEIGHBOR_USES[use]?.includes(t)) ? null : `Prior use is ${s.useTags.join(", ") || "unknown"}, not ${use}`);
  }
  if (spec.beds != null) step("beds", `${spec.beds}+ bedrooms`, (s) => (s.beds == null || s.beds >= spec.beds! ? null : `${s.beds} bedrooms`));
  if (spec.mode === "home" && (spec.budgetTotal || spec.budgetMonthly)) {
    step("budget", "within 25% of your budget", (s) => {
      const price = s.listing?.price;
      if (!price) return null;
      return (spec.budgetTotal && price > spec.budgetTotal * 1.25) || (spec.budgetMonthly && price < 50000 && price > spec.budgetMonthly * 1.25) ? `$${price.toLocaleString()} is over 25% above your budget` : null;
    });
  }
  return { stages, pool };
}

export function searchShells(spec: RequirementSpec, shells: Shell[], limit = Infinity) {
  const use = useCategory(spec.useType);
  const { stages, pool } = funnel(spec, shells);
  const results: Candidate[] = [];

  for (const s of pool) {
    let score = 0;
    const reasons: string[] = [];
    if (s.useTags.includes(use)) { score += 40; reasons.push(s.scanClass ? `Matterport classifies the scan as ${s.scanClass.replace(/_/g, " ")}` : `Prior use matches (${use})`); }
    else if (s.useTags.some((t) => NEIGHBOR_USES[use]?.includes(t))) { score += 15; reasons.push(`Close prior use (${s.useTags.join(", ")})`); }
    if (s.sid) { score += 15; reasons.push("Matterport scan available"); }
    if ((s.roomCount ?? 0) >= 3) { score += 5; }
    if (s.listing?.status === "active") { score += 10; reasons.push("Active listing on record"); }
    const want = spec.transaction === "buy" ? "sale" : spec.transaction === "lease" ? "lease" : null;
    if (want && s.listing?.kind === want) { score += 8; reasons.push(want === "sale" ? "For sale" : "For lease"); }
    if (s.buildingClass === "A") score += 5;
    if (s.buildingClass === "B") score += 3;
    const a = sqftOf(s);
    if (spec.sizeSqft) {
      if (!a) reasons.push("Size unknown until scan is measured");
      else {
        const [lo, hi] = spec.sizeSqft;
        const mid = (lo + hi) / 2;
        const inRange = a >= lo && a <= hi;
        score += inRange ? 20 : Math.max(0, 20 - (Math.abs(a - mid) / mid) * 20) - (a < lo ? 10 : 0);
        reasons.push(`${a.toLocaleString()} sf (${sqftSource(s)})${inRange ? " in range" : a < lo ? ` below the ${lo.toLocaleString()} sf minimum` : ""}`);
      }
    }
    if (spec.mode === "home") {
      const price = s.listing?.price;
      if (spec.beds != null && s.beds === spec.beds) { score += 10; reasons.push(`${s.beds} bedrooms`); }
      if (spec.baths != null && s.baths != null && s.baths >= spec.baths) score += 5;
      if (price && (spec.budgetTotal ?? spec.budgetMonthly) && price <= (spec.budgetTotal ?? spec.budgetMonthly)!) { score += 10; reasons.push(`$${price.toLocaleString()} within budget`); }
    }
    if (spec.needs.heavyPower && s.heavyPower) { score += 10; reasons.push("Heavy power on record"); }
    if (spec.needs.driveInBays && (s.driveInBays ?? 0) >= spec.needs.driveInBays) { score += 10; reasons.push(`${s.driveInBays} drive-in bays`); }
    results.push({ shell: s, score: Math.round(score), reasons });
  }

  results.sort((a, b) => b.score - a.score || a.shell.id.localeCompare(b.shell.id));
  return { results: results.slice(0, limit), rejected: shells.length - pool.length, considered: shells.length, stages, pool: pool.length };
}
