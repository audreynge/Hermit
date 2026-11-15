import { sqftOf } from "../query/shells";
import { packFor } from "../uses/packs";
import { SIZE_OPTIONS, TIMING_OPTIONS, USE_OPTIONS, type Draft } from "../spec/survey";
import type { Shell } from "../types";

export type Field = "city" | "use" | "musts" | "price" | "days" | "rooms" | "accessibility" | "parking" | "size" | "moveIn" | "budget" | "beds" | "power" | "bays" | "sprinklers" | "baths" | "other";
export type Question = { field: Field; text: string; why: string; quick: string[]; split?: [number, number]; multi?: boolean };

const answered = (spec: Draft, f: Field, asked: string[]) => {
  if (f === "city" || f === "use") return !!(f === "city" ? spec.city : spec.useType);
  if (f === "rooms" && spec.mode !== "home") return asked.includes("roomsOk") || (spec.rooms.some((r) => r.label !== "bathroom") && spec.input !== "survey");
  if (asked.includes(f)) return true;
  switch (f) {
    case "musts": return false;
    case "price": return spec.avgPrice != null;
    case "days": return spec.daysOpen != null;
    case "size": return !!spec.sizeSqft || !!spec.headcount || (spec.mode === "home" && spec.beds != null);
    case "rooms": return spec.mode === "home" ? spec.beds != null && spec.baths != null : spec.rooms.some((r) => r.label !== "bathroom") && spec.input !== "survey";
    case "accessibility": return spec.needs.wheelchair != null || spec.needs.stepFree != null;
    case "parking": return spec.needs.parkingStalls != null || spec.needs.parking != null;
    case "moveIn": return !!spec.moveInBy;
    case "budget": return !!spec.budgetMonthly || !!spec.budgetTotal;
    case "beds": return spec.beds != null;
    case "power": return spec.needs.heavyPower != null || spec.needs.threePhase != null;
    case "bays": return spec.needs.driveInBays != null;
    case "sprinklers": return spec.needs.esfr != null;
    case "baths": return spec.mode === "home" || spec.baths != null || spec.rooms.some((r) => r.label === "bathroom");
    case "other": return false;
  }
};

// How each question would split today's pool: [kept if the answer is the restrictive one, total].
function split(f: Field, pool: Shell[], spec: Draft): [number, number] | undefined {
  const n = pool.length;
  if (!n) return undefined;
  const pack = packFor(spec);
  switch (f) {
    case "accessibility": return [pool.filter((s) => (s.floorCount ?? 1) <= 1).length, n];
    case "rooms": {
      const want = pack.rooms.reduce((s, r) => s + r.count, 0);
      return [pool.filter((s) => (s.roomCount ?? 0) >= Math.max(2, Math.round(want * 0.6))).length, n];
    }
    case "size": {
      const known = pool.filter((s) => sqftOf(s));
      const mid = known.map((s) => sqftOf(s)!).sort((a, b) => a - b)[Math.floor(known.length / 2)] ?? 0;
      return [pool.filter((s) => !sqftOf(s) || sqftOf(s)! >= mid).length, n];
    }
    case "beds": return [pool.filter((s) => (s.beds ?? 0) >= 2).length, n];
    default: return undefined; // no field in the bundle splits on it yet
  }
}

export const CITY_AGAIN = "Which city should I search, Houston or Los Angeles?";
export const plural = (label: string, count: number) => (count > 1 && !/storage|open$/.test(label) ? `${label}s` : label);
export const roomList = (rooms: { label: string; count: number }[]) => rooms.map((r) => `${r.count} ${plural(r.label, r.count)}`).join(", ");

const TEXT: Record<Field, (spec: Draft, asked: string[]) => string> = {
  city: (_spec, asked) => asked.includes("city") ? CITY_AGAIN : "Hi, I'm Hermit. I find spaces that are already built for what you need, so you build less. I cover Houston and Los Angeles right now. Which city should I search?",
  use: () => "What are you opening, or looking for?",
  price: (spec) => `What does a typical customer spend per visit${packFor(spec).key === "medical" ? " (what you collect per patient visit)" : ""}? I'll turn the rent into “customers a day”.`,
  days: () => "How many days a week will you be open?",
  musts: () => "Last one: is there anything that's a must-have for you that I haven't asked about? Tell me in your own words.",
  rooms: (spec, asked) => {
    const pack = packFor(spec);
    if (spec.mode === "home") return "How many bedrooms and bathrooms do you need?";
    if (asked.includes("roomsOffer")) return `No problem. I'll plan on a typical ${pack.label.toLowerCase()}: ${roomList(pack.rooms)}. Does that work, or what would you change?`;
    if (asked.includes("roomsRetry")) return "I didn't catch the numbers. Could you tell me a count for each room, like how many offices or treatment rooms, and how many bathrooms?";
    return `What rooms does your ${pack.label.toLowerCase()} need, and how many of each? Please include bathrooms.`;
  },
  baths: () => "And how many bathrooms do you need?",
  accessibility: () => "Will anyone on your team or among your visitors need step-free or wheelchair access?",
  parking: () => "How many parking spaces do you need for staff and visitors at the busiest time?",
  size: (spec) => spec.mode === "home"
    ? "How many bedrooms do you need?"
    : "Roughly how much space? Square feet is great, or tell me how many people work there on a busy day.",
  moveIn: () => "When do you need to be in? It decides how much build-out is worth waiting for.",
  budget: (spec) => spec.mode === "home" ? "What's your budget? Tell me if that's monthly rent or a purchase price." : "What can you spend on rent each month, in total rather than per square foot?",
  beds: () => "How many bedrooms and bathrooms?",
  power: () => "Will you run heavy equipment that needs three-phase or high-amp power?",
  bays: () => "How many drive-in or dock doors do you need?",
  sprinklers: () => "Will you store goods above 12 feet? That decides whether you need ESFR sprinklers.",
  other: () => "Is there anything else about the space you want me to know?",
};
const ask = (field: Field, spec: Draft, asked: string[] = []): Pick<Question, "field" | "text" | "quick"> => ({ field, text: TEXT[field](spec, asked), quick: [] });
// The same question again, after an answer that didn't fit it.
export const askAgain = (field: Field, spec: Draft, asked: string[]): Question =>
  ({ ...ask(field, spec, asked), why: BASIC_WHY[field === "baths" ? "rooms" : field] ?? WHY[field] ?? AGAIN_WHY[field] ?? "Optional, but it sharpens the matches." });
const AGAIN_WHY: Partial<Record<Field, string>> = {
  price: "It's half of the break-even math.",
  days: "The other half: it spreads the rent across your open days.",
  moveIn: "It sets how much construction time is acceptable when I rank spaces.",
};

const PACK_FIELD: Record<string, Field> = { size: "size", rooms: "rooms", accessibility: "accessibility", parking: "parking", moveIn: "moveIn", budget: "budget", beds: "beds", power: "power", bays: "bays", sprinklers: "sprinklers" };

const WHY: Partial<Record<Field, string>> = {
  parking: "Parking rules change by use, so I need it to check them.",
  accessibility: "If yes, I will measure every hallway and check for stairs.",
  rooms: "I match these to the real rooms in each scan.",
  budget: "I use it to flag spaces that cost more than you can spend.",
  power: "Power upgrades are one of the slowest things to fix.",
};

const BASICS: Field[] = ["city", "use", "rooms", "size", "moveIn"];
const BASIC_WHY: Partial<Record<Field, string>> = {
  city: "Every scan I have is in Houston or Los Angeles.",
  use: "It decides which expert checklist I bring: plumbing for a salon, exam-room sinks for a clinic.",
  rooms: "Rooms and bathrooms decide plumbing, size and what I look for in each scan.",
  size: "A guess is fine. I'll measure the real spaces myself.",
};

const bathsPending = (spec: Draft, asked: string[]) => answered(spec, "rooms", asked) && !answered(spec, "baths", asked);
export const basicsDone = (spec: Draft, asked: string[]) => BASICS.every((f) => answered(spec, f, asked)) && !bathsPending(spec, asked);

// Basics first (the old survey, asked in chat), then the unanswered question that matters most for this use and
// splits the remaining spaces the most, then a last sweep for must-haves.
export function nextQuestion(spec: Draft, pool: Shell[], asked: string[]): Question | null {
  const basic = BASICS.find((f) => !answered(spec, f, asked));
  if (basic) {
    const t = ask(basic, spec, asked);
    const sp = basic === "size" && spec.city ? split("size", pool, spec) : undefined;
    return { ...t, why: BASIC_WHY[basic] ?? "It sets how much construction time is acceptable when I rank spaces.", split: sp };
  }
  const pack = packFor(spec);
  const options = Object.entries(pack.critical).flatMap(([k, crit]) => {
    const field = PACK_FIELD[k];
    if (!field || BASICS.includes(field) || answered(spec, field, asked)) return [];
    const sp = split(field, pool, spec);
    const gain = sp && sp[1] ? 1 - Math.abs(sp[0] / sp[1] - 0.5) * 2 : 0; // 1 = even split, 0 = no split
    return [{ field, score: crit * (0.35 + gain), sp }];
  });
  if (!options.length) {
    // Two money inputs for walk-in businesses, so the report can say "you need about 14 customers a day".
    if (spec.mode === "business") for (const f of ["price", "days"] as Field[]) if (!answered(spec, f, asked))
      return { ...ask(f, spec), why: f === "price" ? "It's half of the break-even math." : "The other half: it spreads the rent across your open days." };
    if (asked.includes("musts")) return null;
    return { ...ask("musts", spec), why: "So nothing important slips through before I go looking." };
  }
  options.sort((a, b) => b.score - a.score);
  const best = options[0];
  const t = ask(best.field, spec);
  const why = best.sp && best.sp[0] !== best.sp[1]
    ? `I'm asking because your answer narrows ${best.sp[1].toLocaleString()} spaces to as few as ${Math.min(best.sp[0], best.sp[1] - best.sp[0]).toLocaleString()}.`
    : WHY[best.field] ?? "It changes what I check for.";
  return { ...t, why, split: best.sp };
}

// Rooms and bathrooms come first, so a bathroom count missing from the room answer is asked right away.
export const interviewQuestion = (spec: Draft, pool: Shell[], asked: string[]): Question | null =>
  bathsPending(spec, asked) ? { ...ask("baths", spec), why: BASIC_WHY.rooms! } : nextQuestion(spec, pool, asked);

// Optional questions once the essentials are done: one per turn, never a dead end.
export function deeperQuestion(spec: Draft, asked: string[]): Question | null {
  const f = (["budget", "parking", "accessibility", "other"] as Field[]).find((x) => !answered(spec, x, asked));
  return f ? { ...ask(f, spec), why: WHY[f] ?? "Optional, but it sharpens the matches." } : null;
}

// 0-100 share of the essentials filled; 100 only once the interview is ready.
export function progress(spec: Draft, asked: string[], ready: boolean): number {
  if (ready) return 100;
  const pack = packFor(spec);
  const specifics = [...Object.keys(pack.critical).map((k) => PACK_FIELD[k]).filter((f): f is Field => !!f && !BASICS.includes(f) && f !== "budget" && f !== "beds"), ...(spec.mode === "business" ? (["price", "days"] as Field[]) : [])];
  const parts: [number, number][] = [
    [8, +!!spec.useType], [8, +!!spec.city], [16, +answered(spec, "rooms", asked)], [10, +answered(spec, "baths", asked)],
    [14, +answered(spec, "size", asked)], [10, +answered(spec, "moveIn", asked)], [10, +asked.includes("musts")],
    [24, specifics.length ? specifics.filter((f) => answered(spec, f, asked)).length / specifics.length : 1],
  ];
  return Math.min(99, Math.round(parts.reduce((t, [w, v]) => t + w * v, 0)));
}
