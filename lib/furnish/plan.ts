// "Furnish this place": decide what goes in each room for the user's intended use, then lay it out.
// Gemini (or offline templates) picks items and how they relate (place/of); layout.ts computes every position.
import { createHash } from "node:crypto";
import { z } from "zod";
import { pointInPolygon, shoelaceArea } from "../geometry/polygon";
import { geminiClient, geminiJson, type GeminiClient } from "../llm/gemini";
import { getCached, putCached } from "../regs/cache";
import { clampSize, ftIn, normName, typicalSize, type Size } from "./catalog";
import { DEPENDENT, layoutRoom, PLACES, type Layout, type Obstacle, type Place, type PlanItem, type PlanRoom } from "./layout";

const MAX_ITEMS = 30; // per request: each item is a model search + download in the browser
const MAX_COUNT: Partial<Record<Place, number>> = { grid: 20, around: 8 };
const Name = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 '&/-]*$/);
const Item = z.object({
  key: z.string().trim().min(1).max(20), name: Name, terms: z.array(Name).min(1).max(3),
  w: z.number(), d: z.number(), h: z.number(), count: z.number(), place: z.enum(PLACES),
  of: z.string().nullable(), wall: z.enum(["near-door", "far-from-door"]).nullable(), priority: z.number(),
});
const Out = z.object({ rooms: z.array(z.object({ roomId: z.string(), items: z.array(Item).max(12) })) });
const SCHEMA = z.toJSONSchema(Out);
// Parsed loosely so one bad item doesn't throw the whole plan away.
const Loose = z.object({ rooms: z.array(z.object({ roomId: z.string(), items: z.array(z.unknown()) })) });

const PROMPT = `You plan furniture layouts inside a virtual tour of a real space. Given who the user is (their intended use), what they asked, and each room's size, doors and contents, decide which movable furniture and equipment go in each room and how the pieces relate. Code computes exact positions from your roles; never give coordinates.
Per item:
- key: short id unique within the room ("bed", "t").
- name: 1-3 plain words. terms: 2-3 search words from specific to generic that would match a low-poly 3D model title.
- w, d, h in meters: w runs along the wall or front edge, d away from it (a queen bed is w 1.6, d 2.1).
- count: how many. For beside/front/around it is per anchor (4 chairs around EACH table).
- place:
  wall = back against a wall facing into the room (bed headboard-first, sofa, desk, dresser, shelving, counter, mirror)
  corner = at the end of a wall (plant, floor lamp, small cabinet)
  center = open middle (dining or conference table, dental chair, island)
  grid = repeated in rows with aisles (restaurant tables, retail racks, open-office or classroom desks)
  beside = next to its anchor on the same wall (nightstands by a bed, filing cabinet by a desk)
  front = in front of its anchor; seats face it (desk chair at a desk against the wall, styling chair at a mirror, guest chairs at an executive desk, coffee table before a sofa)
  behind = the seat of someone who works at the anchor facing the room (receptionist's chair at a reception desk, the lawyer's chair at an executive desk); code leaves room between the anchor and the wall
  around = seats around its anchor (chairs around a table)
  facing = across the room facing its anchor (TV stand facing a sofa)
- of: the anchor's key for beside/front/behind/around/facing, else null.
- Seats always belong to what they're used at: chairs and stools are front/behind/around a table, desk, counter or mirror; booths and benches are around a table. Only waiting, lounge or living-room seating stands alone. A salon station is a mirror (wall) with a styling chair in front.
- wall: "near-door" for what greets people (reception desk, host stand, checkout), "far-from-door" for beds, sofas, desks and treatment chairs, else null.
- priority: 1 essential for this use, 2 useful, 3 nice to have. Code drops 3s first when space runs out.
Rules:
- Fit the use: a dentist's operatory gets a dental chair, a stool and cabinets, not a sofa; a restaurant dining room gets tables with chairs in a grid and a host stand by the door; a home gets ordinary home furniture.
- Fit the room: footprints together should cover at most about a third of the floor. Small rooms get a few essentials.
- Hallways stay clear (nothing, or one small item). Bathroom and kitchen fixtures are built in; only add movable pieces there.
- Skip anything the scan already shows or that is already placed. One reception desk, host stand or checkout for the whole place, in the room people enter.
- No walls, built-ins, plumbing, wiring, light fixtures, art or decor. Never use vague words like "furniture" or "equipment".
- Use only the listed room ids. A room that needs nothing gets an empty list.`;

export type PlacedIn = { name: string; pos: { x: number; z: number }; size: Size; rotY: number }; // world coords
export type PlanIn = { text: string; use: string; rooms: PlanRoom[]; placed: PlacedIn[] };
export type PlanOut = { ops: object[]; reply: string; dropped: { name: string; count: number }[]; source: "gemini" | "offline" };

/** Room size along its longest wall and across it (meters), and whether it's a plain rectangle. */
function extents(poly: PlanRoom["polygon"]) {
  const edges = poly.map((a, i) => { const b = poly[(i + 1) % poly.length]; return { a, len: Math.hypot(b.x - a.x, b.y - a.y), u: { x: (b.x - a.x), y: (b.y - a.y) } }; });
  const e = edges.reduce((m, x) => (x.len > m.len ? x : m));
  const u = { x: e.u.x / e.len, y: e.u.y / e.len }, s = poly.map((p) => (p.x - e.a.x) * u.x + (p.y - e.a.y) * u.y), t = poly.map((p) => -(p.x - e.a.x) * u.y + (p.y - e.a.y) * u.x);
  const w = Math.max(...s) - Math.min(...s), d = Math.max(...t) - Math.min(...t), area = shoelaceArea(poly);
  return { w, d, area, rect: area > 0.9 * w * d };
}

export function describeRoom(r: PlanRoom, placed: string[]): string {
  const { w, d, area, rect } = extents(r.polygon);
  const m = (x: number) => x.toFixed(1);
  return [
    `- id "${r.id}" ${r.label}: ${m(w)} × ${m(d)} m (${ftIn(w)} × ${ftIn(d)}), ${Math.round(area)} m²${rect ? "" : ", irregular shape"}`,
    r.ceiling ? `ceiling ${m(r.ceiling)} m` : "",
    `${r.doors.length} door${r.doors.length === 1 ? "" : "s"}`,
    r.objects.length ? `scan shows: ${r.objects.join(", ")}` : "",
    placed.length ? `already placed: ${placed.join(", ")}` : "",
  ].filter(Boolean).join("; ");
}

/** One validated item: sizes clamped, counts capped, dependents without an anchor fixed up later by the solver. */
function toItem(raw: unknown, seen: Set<string>): PlanItem | null {
  const p = Item.safeParse(raw);
  if (!p.success) return null;
  const i = p.data;
  let key = i.key;
  while (seen.has(key)) key += "'";
  seen.add(key);
  const size = [i.w, i.d, i.h].every((n) => Number.isFinite(n) && n > 0) ? clampSize({ w: i.w, d: i.d, h: i.h }) : typicalSize(i.name).size;
  const count = Math.min(MAX_COUNT[i.place] ?? 6, Math.max(1, Math.round(i.count) || 1));
  return { key, name: normName(i.name), terms: i.terms, size, count, place: i.place, ...(i.of && DEPENDENT.includes(i.place) && { of: i.of }), ...(i.wall && { wall: i.wall }), priority: Math.min(3, Math.max(1, Math.round(i.priority) || 2)) };
}

// ---- Offline templates: [key, name, place, extras]; sizes come from the catalog.
// once: one per place (front desk, shampoo station), not one per room like a dental chair per operatory.
type T = [string, string, Place, { of?: string; count?: number; pri?: number; wall?: "near" | "far"; terms?: string[]; once?: true }?];
const HOME: Record<string, T[]> = {
  bedroom: [["bed", "bed", "wall", { wall: "far" }], ["ns", "nightstand", "beside", { of: "bed", count: 2, pri: 2 }], ["dr", "dresser", "wall", { pri: 2 }], ["lamp", "floor lamp", "corner", { pri: 3 }]],
  living: [["sofa", "sofa", "wall", { wall: "far" }], ["ct", "coffee table", "front", { of: "sofa" }], ["tv", "tv stand", "facing", { of: "sofa", pri: 2 }], ["ac", "armchair", "beside", { of: "sofa", pri: 3 }], ["rug", "rug", "front", { of: "sofa", pri: 3 }], ["plant", "plant", "corner", { pri: 3 }]],
  dining: [["t", "dining table", "center"], ["c", "dining chair", "around", { of: "t", count: 6 }], ["cab", "cabinet", "wall", { pri: 3 }]],
  kitchen: [["t", "round table", "center", { pri: 2 }], ["c", "dining chair", "around", { of: "t", count: 4, pri: 2 }]],
  office: [["desk", "desk", "wall", { wall: "far" }], ["ch", "office chair", "front", { of: "desk" }], ["bs", "bookshelf", "wall", { pri: 2 }], ["fc", "filing cabinet", "beside", { of: "desk", pri: 3 }]],
  storage: [["sh", "storage shelving", "wall", { count: 3 }]],
  utility: [["wm", "washing machine", "wall", { terms: ["washer"] }], ["dry", "dryer", "beside", { of: "wm" }]],
  garage: [["wb", "workbench", "wall"], ["sh", "storage shelving", "wall", { count: 2, pri: 2 }]],
  open: [["sofa", "sofa", "wall", { wall: "far" }], ["ct", "coffee table", "front", { of: "sofa" }], ["t", "dining table", "center", { pri: 2 }], ["c", "dining chair", "around", { of: "t", count: 4, pri: 2 }]],
  other: [["t", "table", "center", { pri: 2 }], ["c", "chair", "around", { of: "t", count: 2, pri: 2 }], ["sh", "shelf", "wall", { pri: 3 }]],
};
const EMPTY = new Set(["bathroom", "hallway", "stairs", "closet"]);
const PUBLIC = new Set(["reception", "living", "open", "dining", "other", "lobby"]); // where customers are
const WAITING: T[] = [["rd", "reception desk", "wall", { wall: "near", once: true }], ["rc", "office chair", "behind", { of: "rd", once: true }], ["wc", "waiting chair", "wall", { count: 4, pri: 2, terms: ["chair"], once: true }], ["plant", "plant", "corner", { pri: 3 }]];
const USES: { re: RegExp; public?: T[]; private?: T[]; kitchen?: T[] }[] = [
  { re: /dent/, public: WAITING, private: [["dc", "dental chair", "center"], ["st", "stool", "beside", { of: "dc" }], ["cab", "cabinet", "wall", { wall: "far", count: 2, pri: 2 }]] },
  { re: /clinic|medical|doctor|physician|therap|chiro|exam|health|vet|pediatric/, public: WAITING, private: [["et", "exam table", "wall", { wall: "far" }], ["st", "stool", "beside", { of: "et" }], ["cab", "cabinet", "wall", { pri: 2 }], ["ch", "chair", "corner", { pri: 3 }]] },
  { re: /restaurant|cafe|café|coffee|\bbar\b|ramen|diner|bistro|bakery|eatery|pizz|food|tea/, public: [["t", "four top table", "grid", { count: 20 }], ["c", "chair", "around", { of: "t", count: 4 }], ["hs", "host stand", "wall", { wall: "near", pri: 2, once: true }]], kitchen: [["pt", "prep table", "wall", { count: 2 }], ["rg", "commercial range", "wall", { wall: "far" }], ["rf", "reach-in fridge", "wall", { pri: 2 }]] },
  { re: /salon|barber|spa|nail|beauty|hair/, public: [["m", "mirror", "wall", { count: 6, wall: "far" }], ["sc", "styling chair", "front", { of: "m" }], ["rd", "reception desk", "wall", { wall: "near", pri: 2, once: true }], ["rc", "office chair", "behind", { of: "rd", pri: 2, once: true }], ["wc", "waiting chair", "wall", { count: 3, pri: 3, terms: ["chair"], once: true }]], private: [["ss", "shampoo sink", "wall", { count: 2, once: true }]] },
  { re: /retail|shop|store|boutique|showroom|gallery/, public: [["dr", "display rack", "grid", { count: 12 }], ["cc", "checkout counter", "wall", { wall: "near", once: true }]] },
  { re: /office|startup|agency|law|account|consult|studio|tech|cowork|insurance|real estate/, public: [["d", "desk", "grid", { count: 12 }], ["ch", "office chair", "front", { of: "d" }]], private: [["d", "desk", "wall", { wall: "far" }], ["ch", "office chair", "front", { of: "d" }], ["bs", "bookshelf", "wall", { pri: 2 }]] },
];

type Planned = PlanItem & { once?: boolean };
function template(use: string, label: string, done: Set<string>): Planned[] {
  if (EMPTY.has(label)) return [];
  const u = USES.find((x) => x.re.test(use.toLowerCase()));
  const rows = (u && (label === "kitchen" ? u.kitchen : PUBLIC.has(label) ? u.public : u.private)) ?? HOME[label] ?? HOME.other;
  return rows.filter(([, name, , o]) => !(o?.once && done.has(name))).map(([key, name, place, o = {}]) => ({
    key, name, terms: [name, ...(o.terms ?? [])], size: typicalSize(name).size, count: o.count ?? 1, place, priority: o.pri ?? 1,
    ...(o.of && { of: o.of }), ...(o.once && { once: true }), ...(o.wall && { wall: o.wall === "near" ? "near-door" as const : "far-from-door" as const }),
  }));
}

async function geminiPlans(g: GeminiClient, input: PlanIn, rooms: PlanRoom[], placedIn: (id: string) => string[]) {
  const use = input.use.slice(0, 80) || "home", asked = input.text.slice(0, 500), lines = rooms.map((r) => describeRoom(r, placedIn(r.id)));
  // Same use, request and rooms (ids, sizes, doors, contents, what's placed) -> same plan.
  const key = `furnish-plan:${createHash("sha256").update([normName(use), normName(asked), ...lines].join("\n")).digest("hex")}`;
  const hit = await getCached<Record<string, PlanItem[]>>(key);
  if (hit) return new Map(Object.entries(hit));
  const text = [`Intended use: ${use}`, `User asked: ${asked}`, "Rooms:", ...lines].join("\n");
  const out = Loose.safeParse(await geminiJson(g, PROMPT, [{ text }], SCHEMA));
  if (!out.success) return null;
  const plans = new Map<string, PlanItem[]>();
  for (const r of out.data.rooms) {
    if (!rooms.some((x) => x.id === r.roomId) || plans.has(r.roomId)) continue; // only listed rooms, once
    const seen = new Set<string>();
    plans.set(r.roomId, r.items.slice(0, 12).flatMap((i) => toItem(i, seen) ?? []));
  }
  // An unwritable cache costs a repeat call next time, not this plan.
  if ([...plans.values()].some((p) => p.length)) await putCached(key, Object.fromEntries(plans), 30).catch(() => null);
  return plans;
}

const listNames = (xs: { name: string; count: number }[]) => xs.map((x) => (x.count > 1 ? `${x.count} × ${x.name}` : x.name)).join(", ");

export async function planFurnish(input: PlanIn, gemini?: GeminiClient | null): Promise<PlanOut> {
  const rooms = input.rooms.filter((r) => r.polygon.length >= 3);
  if (!rooms.length) return { ops: [], dropped: [], reply: "I need a room with a floor plan to lay out. Walk into a room that's on the plan and try again.", source: "offline" };
  const existing: (Obstacle & { name: string })[] = input.placed.map((p) => ({ name: p.name, pos: { x: p.pos.x, y: -p.pos.z }, size: p.size, rotY: p.rotY }));
  const inRoom = (id: string) => { const r = rooms.find((x) => x.id === id)!; return existing.filter((p) => pointInPolygon(p.pos, r.polygon)).map((p) => p.name); };

  const g = gemini !== undefined ? gemini : await geminiClient().catch(() => null);
  let got: Awaited<ReturnType<typeof geminiPlans>> = null, why = ""; // a note only when Gemini was there and failed
  if (g) {
    try { got = await geminiPlans(g, input, rooms, inRoom); if (!got) why = "bad output"; } catch (e) {
      why = "error";
      console.warn(`[hermit] furnish plan fell back (${e instanceof Error ? e.message : e})`);
    }
  }
  const source = got ? "gemini" as const : "offline" as const;
  const once = new Set<string>(); // offline "once" items already placed in an earlier room
  const planFor = (r: PlanRoom): Planned[] => got ? got.get(r.id) ?? [] : template(input.use, r.label, once).filter((t) => !inRoom(r.id).includes(t.name));

  // Fair share of the item budget per room; then what rooms left unused goes back to rooms that hit their share, the
  // current room (first) first. A bigger budget only appends to a room's greedy layout, so re-running it is safe.
  // Rooms are laid out in order so a "once" item that didn't fit one room goes to the next room that wants it.
  const share = Math.floor(MAX_ITEMS / rooms.length), plans: Planned[][] = [], lays: Layout[] = [];
  rooms.forEach((r, i) => {
    plans[i] = planFor(r);
    lays[i] = layoutRoom(plans[i], r, existing, share + (i < MAX_ITEMS % rooms.length ? 1 : 0));
    for (const l of lays[i].placed) if (plans[i].find((t) => t.key === l.key)?.once) once.add(l.name);
  });
  for (let i = 0; i < rooms.length; i++) {
    const spare = MAX_ITEMS - lays.reduce((n, l) => n + l.placed.length, 0);
    // Leave out "once" items this room didn't place that a later room has since taken.
    const plan = plans[i].filter((t) => !t.once || !once.has(t.name) || lays[i].placed.some((l) => l.key === t.key));
    if (lays[i].capped && spare > 0) lays[i] = layoutRoom(plan, rooms[i], existing, lays[i].placed.length + spare);
  }
  const ops: object[] = [], dropped: PlanOut["dropped"] = [];
  for (const l of lays) {
    for (const p of l.placed) ops.push({ op: "add", name: p.name, terms: p.terms, size: p.size, pos: { x: p.pos.x, z: -p.pos.y }, rotY: p.rotY });
    for (const x of l.dropped.filter((d) => !once.has(d.name))) { const hit = dropped.find((y) => y.name === x.name); if (hit) hit.count += x.count; else dropped.push({ ...x }); }
  }
  const capped = lays.some((l) => l.capped);
  // The reply says only what was actually placed (the model's own summary could name things that didn't fit).
  const counts = new Map<string, number>();
  for (const l of lays) for (const p of l.placed) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  const kinds = [...counts].map(([name, count]) => ({ name, count })), used = lays.filter((l) => l.placed.length).length;
  const where = used > 1 ? `${used} rooms` : `the ${rooms[lays.findIndex((l) => l.placed.length)]?.label ?? "room"}`;
  const lead = `Placed ${listNames(kinds.slice(0, 6))}${kinds.length > 6 ? ` and ${kinds.length - 6} more kinds` : ""} in ${where}.`;
  const reply = !ops.length ? `I couldn't fit anything${dropped.length ? ` (no room for ${listNames(dropped)})` : ""}.`
    : `${lead}${dropped.length ? ` No room for: ${listNames(dropped)}.` : ""}${capped ? ` I stopped at ${ops.length} pieces to keep the tour quick; ask again in a room to add more there.` : ""}`;
  const note = why ? " (simple mode: the AI assistant isn't available right now)" : "";
  return { ops, reply: reply + note, dropped, source };
}
