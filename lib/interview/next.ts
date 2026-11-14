import { sqftOf } from "../query/shells";
import { packFor } from "../uses/packs";
import { SIZE_OPTIONS, TIMING_OPTIONS, USE_OPTIONS, type Draft } from "../spec/survey";
import type { Shell } from "../types";

export type Field = "city" | "use" | "musts" | "price" | "days" | "rooms" | "accessibility" | "parking" | "size" | "moveIn" | "budget" | "beds" | "power" | "bays" | "sprinklers";
export type Question = { field: Field; text: string; why: string; quick: string[]; split?: [number, number]; multi?: boolean };

const answered = (spec: Draft, f: Field, asked: string[]) => {
  if (asked.includes(f)) return true;
  switch (f) {
    case "city": return !!spec.city;
    case "use": return !!spec.useType;
    case "musts": return false;
    case "price": return spec.avgPrice != null;
    case "days": return spec.daysOpen != null;
    case "size": return !!spec.sizeSqft || !!spec.headcount || (spec.mode === "home" && spec.beds != null);
    case "rooms": return spec.rooms.some((r) => r.label !== "bathroom") && spec.input !== "survey";
    case "accessibility": return spec.needs.wheelchair != null || spec.needs.stepFree != null;
    case "parking": return spec.needs.parkingStalls != null || spec.needs.parking != null;
    case "moveIn": return !!spec.moveInBy;
    case "budget": return !!spec.budgetMonthly || !!spec.budgetTotal;
    case "beds": return spec.beds != null;
    case "power": return spec.needs.heavyPower != null || spec.needs.threePhase != null;
    case "bays": return spec.needs.driveInBays != null;
    case "sprinklers": return spec.needs.esfr != null;
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

const TEXT: Record<Field, (spec: Draft) => { text: string; quick: string[] }> = {
  city: () => ({ text: "Hi, I'm Hermit. I find spaces that are already built for what you need, so you build less. Which city should I search?", quick: ["Houston", "Los Angeles"] }),
  use: () => ({ text: "What are you opening, or looking for?", quick: USE_OPTIONS.map((u) => u.label) }),
  price: (spec) => ({ text: `What does a typical customer spend per visit${packFor(spec).key === "salon" ? " (a cut, a color)" : packFor(spec).key === "medical" ? " (what you collect per patient visit)" : ""}? I'll turn the rent into “customers a day”.`, quick: ["About $25", "About $55", "About $120", "Not sure yet"] }),
  days: () => ({ text: "How many days a week will you be open?", quick: ["5 days", "6 days", "7 days"] }),
  musts: (spec) => ({ text: "Last one: any must-haves I haven't asked about? Pick any that matter, then tap Done.", quick: packFor(spec).chips }),
  rooms: (spec) => {
    const pack = packFor(spec);
    const list = pack.rooms.filter((r) => r.label !== "bathroom").map((r) => `${r.count > 1 ? `${r.count} ` : ""}${r.label}${r.count > 1 ? "s" : ""}`);
    return { text: `A typical ${pack.label.toLowerCase()} has ${list.join(", ")}. What rooms do you actually need, and which ones need water (sinks, showers)?`, quick: pack.key === "medical" ? ["2 exam rooms with sinks + a lab", "3 exam rooms + a procedure room", "That typical layout works"] : pack.key === "salon" ? ["6 stations + 2 shampoo sinks", "4 stations + a private room", "That typical layout works"] : ["That typical layout works", "Fewer rooms, more open floor", "Add a conference room"] };
  },
  accessibility: () => ({ text: "Will anyone on your team or among your visitors need step-free or wheelchair access?", quick: ["Yes, wheelchair access", "Step-free entry is enough", "No special needs"] }),
  parking: () => ({ text: "How many parking spaces do you need for staff and visitors at the busiest time?", quick: ["About 5", "About 10", "20 or more", "Street parking is fine"] }),
  size: (spec) => spec.mode === "home"
    ? { text: "How many bedrooms do you need?", quick: ["1 bedroom", "2 bedrooms", "3 bedrooms", "4 bedrooms"] }
    : { text: "Roughly how much space? Square feet is great, or tell me how many people work there on a busy day.", quick: [...SIZE_OPTIONS.slice(0, 4).map((o) => o.label), "Not sure yet"] },
  moveIn: () => ({ text: "When do you need to be in? It decides how much build-out is worth waiting for.", quick: TIMING_OPTIONS.map((o) => o.label) }),
  budget: (spec) => ({ text: spec.mode === "home" ? "What's your budget? Tell me if that's monthly rent or a purchase price." : "What can you spend on rent per month? (Total, not per square foot.)", quick: spec.mode === "home" ? ["$2,500 / month", "$4,000 / month", "$800k purchase"] : ["$4,000 / month", "$8,000 / month", "Not sure yet"] }),
  beds: () => ({ text: "How many bedrooms and bathrooms?", quick: ["2 bed / 1 bath", "3 bed / 2 bath", "4 bed / 3 bath"] }),
  power: () => ({ text: "Will you run heavy equipment that needs three-phase or high-amp power?", quick: ["Yes, three-phase", "Standard power is fine", "Not sure"] }),
  bays: () => ({ text: "How many drive-in or dock doors do you need?", quick: ["None", "1–2 drive-in doors", "Dock-high doors"] }),
  sprinklers: () => ({ text: "Will you store goods above 12 feet? That decides whether you need ESFR sprinklers.", quick: ["Yes, high-piled storage", "No, under 12 ft"] }),
};

const PACK_FIELD: Record<string, Field> = { size: "size", rooms: "rooms", accessibility: "accessibility", parking: "parking", moveIn: "moveIn", budget: "budget", beds: "beds", power: "power", bays: "bays", sprinklers: "sprinklers" };

const WHY: Partial<Record<Field, string>> = {
  parking: "Parking rules change by use, so the Code crab needs it.",
  accessibility: "If yes, my Access crab measures every hallway and checks for stairs.",
  rooms: "The Inspector maps these onto the real rooms in each scan.",
  budget: "My Advocate uses it to flag spaces that won't pencil out.",
  power: "Power upgrades are one of the slowest things to fix.",
};

const BASICS: Field[] = ["city", "use", "size", "moveIn"];
const BASIC_WHY: Partial<Record<Field, string>> = {
  city: "Every scan I have is in Houston or Los Angeles.",
  use: "It decides which expert checklist I bring: plumbing for a salon, exam-room sinks for a clinic.",
  size: "A guess is fine. I'll measure the real spaces myself.",
};

export const basicsDone = (spec: Draft, asked: string[]) => BASICS.every((f) => answered(spec, f, asked));

// Basics first (the old survey, asked in chat), then the unanswered question that matters most for this use and
// splits the remaining spaces the most, then a last sweep for must-haves.
export function nextQuestion(spec: Draft, pool: Shell[], asked: string[]): Question | null {
  const basic = BASICS.find((f) => !answered(spec, f, asked));
  if (basic) {
    const t = TEXT[basic](spec);
    const sp = basic === "size" && spec.city ? split("size", pool, spec) : undefined;
    return { field: basic, ...t, why: BASIC_WHY[basic] ?? "It sets how much construction time is acceptable when I rank spaces.", split: sp };
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
      return { field: f, ...TEXT[f](spec), why: f === "price" ? "It's half of the break-even math." : "The other half: it spreads the rent across your open days." };
    if (asked.includes("musts")) return null;
    return { field: "musts", ...TEXT.musts(spec), why: "So nothing important slips through before the crew goes in.", multi: true };
  }
  options.sort((a, b) => b.score - a.score);
  const best = options[0];
  const t = TEXT[best.field](spec);
  const why = best.sp && best.sp[0] !== best.sp[1]
    ? `I'm asking because your answer narrows ${best.sp[1].toLocaleString()} spaces to as few as ${Math.min(best.sp[0], best.sp[1] - best.sp[0]).toLocaleString()}.`
    : WHY[best.field] ?? "It changes what the crew checks for.";
  return { field: best.field, ...t, why, split: best.sp };
}
