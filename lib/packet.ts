import { useCategory } from "./reason/rules";
import type { RequirementSpec, ShellReport } from "./types";

// The owner's side of the broker packet, and the Skeptic's landlord-eye grade of it.
export type Profile = {
  business: string; concept: string; useClause: string; years: string; trackRecord: string;
  cash: number; reserveMonths: number; financing: string; guarantee: "yes" | "capped" | "no" | "";
};

const CLAUSE: Record<string, string> = {
  medical: "Operation of a medical clinic providing outpatient exams and treatment, with related administrative offices, and no overnight stays.",
  salon: "Operation of a full-service hair salon offering cuts, color and styling, with incidental retail sale of hair-care products.",
  restaurant: "Operation of a café and bakery serving coffee, baked goods and light food for dine-in and takeout, with on-site baking.",
  retail: "Retail sale of apparel, accessories and related goods.",
  office: "General office use for a professional services firm.",
  fitness: "Operation of a fitness studio offering group classes and personal training, with incidental retail.",
  warehouse: "Warehouse storage and distribution of non-hazardous goods, with incidental office use.",
};
export const suggestClause = (useType: string) => CLAUSE[useCategory(useType)] ?? `Operation of a ${useType}.`;
export const emptyProfile = (spec: Pick<RequirementSpec, "useType">): Profile => ({ business: "", concept: "", useClause: suggestClause(spec.useType), years: "", trackRecord: "", cash: 0, reserveMonths: 0, financing: "", guarantee: "" });

export type Flag = { text: string; fix: string; weight: number; field?: keyof Profile | "furnish" | "questions" };

// Read the packet the way a landlord screens a first-time tenant: can they pay, will they last, will the build-out
// leave me with a space nobody else can use?
export function gradePacket(p: Profile, r: Pick<ShellReport, "work" | "buildout" | "conflicts" | "unknowns">, opts: { monthlyRent: number; furnished: number; questions: number }): { grade: "A" | "B" | "C" | "D"; score: number; flags: Flag[] } {
  const flags: Flag[] = [];
  if (!p.business.trim()) flags.push({ text: "No business name.", fix: "Add the name you'll sign the lease under.", weight: 1, field: "business" });
  if (p.concept.trim().split(/\s+/).length < 6) flags.push({ text: "The concept is too thin to picture.", fix: "One sentence: what you sell, to whom, and why here.", weight: 2, field: "concept" });
  if (p.useClause.trim().split(/\s+/).length < 8) flags.push({ text: "The use wording is vague.", fix: "Landlords write the use clause from this; be exact about what you'll do.", weight: 2, field: "useClause" });
  if (!p.cash) flags.push({ text: "No cash on hand listed. Landlords screen for this first.", fix: "List what you can put toward the build-out, deposit and opening.", weight: 3, field: "cash" });
  if (!p.reserveMonths) flags.push({ text: "No reserve listed. Landlords screen for this.", fix: "Say how many months of rent you can cover with no sales (6+ is strong).", weight: 3, field: "reserveMonths" });
  else if (p.reserveMonths < 6) flags.push({ text: `Only ${p.reserveMonths} month${p.reserveMonths > 1 ? "s" : ""} of reserve.`, fix: "Six months of rent in reserve is what landlords like to see for a new business.", weight: 2, field: "reserveMonths" });
  if (opts.monthlyRent && p.cash && p.cash < opts.monthlyRent * 3) flags.push({ text: "Cash on hand is under 3 months of rent.", fix: "Add financing or a partner, or pick a smaller space.", weight: 2, field: "cash" });
  if (!p.years.trim() && !p.trackRecord.trim()) flags.push({ text: "No track record.", fix: "First business? Say where you've worked in this trade and for how long.", weight: 2, field: "trackRecord" });
  if (!p.financing.trim()) flags.push({ text: "No financing plan.", fix: "Savings, SBA loan, partner: say how the build-out gets paid.", weight: 1, field: "financing" });
  if (!p.guarantee) flags.push({ text: "No position on a personal guarantee.", fix: "Most first leases ask for one; offering a capped guarantee builds trust.", weight: 1, field: "guarantee" });
  const specialty = r.work.some((w) => /restroom|plumbing|kitchen|hood|sink|fixture/i.test(w.item));
  if (specialty && !opts.furnished) flags.push({ text: "Specialty build-out with no layout. Landlords worry the space can't be re-leased.", fix: "Furnish the space so they see exactly how it gets used.", weight: 2, field: "furnish" });
  const unverified = (r.buildout ?? []).filter((b) => b.status !== "seen").length;
  if (unverified && opts.questions < unverified) flags.push({ text: `${unverified} build-out item${unverified > 1 ? "s are" : " is"} unverified but not all are asked about.`, fix: "Keep the unverified items in your questions.", weight: 1, field: "questions" });
  if ((r.conflicts ?? []).length) flags.push({ text: "A same-category business is on the block and the packet doesn't address it.", fix: "Keep the exclusive-use question in the packet.", weight: 0, field: "questions" });
  const score = Math.max(0, 100 - flags.reduce((s, f) => s + f.weight * 8, 0));
  return { grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D", score, flags };
}
