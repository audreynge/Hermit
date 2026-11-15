import { useCategory } from "./reason/rules";
import type { RequirementSpec, ShellReport } from "./types";

// The owner's side of the broker packet, and the Skeptic's landlord-eye grade of it.
export type Profile = {
  business: string; concept: string; useClause: string; years: string; trackRecord: string;
  cash: number; reserveMonths: number; financing: string; guarantee: "yes" | "capped" | "no" | "";
  contactName: string; email: string; phone: string; moveIn: string; leaseTerm: string;
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
export const emptyProfile = (spec: Pick<RequirementSpec, "useType">): Profile => ({ business: "", concept: "", useClause: suggestClause(spec.useType), years: "", trackRecord: "", cash: 0, reserveMonths: 0, financing: "", guarantee: "", contactName: "", email: "", phone: "", moveIn: "", leaseTerm: "" });

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

// The guided "Talk to your broker" chat: one packet field per question, in this order.
export type AskField = "business" | "contactName" | "email" | "phone" | "moveIn" | "leaseTerm" | "years" | "concept" | "cash" | "reserveMonths" | "financing" | "guarantee";
export const ASK: { field: AskField; label: string; q: string; hint: string }[] = [
  { field: "business", label: "Business name", q: "What's the name of your business? (The name you'd sign the lease under.)", hint: "e.g. Rise Bakery" },
  { field: "contactName", label: "Your name", q: "And your name, so the property manager knows who to reply to?", hint: "e.g. Maria Lopez" },
  { field: "email", label: "Email", q: "What email should they reply to?", hint: "you@example.com" },
  { field: "phone", label: "Phone", q: "A phone number they can call? (Skip if you'd rather not.)", hint: "e.g. 713-555-0142" },
  { field: "moveIn", label: "Move-in date", q: "When would you like to move in?", hint: "e.g. March 2027, or as soon as possible" },
  { field: "leaseTerm", label: "Lease length", q: "How long a lease do you want?", hint: "e.g. 5 years" },
  { field: "years", label: "Experience", q: "How long have you been in this business or trade? A line about where you've worked helps too.", hint: "e.g. 6 years, head baker at Common Bond" },
  { field: "concept", label: "What you do", q: "In one sentence: what do you sell, and to whom?", hint: "e.g. Fresh bread and coffee for downtown office workers" },
  { field: "cash", label: "Cash available", q: "Roughly how much cash can you put toward opening (deposit, build-out, equipment)?", hint: "e.g. $80k" },
  { field: "reserveMonths", label: "Reserve", q: "If sales were slow, how many months of rent could you cover from savings?", hint: "e.g. 6 months" },
  { field: "financing", label: "Financing", q: "How will you pay for the build-out: savings, an SBA loan, a partner?", hint: "e.g. Savings plus an SBA loan" },
  { field: "guarantee", label: "Personal guarantee", q: "Most first leases ask for a personal guarantee. Would you offer one? (yes, capped, or no)", hint: "yes / capped / no" },
];

const isEmpty = (p: Profile, f: AskField) => { const v = p[f]; return typeof v === "number" ? !v : !String(v ?? "").trim(); };
export const askList = (spec: { transaction?: string; mode?: string }) => ASK.filter((a) => a.field !== "leaseTerm" || (spec.transaction !== "buy" && spec.mode !== "home"));
export const nextAsk = (p: Profile, spec: { transaction?: string; mode?: string }, skipped: string[]) => askList(spec).find((a) => isEmpty(p, a.field) && !skipped.includes(a.field)) ?? null;

const money = (s: string) => { const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|thousand|m|million)?\b/i); if (!m) return 0; const n = Number(m[1]); const u = m[2]?.toLowerCase(); return Math.round(u?.startsWith("m") ? n * 1e6 : u?.startsWith("k") || u === "thousand" ? n * 1e3 : n); };
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

// Deterministic answer parsing: the fallback when Gemini is off. Returns null when the answer doesn't fit the field.
export function parseAnswer(field: AskField, text: string): Partial<Profile> | null {
  const t = text.trim();
  if (!t) return null;
  switch (field) {
    case "email": { const m = t.match(/[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}/i); return m ? { email: m[0] } : null; }
    case "phone": return t.replace(/\D/g, "").length >= 7 ? { phone: t } : null;
    case "cash": { const n = money(t); return n ? { cash: n } : null; }
    case "reserveMonths": { const w = t.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/); const n = w ? WORDS[w[1]] : Number(t.match(/\d+/)?.[0] ?? 0) * (/year/i.test(t) ? 12 : 1); return n ? { reserveMonths: n } : null; }
    case "guarantee": return /cap|limit/i.test(t) ? { guarantee: "capped" } : /\b(no|not|rather not|prefer not|none)\b/i.test(t) ? { guarantee: "no" } : /\b(yes|yeah|sure|ok|okay|fine|will)\b/i.test(t) ? { guarantee: "yes" } : null;
    case "years": { const y = t.match(/\d+\s*(years?|yrs?)/i)?.[0]; return y && y.length < t.length - 3 ? { years: y, trackRecord: t } : { years: y ?? t }; }
    default: return { [field]: t };
  }
}

// Fields we can fill without asking: from the search spec and any contact details in what the owner first typed.
export function inferProfile(p: Profile, spec: Pick<RequirementSpec, "useType" | "moveInBy" | "rawText">): Profile {
  const raw = spec.rawText ?? "";
  const when: Record<string, string> = { asap: "As soon as possible", "1-3m": "In 1 to 3 months", "3-6m": "In 3 to 6 months", "6-12m": "In 6 to 12 months" };
  return {
    ...p,
    useClause: p.useClause || suggestClause(spec.useType),
    moveIn: p.moveIn || (spec.moveInBy ? when[spec.moveInBy] ?? spec.moveInBy : ""),
    email: p.email || parseAnswer("email", raw)?.email || "",
  };
}

// Everything no specialist could verify, as one deduplicated list for the landlord.
export function landlordQuestions(r: Pick<ShellReport, "unknowns" | "buildout">, concerns: string[] = []): string[] {
  return [...new Set([
    ...r.unknowns.map((u) => u.question),
    ...concerns.map((c) => `Can you tell me more about this? ${c}`),
    ...(r.buildout ?? []).filter((b) => b.status !== "seen").map((b) => b.question),
  ])];
}

export function brokerMessage(r: Pick<ShellReport, "draftMessage" | "name">, p: Profile, questions: string[]): string {
  const intro = r.draftMessage.split("\n\nCould you help")[0];
  const asks = questions.length ? questions.map((q) => `- ${q}`).join("\n") : "- Is the space available, and what are the terms?";
  const me = [p.contactName && `${p.contactName}${p.business ? `, ${p.business}` : ""}`, p.email, p.phone].filter(Boolean).join("\n");
  return `${intro}\n\nCould you help with a few questions?\n${asks}\n\nI've attached a one-page tenant packet with my business details, finances and planned layout.\n\nThanks!${me ? `\n${me}` : ""}`;
}
