import type { Draft } from "../spec/survey";
import type { Field } from "./next";

// Deterministic answer checks, so "Lease" is never accepted as a price and "$6,000 a month" never as days open.
// Runs with or without an LLM. Free-text questions (use, rooms, must-haves) are always accepted here.

export type Check =
  | { kind: "ok" }
  | { kind: "skip" } // "not sure": accepted, nothing stored
  | { kind: "bad"; hint: string }
  | { kind: "other"; field: Field; patch: Partial<Draft>; note: string }; // answers a different question

const SKIP = /\b(not sure|unsure|don'?t know|dunno|no idea|no clue|skip|pass|rather not|prefer not|n\/a|tbd)\b/i;
const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m)?\b|\b\d[\d,]*(?:\.\d+)?\s*(?:k\b|grand\b|dollars?\b|bucks\b|usd\b)/gi;
const MONTHLY = /month|\/\s*mo\b|\bmo\b|monthly|\brent\b/i;
const PER_VISIT = /per (visit|patient|customer|person|client|appointment|session|ticket)|a (visit|patient|customer|person|client|head)|each\b/i;
const WORD_N: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_RE = /\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?\b/g;
const YES_NO = /\b(yes|yeah|yep|yup|sure|no|nope|nah|none|not really|maybe|probably|definitely)\b/i;

const money = (raw: string) => {
  const m = raw.toLowerCase().replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|m|grand)?/);
  return m ? Number(m[1]) * (m[2] === "k" || m[2] === "grand" ? 1e3 : m[2] === "m" ? 1e6 : 1) : NaN;
};
const firstNumber = (t: string) => {
  const d = t.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (d) return Number(d[0]);
  const w = t.toLowerCase().match(new RegExp(`\\b(${Object.keys(WORD_N).join("|")})\\b`));
  return w ? WORD_N[w[1]] : NaN;
};
const $ = (n: number) => `$${n.toLocaleString("en-US")}`;

/** Days open per week from "5", "five days", "every day", "weekdays" or "Monday to Saturday". */
export function daysFrom(text: string): number | undefined {
  const t = text.toLowerCase().replace(MONEY, " ");
  if (/\b(every ?day|daily|seven days|7 days|all week|24\/7)\b/.test(t)) return 7;
  const names = [...t.matchAll(DAY_RE)].map((m) => DAYS.indexOf(m[1].slice(0, 3)));
  if (names.length >= 2 && /\b(to|through|thru|until|till)\b|[-–]/.test(t)) return ((names[1] - names[0] + 7) % 7) + 1;
  if (/\bweekdays?\b|monday to friday|mon-fri/.test(t)) return 5 + (/\b(and|plus|\+)\s*(sat|saturdays?|weekends?)\b/.test(t) ? (/weekends?/.test(t) ? 2 : 1) : 0);
  if (/\bweekends?\b/.test(t)) return 2;
  if (names.length) return names.length;
  const n = firstNumber(t);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : undefined;
}

// An answer that clearly belongs to another question, so it is stored there and the original question asked again.
function stray(field: Field, text: string, spec: Draft): Extract<Check, { kind: "other" }> | null {
  const t = text.toLowerCase();
  const cash = t.match(MONEY)?.[0];
  if (cash && field !== "budget" && MONTHLY.test(t) && spec.mode !== "home") {
    const v = money(cash);
    if (v > 0) return { kind: "other", field: "budget", patch: { budgetMonthly: v }, note: `I've noted about ${$(v)} a month as your rent budget.` };
  }
  if (cash && field !== "price" && PER_VISIT.test(t)) {
    const v = money(cash);
    if (v > 0) return { kind: "other", field: "price", patch: { avgPrice: v }, note: `I've noted about ${$(v)} per visit.` };
  }
  if (field !== "days" && /\bdays?\b.*\b(week|wk)\b|\b(weekdays|every ?day|daily)\b/.test(t)) {
    const d = daysFrom(t);
    if (d) return { kind: "other", field: "days", patch: { daysOpen: d }, note: `I've noted ${d} day${d === 1 ? "" : "s"} a week.` };
  }
  const sqft = t.replace(/,/g, "").match(/(\d{3,6})\s*(?:sq\.?\s?ft|square feet|sf)\b/);
  if (sqft && field !== "size") {
    const n = Number(sqft[1]);
    return { kind: "other", field: "size", patch: { sizeSqft: [Math.round(n * 0.8), Math.round(n * 1.2)] }, note: `I've noted about ${n.toLocaleString("en-US")} sq ft.` };
  }
  return null;
}

const HINT: Partial<Record<Field, string>> = {
  price: "A rough dollar amount works, like $60 a visit.",
  days: "A number from 1 to 7 works, or something like “Monday to Saturday”.",
  size: "A rough number works, like 2,000 sq ft or 8 people.",
  baths: "Just a number works, like 1 or 2.",
  beds: "Just a number works, like 2.",
  moveIn: "A date or a rough time works, like “March” or “in 3 months”.",
  parking: "A rough number works, like 10, or say none.",
  accessibility: "A yes or no works.",
  power: "A yes or no works.",
  sprinklers: "A yes or no works.",
  bays: "A number works, like 2, or say none.",
  budget: "A rough dollar amount works, like $5,000 a month.",
};
const bad = (field: Field): Check => ({ kind: "bad", hint: HINT[field] ?? "Could you say that another way?" });

const MOVE_IN = /\b(asap|soon|now|immediately|right away|flexible|no rush|whenever|any ?time|next|this|end of|early|late|mid|weeks?|months?|years?|days?|spring|summer|fall|autumn|winter|q[1-4]|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|20\d\d|\d{1,2}\/\d{1,2}|possible|months? out)\b/i;

/** Whether `text` answers `field`. `spec` is the draft before this answer. */
export function checkAnswer(field: Field | null | undefined, text: string, spec: Draft): Check {
  if (!field) return { kind: "ok" };
  const t = text.toLowerCase().trim();
  const noCash = t.replace(MONEY, " ");
  const n = firstNumber(noCash);
  const cash = t.match(MONEY)?.[0];
  const other = () => stray(field, text, spec);
  switch (field) {
    case "price": {
      const s = other();
      if (s) return s;
      const v = cash ? money(cash) : n;
      if (v > 0 && v <= 20000) return { kind: "ok" };
      return SKIP.test(t) ? { kind: "skip" } : bad(field);
    }
    case "days": {
      if (daysFrom(t)) return { kind: "ok" };
      return other() ?? (SKIP.test(t) ? { kind: "skip" } : bad(field));
    }
    case "budget": {
      if (cash ? money(cash) > 0 : n > 0) return { kind: "ok" };
      return SKIP.test(t) || /\b(no budget|flexible|open)\b/.test(t) ? { kind: "skip" } : bad(field);
    }
    case "size": {
      if (spec.mode === "home") return n >= 0 && n <= 20 ? { kind: "ok" } : SKIP.test(t) ? { kind: "skip" } : bad("beds");
      if (/\d/.test(noCash) && (/sq|square|feet|ft|sf|people|staff|person|employees|desks|seats|team|workers/.test(t) || n >= 100)) return { kind: "ok" };
      if (/\b(small|tiny|medium|mid-?size|large|big|huge)\b/.test(t)) return { kind: "ok" };
      return other() ?? (SKIP.test(t) ? { kind: "skip" } : bad(field));
    }
    case "baths":
    case "beds": {
      if (Number.isInteger(n) && n >= 0 && n <= 20) return { kind: "ok" };
      if (/\b(no|none|zero|typical|usual|standard|default|whatever|you pick|not sure|don'?t know|skip)\b/.test(t)) return { kind: "ok" };
      return other() ?? bad(field);
    }
    case "moveIn": {
      if (MOVE_IN.test(noCash)) return { kind: "ok" };
      return other() ?? (SKIP.test(t) ? { kind: "skip" } : bad(field));
    }
    case "parking":
    case "bays": {
      if (Number.isInteger(n) && n >= 0 && n <= 5000) return { kind: "ok" };
      if (/\b(no|none|zero|street|don'?t need|not needed|nope)\b/.test(t)) return { kind: "ok" };
      return other() ?? (SKIP.test(t) ? { kind: "skip" } : bad(field));
    }
    case "accessibility":
      return YES_NO.test(t) || /wheelchair|step|ramp|accessib|walker|stairs/.test(t) ? { kind: "ok" } : other() ?? (SKIP.test(t) ? { kind: "skip" } : bad(field));
    case "power":
      return YES_NO.test(t) || /three|3-?phase|heavy|high|standard|normal|regular/.test(t) ? { kind: "ok" } : other() ?? (SKIP.test(t) ? { kind: "skip" } : bad(field));
    case "sprinklers":
      return YES_NO.test(t) || /high|tall|feet|ft|racks?|shelv|floor|low/.test(t) ? { kind: "ok" } : other() ?? (SKIP.test(t) ? { kind: "skip" } : bad(field));
    default:
      return { kind: "ok" };
  }
}
