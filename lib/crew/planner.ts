import table from "../../rules/screening.json";
import { useCategory } from "../reason/rules";
import type { RequirementSpec, ShellReport } from "../types";

// The Planner: a week-by-week opening plan from the report's work items, local permit times and the use's license.
type Contact = { who: string; url: string };
const LICENSE: Record<string, Record<string, Contact & { what: string }>> = {
  houston: {
    salon: { what: "Cosmetology establishment license", who: "Texas Department of Licensing and Regulation (TDLR)", url: "https://www.tdlr.texas.gov/cosmet/cosmet.htm" },
    medical: { what: "Facility registration and any health-department permits", who: "Texas Medical Board / Houston Health Department", url: "https://www.tmb.state.tx.us/" },
    restaurant: { what: "Food service permit and health inspection", who: "Houston Health Department, Consumer Health", url: "https://www.houstonconsumer.org/" },
  },
  los_angeles: {
    salon: { what: "Establishment license", who: "California Board of Barbering and Cosmetology", url: "https://www.barbercosmo.ca.gov/" },
    medical: { what: "Clinic licensing review (if required) and county health permits", who: "Medical Board of California / LA County Public Health", url: "https://www.mbc.ca.gov/" },
    restaurant: { what: "Public health permit and plan check", who: "LA County Environmental Health", url: "http://publichealth.lacounty.gov/eh/" },
  },
};
const PERMITS: Record<string, Contact> = {
  houston: { who: "Houston Permitting Center", url: table.sources.houston_permits.url },
  los_angeles: { who: "LA Department of Building and Safety (LADBS)", url: table.sources.ladbs.url },
};

export type PlanStep = { weeks: [number, number]; title: string; detail: string; who?: Contact; unknown?: boolean };

export function openingPlan(spec: Pick<RequirementSpec, "city" | "useType">, report: Pick<ShellReport, "work" | "unknowns">): { steps: PlanStep[]; total: [number, number] } {
  const use = useCategory(spec.useType);
  const [pLo, pHi] = table.permitWeeks[spec.city] as [number, number];
  const steps: PlanStep[] = [];
  let lo = 0, hi = 0;
  const add = (wLo: number, wHi: number, s: Omit<PlanStep, "weeks">, parallel = false) => {
    const start: [number, number] = parallel ? [Math.max(0, lo - wLo), Math.max(0, hi - wHi)] : [lo, hi];
    steps.push({ ...s, weeks: [start[0] + 1, start[1] + wHi] });
    if (!parallel) { lo += wLo; hi += wHi; }
  };
  if (use === "home") {
    add(1, 2, { title: "Tour and apply", detail: "See it in person (or in 3D), send your questions, and apply." });
    add(1, 2, { title: "Approval and lease signing", detail: "Background and income checks, then sign." });
    if (report.work.length) add(Math.max(...report.work.map((w) => w.weeksLow)), Math.max(...report.work.map((w) => w.weeksHigh)), { title: "Changes before move-in", detail: report.work.map((w) => w.item).slice(0, 3).join("; ") });
    add(1, 1, { title: "Move in", detail: "Keys, utilities and movers." });
    return { steps, total: [lo + 1, hi] };
  }
  add(1, 3, { title: "Tour, negotiate and sign", detail: "Send the broker your questions, agree on terms and sign the lease or LOI." });
  if (report.work.length) {
    add(pLo, pHi, { title: "Permits for the build-out", detail: `Submit plans for ${report.work.length} work item${report.work.length > 1 ? "s" : ""} (${table.uses[use]?.permit ?? "tenant improvement"}).`, who: PERMITS[spec.city] });
    const build = Math.max(...report.work.map((w) => w.weeksHigh)), buildLo = Math.max(...report.work.map((w) => w.weeksLow));
    add(buildLo, build, { title: "Build-out", detail: report.work.map((w) => w.item).slice(0, 3).join("; ") + (report.work.length > 3 ? "; and more" : "") });
    add(1, 2, { title: "Inspections", detail: "City inspections sign off on the work.", who: PERMITS[spec.city] });
  } else add(1, 2, { title: "Change-of-use check", detail: "Confirm with the city that no permit is needed for your use.", who: PERMITS[spec.city] });
  const lic = LICENSE[spec.city]?.[use];
  if (lic) add(2, 6, { title: lic.what, detail: "Start this as soon as the lease is signed; it can run alongside the build-out.", who: lic }, true);
  add(1, 1, { title: "Move in and open", detail: "Furniture, signage, and your first customers." });
  const hidden = report.unknowns.filter((u) => /behind the walls|systems|hvac|electrical/i.test(u.topic)).length;
  if (hidden) steps.push({ weeks: [0, 0], title: "Could change the timeline", detail: `${hidden} thing${hidden > 1 ? "s" : ""} hidden behind the walls (power, water, AC) aren't confirmed yet.`, unknown: true });
  return { steps, total: [lo + 1, hi] };
}
