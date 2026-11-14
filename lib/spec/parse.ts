import type { City, Mode, RequirementSpec, RoomReq } from "../types";

type Defaults = { city?: City; mode?: Mode; useType?: string };

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const num = (s: string) => WORD_NUM[s.toLowerCase()] ?? Number(s.replace(/,/g, ""));
const money = (n: string, unit?: string) => Number(n.replace(/,/g, "")) * (unit?.toLowerCase() === "k" ? 1e3 : unit?.toLowerCase() === "m" ? 1e6 : 1);

const ROOM_WORDS: [RegExp, string, boolean][] = [
  [/exam(?:ination)? rooms?|treatment rooms?|operator(?:y|ies)/, "exam room", false],
  [/(?:private |home )?offices?/, "office", false],
  [/restrooms?|bathrooms?/, "bathroom", true],
  [/waiting rooms?|reception(?: area)?|lobby/, "reception", false],
  [/conference rooms?|meeting rooms?/, "conference", false],
  [/break ?rooms?|kitchens?|kitchenettes?/, "kitchen", false],
  [/storage rooms?|closets?/, "storage", false],
  [/styling stations?|chairs?/, "open", false],
  [/labs?\b/, "lab", false],
  [/bedrooms?/, "bedroom", false],
];
const FIXTURES = ["sink", "toilet", "shower", "hood", "drain"];
const USE_NOUN = /\b([a-z]+\s)?(clinic|office|salon|studio|warehouse|restaurant|cafe|shop|store|gym|bakery|lab|showroom|practice|spa|brewery|distribution center|daycare|boutique)\b/;
const NOT_QUALIFIER = new Set(["sf", "ft", "a", "an", "the", "small", "new", "need", "my", "our", "big", "large", "feet", "for"]);

export function parseText(text: string, d: Defaults = {}): RequirementSpec {
  const t = text.toLowerCase();
  const mode: Mode =
    /warehouse|distribution|manufactur|industrial|drive-in|loading dock|esfr|three-phase|3-phase|heavy power|fulfillment/.test(t) ? "enterprise"
    : /bed(room)?s?\b|\bhouse\b|\bhome\b(?! office)|apartment|condo|townhouse/.test(t.replace(/home office/g, "")) ? "home"
    : d.mode ?? "business";
  const city: City = /houston/.test(t) ? "houston" : /los angeles|\bl\.?a\.?\b/.test(t) ? "los_angeles" : d.city ?? "los_angeles";

  let useType = d.useType ?? "office";
  if (mode === "home") useType = "home";
  else {
    const m = t.match(USE_NOUN);
    if (m) useType = m[1] && !NOT_QUALIFIER.has(m[1].trim()) && !/\d/.test(m[1]) ? `${m[1].trim()} ${m[2]}` : m[2];
  }

  const spec: RequirementSpec = { mode, city, useType, rooms: [], needs: {}, priorities: {}, input: "text", rawText: text };

  const range = t.match(/([\d,]{3,})\s*(?:-|–|to)\s*([\d,]{3,})\s*(?:sq\.?\s?ft|square feet|sf)\b/);
  const single = t.match(/([\d,]{3,})\s*(?:sq\.?\s?ft|square feet|sf)\b/);
  if (range) spec.sizeSqft = [num(range[1]), num(range[2])];
  else if (single) spec.sizeSqft = [Math.round(num(single[1]) * 0.8), Math.round(num(single[1]) * 1.2)];

  const people = t.match(/(\d+)\s*(?:people|employees|staff|person|seats|desks)/);
  if (people) {
    spec.headcount = Number(people[1]);
    spec.sizeSqft ??= [spec.headcount * 150, spec.headcount * 250];
  }

  const monthly = t.match(/\$\s?([\d,.]+)\s*(k|m)?\s*(?:\/|per\s*|a\s*)(?:mo\b|month)/);
  const total = t.match(/\$\s?([\d,.]+)\s*(k|m)?\b/);
  if (monthly) spec.budgetMonthly = money(monthly[1], monthly[2]);
  else if (total) {
    const v = money(total[1], total[2]);
    if (mode === "home" && v >= 50000) spec.budgetTotal = v;
    else spec.budgetMonthly = v;
  }

  if (mode === "home") {
    const beds = t.match(/(\d+)\s*-?\s*(?:bed(?:room)?s?|br|bd)\b/);
    const baths = t.match(/(\d+(?:\.5)?)\s*-?\s*(?:bath(?:room)?s?|ba)\b/);
    if (beds) spec.beds = Number(beds[1]);
    if (baths) spec.baths = Number(baths[1]);
  }

  const qty = "(\\d+|a|an|one|two|three|four|five|six|seven|eight)\\s+(?:[a-z]+\\s)?";
  for (const [re, label, hardByDefault] of ROOM_WORDS) {
    if (mode === "home" && (label === "bathroom" || label === "bedroom")) continue;
    const m = t.match(new RegExp(`${qty}(${re.source})((?:\\s+with\\s+[a-z ]+?)?)(?=[,.;]|\\s|$)`));
    const bare = !m && label === "office" && mode === "home" && /home office/.test(t);
    if (!m && !bare) continue;
    const count = m ? num(m[1]) : 1;
    const withClause = m?.[3] ?? "";
    const fixtures = FIXTURES.filter((f) => withClause.includes(f));
    const room: RoomReq = { label, count, hard: hardByDefault && mode === "business" };
    if (fixtures.length) room.fixtures = fixtures;
    spec.rooms.push(room);
  }

  const bays = t.match(/(\d+|a|one|two|three|four)\s+(?:grade-level\s+)?drive-?in\s+(?:doors?|bays?)/);
  const stalls = t.match(/(\d+)\s+(?:parking\s+)?(?:spaces|stalls)/) ?? t.match(/parking for (\d+)/);
  if (/heavy power/.test(t)) spec.needs.heavyPower = true;
  if (/three-phase|3-phase|3 phase/.test(t)) spec.needs.threePhase = true;
  if (/esfr/.test(t)) spec.needs.esfr = true;
  if (bays) spec.needs.driveInBays = num(bays[1]);
  if (stalls) spec.needs.parkingStalls = Number(stalls[1]);
  if (/ground floor|ground-level|street level/.test(t)) spec.needs.groundFloor = true;
  if (/wheelchair|\bada\b|accessible/.test(t)) spec.needs.wheelchair = true;
  if (/step-free|no stairs|stepless/.test(t)) spec.needs.stepFree = true;
  if (/patio|outdoor|yard|terrace/.test(t)) spec.needs.outdoorArea = true;
  if (/restaurant|cafe|bakery|commercial kitchen/.test(t)) spec.needs.kitchen = true;

  return spec;
}

export type Block = { id: string; label: string; kind?: "room" | "object"; x: number; y: number; w: number; h: number };

const touches = (a: Block, b: Block) =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const inside = (o: Block, r: Block) => {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
};
const ROOM_ALIAS: Record<string, string> = { "waiting area": "reception", "procedure room": "procedure room" };
const CIRCULATION = new Set(["hallway", "corridor"]);
const OBJECT_FIXTURE: Record<string, string> = { sink: "sink", kitchenette: "sink", toilet: "toilet", shower: "shower" };

// Blocks are in feet; drawn areas become minimums at 85% to allow for wall thickness and imprecise drawing.
export function fromLayout(blocks: Block[], base: { mode: Mode; city: City; useType: string }): RequirementSpec {
  const rooms = blocks.filter((b) => b.kind !== "object");
  const objects = blocks.filter((b) => b.kind === "object");
  const labelOf = (b: Block) => ROOM_ALIAS[b.label.toLowerCase()] ?? b.label.toLowerCase();
  const groups = new Map<string, Block[]>();
  for (const b of rooms) if (!CIRCULATION.has(labelOf(b))) groups.set(labelOf(b), [...(groups.get(labelOf(b)) ?? []), b]);

  const reqs: RoomReq[] = [...groups].map(([label, bs]) => {
    const adj = new Set<string>();
    for (const b of bs) for (const o of rooms) if (o.id !== b.id && touches(b, o) && !CIRCULATION.has(labelOf(o))) adj.add(labelOf(o));
    const fixtures = [...new Set(objects.filter((o) => OBJECT_FIXTURE[o.label.toLowerCase()] && bs.some((b) => inside(o, b))).map((o) => OBJECT_FIXTURE[o.label.toLowerCase()]))];
    return {
      label, count: bs.length, hard: false,
      minSqft: Math.round(Math.min(...bs.map((b) => b.w * b.h)) * 0.85),
      ...(adj.size ? { adjacentTo: [...adj] } : {}),
      ...(fixtures.length ? { fixtures } : {}),
    };
  });
  const total = rooms.reduce((s, b) => s + b.w * b.h, 0);
  return { ...base, rooms: reqs, needs: {}, priorities: {}, input: "layout", sizeSqft: [Math.round(total), Math.round(total * 2)] };
}
