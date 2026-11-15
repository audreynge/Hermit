import type { RequirementSpec, ShellReport } from "@/lib/types";

export const TABS = ["overview", "inside", "furnish", "neighborhood", "lease", "broker"] as const;
export type ChatAction = { type: "tab"; tab: (typeof TABS)[number] } | { type: "save" };

const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;
const range = (a: number, b: number) => (a === b ? $(a) : `${$(a)} to ${$(b)}`);

export function reportFacts(r: ShellReport, spec: RequirementSpec) {
  const sqft = r.sqft ?? (r.floorplan ? Math.round(r.floorplan.totalAreaSqft) : undefined);
  const rate = r.listing?.askingRate;
  const monthlyRent = rate && sqft ? Math.round((rate * sqft) / 12) : r.listing?.kind !== "sale" && r.listing?.price ? r.listing.price : undefined;
  const lo = r.work.reduce((s, w) => s + w.low, 0), hi = r.work.reduce((s, w) => s + w.high, 0);
  const buildOut = r.work.length ? ([lo, hi] as [number, number]) : r.costRange;
  const ti = r.tiAllowance ?? (spec.tiPerSqft && sqft ? spec.tiPerSqft * sqft : undefined);
  const firstYear = monthlyRent !== undefined && buildOut ? ([monthlyRent * 12 + buildOut[0], monthlyRent * 12 + buildOut[1]] as [number, number]) : undefined;
  return {
    name: r.name, address: r.address, verdict: r.verdict, summary: r.summary, reasons: r.reasons, sqft: sqft ?? null,
    askingRatePerSqftYear: rate ?? null, monthlyRent: monthlyRent ?? null, buildOutCost: buildOut ?? null, tiAllowance: ti ?? null,
    firstYearCostRange: firstYear ?? null, weeksToOpen: r.weeksToOpen, budgetMonthly: spec.budgetMonthly ?? null, budgetTotal: spec.budgetTotal ?? null,
    rooms: r.fit.assignment.map((a) => `${a.req}: ${a.roomId ? "already built" : "not built"}`),
    fitScore: r.fit.score, hardFails: r.fit.hardFails,
    work: r.work.map((w) => ({ item: w.item, cost: range(w.low, w.high), weeks: `${w.weeksLow}-${w.weeksHigh}` })),
    rules: r.rules.map((x) => `${x.rule}: ${x.status}: ${x.detail}`),
    unknowns: r.unknowns.map((u) => u.question),
  };
}
type Facts = ReturnType<typeof reportFacts>;

const SAVE = /^\s*(please\s+|can you\s+|could you\s+)?(save|bookmark|favou?rite)\b/i;
const SHOW = /^\s*(please\s+|can you\s+|could you\s+)?(show|open|take me|go to|switch to|bring up)\b/i;
const TAB_WORDS: [(typeof TABS)[number], RegExp][] = [
  ["lease", /lease|coach|contract/],
  ["broker", /broker|email|message|contact/],
  ["neighborhood", /neighbou?rhood|traffic|area|nearby/],
  ["furnish", /furnish|furniture|layout|design/],
  ["inside", /inside|scan|tour|floor ?plan|3d/],
  ["overview", /overview|summary|report/],
];

export function detectAction(text: string): ChatAction | undefined {
  if (SAVE.test(text)) return { type: "save" };
  if (!SHOW.test(text)) return undefined;
  const t = TAB_WORDS.find(([, re]) => re.test(text.toLowerCase()));
  return t ? { type: "tab", tab: t[0] } : undefined;
}

export function fallbackReply(q: string, f: Facts): string {
  const t = q.toLowerCase();
  const unk = (what: string) => `${what} is not on record. Ask the broker.`;
  if (/total|first.?year|all in|how much|cost|price|rent|afford|budget/.test(t)) {
    const parts: string[] = [];
    if (f.monthlyRent !== null) parts.push(`Rent: ${f.askingRatePerSqftYear ? `${$(f.askingRatePerSqftYear)}/sqft/yr x ${f.sqft} sqft / 12 = ` : ""}about ${$(f.monthlyRent)} a month.`);
    else parts.push(unk("The rent"));
    parts.push(f.buildOutCost ? `Build-out: ${range(...f.buildOutCost)}.` : "Build-out: no work is listed.");
    if (f.tiAllowance) parts.push(`Landlord allowance on record: ${$(f.tiAllowance)}.`);
    if (f.firstYearCostRange) parts.push(`First year, rent x 12 + build-out: ${range(...f.firstYearCostRange)}.`);
    if (f.budgetMonthly && f.monthlyRent !== null) parts.push(`Your budget is ${$(f.budgetMonthly)} a month, so rent is ${f.monthlyRent <= f.budgetMonthly ? "within" : "over"} it.`);
    return parts.join(" ");
  }
  if (/week|time|long|open|ready|when/.test(t)) return `About ${f.weeksToOpen[0]} to ${f.weeksToOpen[1]} weeks of permits and build-out before you can open.`;
  if (/room|space|fit|bed|bath|kitchen|office/.test(t)) return f.rooms.length ? `Your rooms: ${f.rooms.join("; ")}.` : unk("Room fit");
  if (/park/.test(t)) {
    const p = f.rules.filter((x) => /park/i.test(x)).concat(f.unknowns.filter((x) => /park/i.test(x)));
    return p.length ? p.join(" ") : unk("Parking");
  }
  return "I can answer questions about the price, total first-year cost, build-out, time to open, rooms and parking for this space. I can also open a tab or save it for you.";
}
