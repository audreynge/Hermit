import { useCategory } from "../reason/rules";
import { CHAIR_TYPE_IN, parseChairWidth, parseText, USE_NOUN } from "../spec/parse";
import { REQUIREMENTS, SIZE_OPTIONS, USE_OPTIONS, type Draft } from "../spec/survey";
import type { RoomReq } from "../types";
import { an } from "../text";

export type Slot = "use" | "city" | "size" | "rooms" | "musts" | "chair";
export type Card = { kind: "multi"; options: { value: string; label: string }[] };
export type ChatState = { spec: Draft; asked: Slot[]; phase: "gathering" | "results" };
export type Turn = { reply: string; state: ChatState; ready: boolean; quickReplies: string[]; card?: Card; action?: "compare" | "email" | "regulations" | "save" | "view" | "report" | "broker" | "reset" | "search" | "edit_layout"; target?: number; fallback?: "deterministic"; fallbackWhy?: string; edit?: { target: "layout" | "fitout"; ops: unknown[] } };

const MAX_QUESTIONS = 5;
const SKIP = /\b(just search|search now|go ahead|that'?s (it|all)|skip|no preference|doesn'?t matter|whatever|none of these|find (it|them|spaces|shells))\b/i;
const CITY = (c?: string) => (c === "houston" ? "Houston" : c === "los_angeles" ? "Los Angeles" : "");

type UseQ = { q: string; quick: string[]; primary?: { word: RegExp; room: (n: number, t: string) => RoomReq[] } };
const QUESTIONS: Record<string, UseQ> = {
  medical: {
    q: "How many exam rooms do you need, and should they have sinks?",
    quick: ["2 exam rooms", "3 exam rooms with sinks", "4 exam rooms + a procedure room"],
    primary: { word: /exam/, room: (n, t) => [{ label: "exam room", count: n, hard: false, ...(/sink/.test(t) ? { fixtures: ["sink"] } : {}) }] },
  },
  salon: {
    q: "How many styling stations, and do you need shampoo sinks?",
    quick: ["4 stations", "6 stations with shampoo sinks", "8 stations + a private room"],
    primary: { word: /station|chair/, room: (n, t) => [{ label: "styling floor", count: 1, minSqft: n * 50, hard: false, ...(/sink/.test(t) ? { fixtures: ["sink"] } : {}) }] },
  },
  office: {
    q: "How many people will work there? Any private offices or a conference room?",
    quick: ["5 people, open plan", "10 people + 2 offices", "15 people + a conference room"],
  },
  restaurant: {
    q: "About how many seats, and do you need a full commercial kitchen with a hood?",
    quick: ["30 seats, full kitchen", "50 seats, full kitchen", "Counter service, small kitchen"],
    primary: { word: /seat/, room: (n, t) => [{ label: "dining", count: 1, minSqft: n * 15, hard: false }, { label: "kitchen", count: 1, hard: !/small|counter/.test(t), ...(/full|hood/.test(t) ? { fixtures: ["hood"] } : {}) }] },
  },
  retail: {
    q: "Anything special for the shop, like a stockroom, a fitting room or street frontage?",
    quick: ["Stockroom + fitting room", "Street-level storefront", "Just an open floor"],
  },
  fitness: {
    q: "How many studio rooms, and do you need showers or locker rooms?",
    quick: ["1 big studio", "2 studios + showers", "1 studio + locker rooms"],
    primary: { word: /studio/, room: (n) => [{ label: "open", count: n, hard: false }] },
  },
  warehouse: {
    q: "Do you need heavy power, drive-in or dock doors, or ESFR sprinklers?",
    quick: ["Heavy power + 2 drive-in doors", "ESFR sprinklers + dock doors", "Just storage space"],
  },
  home: {
    q: "How many bedrooms and bathrooms?",
    quick: ["2 bed / 1 bath", "3 bed / 2 bath", "4 bed / 2 bath + office"],
  },
};
const BARE_ROOMS: [RegExp, string][] = [
  [/\b(reception|waiting (room|area)|lobby)\b/, "reception"], [/\bstorage\b/, "storage"], [/\b(stock ?room)\b/, "storage"],
  [/\b(kitchen|kitchenette|break ?room)\b/, "kitchen"], [/\b(conference|meeting) room\b/, "conference"],
  [/\bprocedure room\b/, "procedure room"], [/\bfitting rooms?\b/, "fitting room"], [/\b(locker rooms?|showers?)\b/, "bathroom"],
  [/\bprivate room\b/, "office"],
];

const useKey = (spec: Draft) => (spec.mode === "home" ? "home" : spec.mode === "enterprise" ? "warehouse" : useCategory(spec.useType || "office"));

export function missing(spec: Draft, asked: Slot[]): Slot | null {
  if (!spec.useType) return "use";
  if (!spec.city) return "city";
  if (!spec.sizeSqft && !spec.headcount && !asked.includes("size") && spec.mode !== "home") return "size";
  const hasRooms = spec.rooms.length > 0 || spec.beds != null || spec.headcount || (spec.mode === "enterprise" && Object.values(spec.needs).some(Boolean));
  if (!hasRooms && !asked.includes("rooms")) return "rooms";
  if (!asked.includes("musts") && !Object.values(spec.needs).some(Boolean)) return "musts";
  if (spec.needs.wheelchair && spec.needs.chairWidthIn == null && !asked.includes("chair")) return "chair";
  return null;
}

export const MUSTS: Card = { kind: "multi", options: REQUIREMENTS.map((r) => ({ value: r.value, label: r.label })) };

export function question(slot: Slot, spec: Draft): { q: string; quick: string[]; card?: Card } {
  if (slot === "musts") return { q: "Anything you can't do without? Tap all that apply, or skip.", quick: ["None of these"], card: MUSTS };
  if (slot === "use") return { q: "What kind of space are you looking for, and what will you use it for?", quick: USE_OPTIONS.map((u) => u.label) };
  if (slot === "city") return { q: "Which city should I search: Houston or Los Angeles?", quick: ["Houston", "Los Angeles"] };
  if (slot === "chair") return {
    q: "How wide is the wheelchair at its widest point? I'll check every door against it. A measured number is best; a type works too.",
    quick: [`Manual (~${CHAIR_TYPE_IN.manual} in)`, `Power (~${CHAIR_TYPE_IN.power} in)`, "I'll measure later"],
  };
  if (slot === "size") return { q: "Roughly how much space do you need? A range is fine.", quick: SIZE_OPTIONS.slice(0, 4).map((s) => s.label) };
  const u = QUESTIONS[useKey(spec)] ?? QUESTIONS.office;
  return { q: u.q, quick: u.quick };
}

export function describe(spec: Draft): string {
  const parts = [an(spec.useType || "space")];
  if (spec.city) parts[0] += ` in ${CITY(spec.city)}`;
  if (spec.sizeSqft) parts.push(`${spec.sizeSqft[0].toLocaleString()}–${spec.sizeSqft[1].toLocaleString()} sq ft`);
  if (spec.beds != null) parts.push(`${spec.beds} bed${spec.baths != null ? ` / ${spec.baths} bath` : ""}`);
  const rooms = spec.rooms.map((r) => (r.count > 1 ? `${r.count} ${r.label}s` : r.label));
  if (rooms.length) parts.push(`with ${rooms.length > 1 ? `${rooms.slice(0, -1).join(", ")} and ${rooms.at(-1)}` : rooms[0]}`);
  if (spec.budgetMonthly) parts.push(`under $${spec.budgetMonthly.toLocaleString()}/month`);
  if (spec.budgetTotal) parts.push(`under $${spec.budgetTotal.toLocaleString()}`);
  if (spec.needs.wheelchair) parts.push(spec.needs.chairWidthIn ? `wheelchair accessible for a ${spec.needs.chairWidthIn} in chair` : "wheelchair accessible");
  return parts.join(", ");
}

// Merges only what the message actually says into the draft; returns whether anything changed.
export function mergeText(spec: Draft, text: string, awaiting: Slot | null = null): { spec: Draft; changed: boolean } {
  const t = text.toLowerCase();
  const next: Draft = { ...spec, needs: { ...spec.needs }, rooms: [...spec.rooms] };
  let changed = false;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { if (v !== undefined && JSON.stringify(next[k]) !== JSON.stringify(v)) { next[k] = v; changed = true; } };

  const option = USE_OPTIONS.find((u) => t.includes(u.label.toLowerCase()));
  const size = SIZE_OPTIONS.find((s) => t.includes(s.label.toLowerCase()));
  const p = parseText(text, { city: spec.city, mode: spec.mode });
  const blank = parseText("", { mode: spec.mode });

  if (/houston/.test(t)) set("city", "houston");
  else if (/los angeles|\bl\.?a\.?\b/.test(t)) set("city", "los_angeles");
  if (option) { set("useType", option.useType); set("mode", option.mode); }
  else if (USE_NOUN.test(t) || p.useType !== blank.useType || (p.mode !== spec.mode && p.mode !== "business")) {
    set("useType", p.useType);
    set("mode", p.mode);
  }
  if (size) set("sizeSqft", size.range);
  else if (p.sizeSqft) set("sizeSqft", p.sizeSqft);
  else if (spec.sizeSqft && /\b(bigger|larger|more space|more room)\b/.test(t)) set("sizeSqft", spec.sizeSqft.map((v) => Math.round(v * 1.5)) as [number, number]);
  else if (spec.sizeSqft && /\b(smaller|less space|tinier)\b/.test(t)) set("sizeSqft", spec.sizeSqft.map((v) => Math.round(v * 0.67)) as [number, number]);
  if (/\b(cheaper|lower (the )?budget|less expensive|more affordable)\b/.test(t)) {
    if (spec.budgetMonthly) set("budgetMonthly", Math.round(spec.budgetMonthly * 0.8));
    if (spec.budgetTotal) set("budgetTotal", Math.round(spec.budgetTotal * 0.8));
  }
  for (const k of ["headcount", "beds", "baths", "budgetMonthly", "budgetTotal"] as const) if (p[k] != null) set(k, p[k]);
  for (const [k, v] of Object.entries(p.needs)) if (v) set("needs", { ...next.needs, [k]: v });
  const musts: [RegExp, keyof Draft["needs"]][] = [[/\bada\b|wheelchair|accessib/, "wheelchair"], [/on-?site parking|\bparking\b/, "parking"], [/ground floor|street level/, "groundFloor"], [/transit/, "transit"]];
  for (const [re, k] of musts) if (re.test(t) && !next.needs[k]) set("needs", { ...next.needs, [k]: true });
  const prefs = [...new Set([...(next.preferences ?? []), ...(/flexible layout/.test(t) ? ["flexible"] : []), ...(/patient-?friendly/.test(t) ? ["patient"] : [])])];
  if (prefs.length !== (next.preferences ?? []).length) set("preferences", prefs);
  if (/\b(buy|buying|purchase|purchasing|own)\b/.test(t)) set("transaction", "buy");
  else if (/\b(lease|leasing|rent|renting)\b/.test(t)) set("transaction", "lease");
  const chair = awaiting === "chair" ? parseChairWidth(text, true) : undefined;
  if (chair) set("needs", { ...next.needs, wheelchair: true, chairWidthIn: chair });

  const rooms = [...p.rooms];
  for (const [re, label] of BARE_ROOMS) if (re.test(t) && !rooms.some((r) => r.label === label)) rooms.push({ label, count: 1, hard: false });
  const prim = QUESTIONS[useKey(next)]?.primary;
  const n = t.match(prim ? new RegExp(`(\\d+)\\s*(?:\\w+\\s)?(?:${prim.word.source})`) : /^$/)?.[1] ?? (awaiting === "rooms" ? t.match(/^\s*(\d+)\b/)?.[1] : undefined);
  if (prim && n) for (const r of prim.room(Number(n), t)) if (!rooms.some((x) => x.label === r.label && x.count === r.count)) {
    const i = rooms.findIndex((x) => x.label === r.label);
    if (i >= 0) rooms[i] = { ...rooms[i], ...r };
    else rooms.push(r);
  }
  for (const r of rooms) {
    const i = next.rooms.findIndex((x) => x.label === r.label);
    if (i >= 0) { if (JSON.stringify(next.rooms[i]) !== JSON.stringify(r)) { next.rooms[i] = r; changed = true; } }
    else { next.rooms.push(r); changed = true; }
  }
  if (changed) next.input = "chat";
  return { spec: next, changed };
}

export function ask(state: ChatState, lead: string, force = false): Turn {
  const slot = missing(state.spec, state.asked);
  // The chair width is a one-time follow-up to a must-have the user just picked, so it may go past the cap.
  const budgetLeft = force || (state.asked.length >= MAX_QUESTIONS && slot !== "chair");
  if (!slot || budgetLeft) {
    const spec = { ...state.spec, city: state.spec.city ?? "houston", useType: state.spec.useType || "office" };
    const assumed = !state.spec.city ? " I'll start with Houston; say the word if you'd rather search Los Angeles." : "";
    return {
      reply: `Perfect, I have what I need for ${describe(spec)}. Let me look through the scanned spaces.${assumed}`,
      state: { spec, asked: state.asked, phase: "gathering" }, ready: true, quickReplies: [],
    };
  }
  const { q, quick, card } = question(slot, state.spec);
  return { reply: `${lead}${q}`, state: { ...state, asked: [...state.asked, slot] }, ready: false, quickReplies: quick, ...(card ? { card } : {}) };
}

export function openChat(spec: Draft): Turn {
  const state: ChatState = { spec, asked: [], phase: "gathering" };
  const known = spec.useType ? `Hi! I'm Hermit. You're looking for ${describe(spec)}. ` : "Hi! I'm Hermit. I'll find spaces that are already built for what you need. ";
  return ask(state, known);
}

export function converse(state: ChatState, text: string): Turn {
  const awaiting = state.asked.at(-1) ?? null;
  const { spec, changed } = mergeText(state.spec, text, awaiting);

  if (state.spec.city && state.spec.useType && /\b(permits?|licen[cs]es?|regulations?|rules|legal(ly)?|allowed to|zoning laws?)\b/i.test(text))
    return { reply: `Here are the rules I found for a ${state.spec.useType} in ${CITY(state.spec.city)}. Each links to the official source; treat them as a checklist to confirm, not legal advice.`, state, ready: false, quickReplies: [], action: "regulations" };

  if (state.phase === "results") {
    if (/compar/i.test(text)) return { reply: "Here's how the top matches compare side by side.", state, ready: false, quickReplies: [], action: "compare" };
    if (/e-?mail|draft|reach out|contact|message the|write to/i.test(text))
      return { reply: "Here's a draft to the property manager. Edit it however you like; I won't send anything for you.", state, ready: false, quickReplies: [], action: "email" };
    if (changed) return { reply: `Updating your search: ${describe(spec)}.`, state: { ...state, spec }, ready: true, quickReplies: [] };
    return {
      reply: "I can compare the layouts, adjust the size, location or budget, or draft an email to the property manager. What would help?",
      state, ready: false, quickReplies: ["Compare the layouts", "Draft an email", "Make it bigger"],
    };
  }

  // "Just search" means search now: defaults fill anything still missing (ask() picks Houston/office and says so).
  if (SKIP.test(text)) return ask({ ...state, spec, asked: [...new Set<Slot>([...state.asked, "size", "rooms", "musts", "chair"])] }, "", true);
  // One message that answers everything at once searches right away (wireframe 2); must-haves are asked only in Q&A mode.
  const oneShot = missing(state.spec, state.asked) === "use" && missing(spec, state.asked) === "musts";
  return ask({ ...state, spec, asked: oneShot ? [...state.asked, "musts"] : state.asked }, changed ? "Got it. " : "No problem. ");
}
