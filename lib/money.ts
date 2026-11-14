// Break-even and buy-vs-rent screening math. Simple on purpose: two inputs from the interview turn a lease into
// "clients a day", which anyone can judge.
export type MoneyInputs = { price: number; daysPerWeek: number; rent: number; utilities: number; other: number; costPerSale?: number };

export const WEEKS_PER_MONTH = 52 / 12;

export function breakEven(m: MoneyInputs) {
  const monthlyCosts = m.rent + m.utilities + m.other;
  const perSale = m.price - (m.costPerSale ?? 0);
  const daysPerMonth = m.daysPerWeek * WEEKS_PER_MONTH;
  if (perSale <= 0 || daysPerMonth <= 0) return null;
  const perDay = monthlyCosts / (perSale * daysPerMonth);
  return { monthlyCosts, perDay, perDayRounded: Math.ceil(perDay), perMonth: Math.ceil(perDay * daysPerMonth) };
}

// SBA 504-style owner-occupied purchase: as little as 10% down. Screening only; a lender sets real terms.
export function buyEstimate(price: number, ratePct = 7, years = 25, downPct = 10) {
  const down = (price * downPct) / 100;
  const loan = price - down;
  const r = ratePct / 100 / 12, n = years * 12;
  const monthly = r ? (loan * r) / (1 - (1 + r) ** -n) : loan / n;
  return { down, loan, monthly };
}

// Reads a simple P&L CSV with columns like "category,amount" or "month,revenue,expenses"; returns monthly averages.
export function readPnl(csv: string): { revenue?: number; expenses?: number; rows: number } {
  const lines = csv.trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  if (lines.length < 2) return { rows: 0 };
  const head = lines[0].map((h) => h.toLowerCase());
  const num = (s?: string) => Number((s ?? "").replace(/[$,]/g, "")) || 0;
  const rev = head.findIndex((h) => /revenue|sales|income/.test(h)), exp = head.findIndex((h) => /expense|cost/.test(h));
  const rows = lines.slice(1).filter((r) => r.some(Boolean));
  if (rev >= 0 || exp >= 0) {
    return { rows: rows.length, revenue: rev >= 0 ? rows.reduce((s, r) => s + num(r[rev]), 0) / rows.length : undefined, expenses: exp >= 0 ? rows.reduce((s, r) => s + num(r[exp]), 0) / rows.length : undefined };
  }
  const cat = 0, amt = head.length - 1;
  let revenue = 0, expenses = 0;
  for (const r of rows) (/revenue|sales|income/i.test(r[cat]) ? (revenue += num(r[amt])) : (expenses += num(r[amt])));
  return { rows: rows.length, revenue, expenses };
}
