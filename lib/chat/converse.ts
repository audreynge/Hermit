import { useCategory } from "../reason/rules";
import { CHAIR_TYPE_IN, parseChairWidth, parseText, USE_NOUN } from "../spec/parse";
import { SIZE_OPTIONS, surveyToSpec, USE_OPTIONS, type Draft } from "../spec/survey";
import type { RoomReq } from "../types";
import { an } from "../text";
import { isLayoutEdit } from "./commands";

export type Slot = "use" | "city" | "size" | "rooms" | "musts" | "chair";
const SLOTS = new Set<string>(["use", "city", "size", "rooms", "musts", "chair"]);
// The interview tracks more fields than the chat; keep only the chat's slots (the API caps asked at 10).
export const chatAsked = (asked: string[]): Slot[] =>
  [...new Set(asked.map((a) => (a.startsWith("rooms") || a === "baths" || a === "beds" ? "rooms" : a)).filter((a) => SLOTS.has(a)))].slice(0, 10) as Slot[];
export type Card = { kind: "multi"; options: { value: string; label: string }[] };
export type ChatState = { spec: Draft; asked: Slot[]; phase: "gathering" | "results" };
export type Turn = { reply: string; state: ChatState; ready: boolean; quickReplies: string[]; card?: Card; action?: "compare" | "email" | "regulations" | "save" | "view" | "report" | "broker" | "reset" | "search" | "edit_layout"; target?: number; fallback?: "deterministic"; fallbackWhy?: string; edit?: { target: "layout" | "fitout"; ops: unknown[] } };

const MAX_QUESTIONS = 5;
const SKIP = /\b(just search|search now|go ahead|that'?s (it|all)|skip|no preference|doesn'?t matter|whatever|none of these|find (it|them|spaces|shells))\b/i;
const CITY = (c?: string) => (c === "houston" ? "Houston" : c === "los_angeles" ? "Los Angeles" : "");

type UseQ = { q: string; primary?: { word: RegExp; room: (n: number, t: string) => RoomReq[] } };
const QUESTIONS: Record<string, UseQ> = {
  medical: {
    q: "How many exam rooms do you need, and should they have sinks?",
    primary: { word: /exam/, room: (n, t) => [{ label: "exam room", count: n, hard: false, ...(/sink/.test(t) ? { fixtures: ["sink"] } : {}) }] },
  },
  salon: {
    q: "How many styling stations, and do you need shampoo sinks?",
    primary: { word: /station|chair/, room: (n, t) => [{ label: "styling floor", count: 1, minSqft: n * 50, hard: false, ...(/sink/.test(t) ? { fixtures: ["sink"] } : {}) }] },
  },
  office: {
    q: "How many people will work there? Any private offices or a conference room?",
  },
  restaurant: {
    q: "About how many seats, and do you need a full commercial kitchen with a hood?",
    primary: { word: /seat/, room: (n, t) => [{ label: "dining", count: 1, minSqft: n * 15, hard: false }, { label: "kitchen", count: 1, hard: !/small|counter/.test(t), ...(/full|hood/.test(t) ? { fixtures: ["hood"] } : {}) }] },
  },
  retail: {
    q: "Anything special for the shop, like a stockroom, a fitting room or street frontage?",
  },
  fitness: {
    q: "How many studio rooms, and do you need showers or locker rooms?",
    primary: { word: /studio/, room: (n) => [{ label: "open", count: n, hard: false }] },
  },
  warehouse: {
    q: "Do you need heavy power, drive-in or dock doors, or ESFR sprinklers?",
  },
  home: {
    q: "How many bedrooms and bathrooms?",
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

export function question(slot: Slot, spec: Draft): { q: string } {
  if (slot === "musts") return { q: "Is there anything you can't do without, like parking, a ground-floor spot or wheelchair access?" };
  if (slot === "use") return { q: "What kind of space are you looking for, and what will you use it for?" };
  if (slot === "city") return { q: "Which city should I search: Houston or Los Angeles?" };
  if (slot === "chair") return { q: `How wide is the wheelchair at its widest point? I'll check every door against it. A manual chair is about ${CHAIR_TYPE_IN.manual} inches and a power chair about ${CHAIR_TYPE_IN.power}.` };
  if (slot === "size") return { q: "Roughly how much space do you need? A range is fine." };
  return { q: (QUESTIONS[useKey(spec)] ?? QUESTIONS.office).q };
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
  return { reply: `${lead}${question(slot, state.spec).q}`, state: { ...state, asked: [...state.asked, slot] }, ready: false, quickReplies: [] };
}

export function openChat(spec: Draft): Turn {
  const state: ChatState = { spec, asked: [], phase: "gathering" };
  const known = spec.useType ? `Hi! I'm Hermit. You're looking for ${describe(spec)}. ` : "Hi! I'm Hermit. I'll find spaces that are already built for what you need. ";
  return ask(state, known);
}

type Action = NonNullable<Turn["action"]>;
const ORDINAL: Record<string, number> = { first: 1, "1st": 1, one: 1, second: 2, "2nd": 2, two: 2, third: 3, "3rd": 3, three: 3, fourth: 4, "4th": 4, four: 4, fifth: 5, "5th": 5, five: 5 };
const ORD_WORD = ["", "first", "second", "third", "fourth", "fifth"];
export const MAX_MATCHES = 5;

/** Match rank as written ("#2", "number 2", "the second one", "the top one"); may be out of range. Undefined means the selected match. */
export function parseTarget(text: string): number | undefined {
  const t = text.toLowerCase();
  const n = t.match(/#\s?(\d+)\b|\b(?:number|no\.?|match|option|space|property|place|listing|result)\s+(\d+|one|two|three|four|five)\b/);
  if (n) return ORDINAL[n[2]] ?? Number(n[1] ?? n[2]);
  if (/\btop (one|match|pick|space|result)\b/.test(t)) return 1;
  const w = t.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b/);
  return w ? ORDINAL[w[1]] : undefined;
}

// Save/view need to name a match, so "save this layout" or "open it up to more cities" don't trigger them.
const MATCH_WORD = /\b(match|space|place|property|listing|option|unit|suite|building|(this|that|the \w+) one)\b/;
const TARGETED = new Set<Action>(["save", "view", "report", "broker"]);
const ABOUT_LAYOUT = /\b(layout|floor ?plan)\b/;
const ACTIONS: { action: Action; re: RegExp; results: boolean; when?: (t: string, target?: number) => boolean; reply: (which: string) => string }[] = [
  { action: "edit_layout", re: /^(?:can i |let me |i want to |i'd like to |please )?(?:edit|change|open|tweak|adjust|fix|work on|draw)\s+(?:the |my )?(?:layout|floor ?plan)$/, results: false, reply: () => "Here's your layout. Drag the rooms yourself, or tell me a change like \"add a bathroom\". What would you like to change first?" },
  { action: "reset", re: /\b(start (over|again|fresh)|reset|from scratch|new search|clear (it|everything|all))\b/, results: false, reply: () => "Okay, starting fresh. What kind of space are you looking for?" },
  { action: "search", re: /\b(search now|just search|search again|run (the |a )?search|find (me )?(matches|spaces|places)|see (my |the )?matches)\b/, results: false, reply: () => "Searching again with what you've told me." },
  { action: "broker", re: /\bsend (it|the packet|my packet|the inquiry|an inquiry)\b|\bpacket\b|\b(contact|call|talk to|speak (to|with)|get in touch with|reach)\b.*\b(broker|agent)\b|^broker\b/, results: true, reply: (w) => `Let's get ${w} in front of the broker. I'll put the packet together; nothing is sent until you send it.` },
  { action: "email", re: /\bdraft\b|\bwrite (an? )?(e-?mail|message|note)\b|\be-?mail\b|\breach out\b|\bwrite to\b|\bmessage (them|the)\b|\bcontact (them|the (property manager|landlord|owner|leasing office))\b/, results: true, reply: () => "Here's a draft to the property manager. Edit it however you like; I won't send anything for you." },
  { action: "report", re: /\b(full|whole|complete|detailed) report\b|\breport (on|for)\b|\bmore (details|info) (on|about)\b/, results: true, reply: (w) => `Here's the full report on ${w}.` },
  { action: "view", re: /\b(let me see|see inside|look inside|walk ?(through|inside)|tour|show me|view|open)\b/, results: true, when: (t, n) => n != null || /\binside\b/.test(t) || MATCH_WORD.test(t), reply: (w) => `Opening ${w} so you can look around.` },
  { action: "save", re: /\b(save|bookmark|shortlist|favou?rite|star|heart)\b/, results: true, when: (t, n) => n != null || MATCH_WORD.test(t) || /\bsave it\b/.test(t), reply: (w) => `Saved ${w}. Want me to draft a note to the broker about it?` },
  { action: "compare", re: /compar/, results: true, reply: () => "Here's how the top matches compare side by side." },
];

/** App actions the user can ask for in words ("save the second one", "start over"). Null when the text isn't one. */
export function actionTurn(state: ChatState, text: string): Turn | null {
  const t = text.toLowerCase().trim().replace(/[.!?]+$/, "");
  const target = parseTarget(t);
  const hit = ACTIONS.find((a) => a.re.test(t) && (!a.when || a.when(t, target)));
  if (!hit) return null;
  // Text about the layout is a layout edit ("reset the layout", "save this layout"), unless it only asks to open the editor.
  if (hit.action !== "edit_layout" && (ABOUT_LAYOUT.test(t) || isLayoutEdit(t))) return null;
  if (hit.results && state.phase !== "results")
    return { reply: "I don't have any matches yet. Should I search with what you've told me so far?", state, ready: false, quickReplies: [] };
  if (hit.action === "reset") {
    const fresh: ChatState = { spec: surveyToSpec({ transaction: "lease", accessibility: false, requirements: [] }), asked: [], phase: "gathering" };
    // "Start over with a bakery": reset, then read the rest as the first answer.
    const m = t.match(hit.re)!;
    const rest = t.slice(m.index! + m[0].length).replace(/^\W*(with|for|as|and|,)?\s*/, "");
    if (/[a-z]{3}/.test(rest)) {
      const next = converse(fresh, rest);
      return { ...next, reply: `Okay, starting fresh. ${next.reply}`, action: "reset" };
    }
    return { reply: hit.reply(""), state: { ...fresh, asked: ["use"] }, ready: false, quickReplies: [], action: "reset" };
  }
  if (hit.action === "search" && state.phase !== "results") {
    const a = ask({ ...state, asked: [...new Set<Slot>([...state.asked, "size", "rooms", "musts", "chair"])] }, "", true);
    return { ...a, action: "search" };
  }
  const useTarget = TARGETED.has(hit.action) && target != null;
  if (useTarget && (target < 1 || target > MAX_MATCHES))
    return { reply: `I show up to ${MAX_MATCHES} matches, numbered 1 to ${MAX_MATCHES}. Which one did you mean?`, state, ready: false, quickReplies: [] };
  const which = useTarget ? `the ${ORD_WORD[target]} match` : "this space";
  return { reply: hit.reply(which), state, ready: false, quickReplies: [], action: hit.action, ...(useTarget ? { target } : {}) };
}

export function converse(state: ChatState, text: string): Turn {
  const act = actionTurn(state, text);
  if (act) return act;
  const awaiting = state.asked.at(-1) ?? null;
  const { spec, changed } = mergeText(state.spec, text, awaiting);

  if (state.spec.city && state.spec.useType && /\b(permits?|licen[cs]es?|regulations?|rules|legal(ly)?|allowed to|zoning laws?)\b/i.test(text))
    return { reply: `Here are the rules I found for a ${state.spec.useType} in ${CITY(state.spec.city)}. Each links to the official source; treat them as a checklist to confirm, not legal advice.`, state, ready: false, quickReplies: [], action: "regulations" };

  if (state.phase === "results") {
    if (changed) return { reply: `Updating your search: ${describe(spec)}. Anything else you'd change?`, state: { ...state, spec }, ready: true, quickReplies: [] };
    return {
      reply: "I can save a match, open one so you can look inside, compare them, change the size, area or budget, or get the broker packet ready. What would help most?",
      state, ready: false, quickReplies: [],
    };
  }

  // "Just search" means search now: defaults fill anything still missing (ask() picks Houston/office and says so).
  if (SKIP.test(text)) return ask({ ...state, spec, asked: [...new Set<Slot>([...state.asked, "size", "rooms", "musts", "chair"])] }, "", true);
  // One message that answers everything at once searches right away (wireframe 2); must-haves are asked only in Q&A mode.
  const oneShot = missing(state.spec, state.asked) === "use" && missing(spec, state.asked) === "musts";
  return ask({ ...state, spec, asked: oneShot ? [...state.asked, "musts"] : state.asked }, changed ? "Got it. " : "No problem. ");
}
