import { z } from "zod";
import { describe, mergeText } from "../chat/converse";
import { generateJSON, hasGemini, type Content } from "../llm/gemini";
import { cleanWording } from "../llm/wording";
import { funnel } from "../query/shells";
import { TIMING_OPTIONS, type Draft } from "../spec/survey";
import { chipsIn, toggleChip } from "../uses/chips";
import { packFor, seedRooms } from "../uses/packs";
import type { FunnelStage, RequirementSpec, Shell } from "../types";
import { basicsDone, CITY_AGAIN, deeperQuestion, interviewQuestion, plural, progress, roomList, type Field } from "./next";

export type Msg = { role: "hermit" | "user"; text: string };
export type IState = { spec: Draft; asked: string[]; history: Msg[]; field?: Field | null; quick?: string[]; ready?: boolean };
export type ITurn = { reply: string; why?: string; quick: string[]; multi?: boolean; state: IState; ready: boolean; basicsDone: boolean; stages: FunnelStage[]; llm: boolean; progress?: number };

const SKIP = /\b(just search|search now|go ahead|that'?s (it|all)|skip|find (it|them|spaces)|show me|let'?s see|walk inside|see (my |the |your )?matches)\b/i;
const SEARCH_ONLY = /\b(just search|search now|find (it|them|spaces)|show me|let'?s see|walk inside|see (my |the |your )?matches)\b/i;
const SKIP_ROOMS = /typical|usual|standard|default|works|sounds good|not sure|don'?t know|skip|you pick|whatever|^\s*(yes|yeah|yep|ok|okay|sure|fine)\b/i;
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const NO = /^\s*(no|nope|none|not really|no special|street parking|standard power|not sure)/i;

export const asSpec = (d: Draft): RequirementSpec => ({ ...d, city: d.city ?? "houston", useType: d.useType || "office" });

// Answers to the question Hermit just asked, read deterministically so the interview works with no LLM.
function answerField(spec: Draft, field: Field | null | undefined, text: string): Draft {
  const t = text.toLowerCase();
  let next: Draft = { ...spec, needs: { ...spec.needs } };
  const n = Number(t.replace(/,/g, "").match(/(\d+)/)?.[1]);
  switch (field) {
    case "accessibility":
      if (/wheelchair|yes/.test(t)) Object.assign(next.needs, { wheelchair: true, stepFree: true });
      else if (/step/.test(t)) next.needs.stepFree = true;
      else if (NO.test(t)) Object.assign(next.needs, { wheelchair: false, stepFree: false });
      break;
    case "parking":
      if (n) Object.assign(next.needs, { parkingStalls: n, parking: true });
      else if (NO.test(t)) next.needs.parking = false;
      break;
    case "moveIn": {
      const opt = TIMING_OPTIONS.find((o) => t.includes(o.label.toLowerCase()));
      next.moveInBy = opt?.value ?? (/3\s*[–-]\s*6/.test(t) ? "3-6m" : /6\+|six|later/.test(t) ? "6m+" : /asap|soon|now/.test(t) ? "asap" : text.slice(0, 40));
      break;
    }
    case "size":
      if (!/sf|sq|square|feet|people|staff|person|bed|\d,\d{3}/.test(t) && n >= 300) next.sizeSqft = [Math.round(n * 0.8), Math.round(n * 1.25)];
      break;
    case "baths": {
      const w = WORDS[t.match(/\b(one|two|three|four|five|six)\b/)?.[1] ?? ""];
      const c = n || w || (NO.test(t) ? 0 : 1);
      if (c > 0 && !next.rooms.some((r) => r.label === "bathroom")) next.rooms = [...next.rooms, { label: "bathroom", count: c, hard: false }];
      break;
    }
    case "power":
      if (/three|3-phase|yes|heavy/.test(t)) Object.assign(next.needs, { heavyPower: true, threePhase: /three|3/.test(t) });
      else next.needs.heavyPower = false;
      break;
    case "sprinklers":
      next.needs.esfr = /yes|high/.test(t);
      break;
    case "bays":
      next.needs.driveInBays = /none|no/.test(t) ? 0 : n || 1;
      break;
    case "price":
      if (n > 0) next.avgPrice = n;
      break;
    case "days":
      next.daysOpen = /every|7|seven|daily/.test(t) ? 7 : /weekday|5|five/.test(t) ? 5 : n >= 1 && n <= 7 ? n : undefined;
      break;
    case "musts":
      for (const c of chipsIn(text, packFor(next).chips)) next = toggleChip(c, next, true);
      break;
  }
  return next;
}

// Parsed counts win per room type; the pack fills the rest only once the user confirms or skips.
function answerRooms(spec: Draft, text: string, asked: string[], notes: string[]): Draft {
  if (spec.rooms.some((r) => r.label !== "bathroom")) { asked.push("roomsOk"); return spec; }
  if (SKIP_ROOMS.test(text) || asked.includes("roomsOffer")) {
    asked.push("roomsOk");
    const rooms = seedRooms({ ...spec, input: "text" });
    notes.push(`No problem. I'll plan on a typical ${packFor(spec).label.toLowerCase()}: ${roomList(rooms)}. You can change it on the right.`);
    return { ...spec, rooms };
  }
  asked.push(asked.includes("roomsRetry") ? "roomsOffer" : "roomsRetry");
  notes.push("");
  return spec;
}

const nn = z.number().nullable();
const Update = z.object({
  acknowledgement: z.string(),
  question: z.string(),
  update: z.object({
    useType: z.string().nullable(), sizeMinSqft: nn, sizeMaxSqft: nn, headcount: nn, beds: nn, baths: nn, budgetMonthly: nn, budgetTotal: nn, parkingStalls: nn,
    wheelchair: z.boolean().nullable(), stepFree: z.boolean().nullable(), heavyPower: z.boolean().nullable(), kitchen: z.boolean().nullable(), moveIn: z.string().nullable(),
    rooms: z.array(z.object({ label: z.string(), count: z.number(), minSqft: nn, fixtures: z.array(z.string()) })),
    removeRooms: z.array(z.string()),
  }),
});

const SYSTEM = `You are Hermit, a warm, expert space consultant: part broker, contractor, code screener and designer. You interview a client to find an existing space that's already built for them.
Return JSON. "update": only facts the user's LAST message states or clearly implies (null otherwise; never invent). Room labels: simple nouns like "exam room", "lab", "office", "reception", "bathroom", "storage", "kitchen", "dining", "styling floor", "conference", "bedroom". Fixtures: sink, toilet, shower, hood, shampoo sink. If they ask for a room to be smaller or bigger, return that room with a new minSqft. "removeRooms": labels they want gone.
"acknowledgement": one short, friendly statement, never a question, that answers or reflects what they said; if it matters, add the expert implication ("Exam rooms need sinks, so I'll look for plumbing"). No exclamation marks, no fluff.
"question": rephrase NEXT QUESTION naturally in one sentence, keeping its meaning, like a friendly interviewer. Ask it open-ended: never list example answers or options ("e.g.", "such as A, B or C"). If NEXT QUESTION is "none", write "" (empty).
The screen has only two things: this chat on the left and a sketch of their space on the right (rooms they can drag, resize or delete). YOU edit that sketch through "update": each entry in "rooms" sets that room's total count and size (absolute, not added), and the sketch redraws from it. CURRENT SKETCH lists what is drawn now.
When they ask you to change, fit or plan the layout (e.g. "map it out for 50 engineers"), return the whole set of rooms that layout needs, with counts and minSqft, plus headcount and sizeMinSqft/sizeMaxSqft. Office rule of thumb: open desks ~50 sq ft per person (one "open" room sized for all desks), a private office per ~10 people, a conference room per ~12, a bathroom per ~15, a kitchen, and 150–200 sq ft per person overall.
Only say you changed the sketch if "update" actually changes it. There are no property cards until the crew searches. If they ask where to click or what to do, say so plainly; once the essentials are done, a "See your matches" button sits at the bottom of the chat and the user can tap it any time.
Never claim compliance, availability or guarantees. Never use the words "compliant", "certified" or "guaranteed".`;

export async function interviewTurn(state: IState, text: string | null, shells: Shell[]): Promise<ITurn> {
  let spec = state.spec;
  // Once the sketch is on screen, its rooms are the requirement the user edits.
  if (!spec.rooms.length && spec.useType && basicsDone(spec, state.asked)) spec = { ...spec, rooms: seedRooms(spec) };
  const asked = [...state.asked];
  if (state.field && !asked.includes(state.field)) asked.push(state.field);
  const tapped = !!text && !!state.quick?.includes(text);
  const wantsSearch = !!text && (state.field === "rooms" || state.field === "baths" ? SEARCH_ONLY : SKIP).test(text);
  const notes: string[] = [];
  if (text) {
    spec = answerField(spec, state.field, text);
    const merged = mergeText(spec, text, state.field === "rooms" && /^\s*\d+\s*$/.test(text) ? "rooms" : null).spec;
    // Once the use is set, a stray noun ("a small lab") must not turn a clinic into a factory.
    spec = state.spec.useType ? { ...merged, useType: state.spec.useType, mode: state.spec.mode } : merged;
    if (state.field === "rooms" && !wantsSearch && spec.mode !== "home") spec = answerRooms(spec, text, asked, notes);
    if (state.field === "baths" && SKIP_ROOMS.test(text) && !/\d/.test(text)) notes.push("No problem. I'll plan on 1 bathroom.");
  }
  let { stages, pool } = funnel(asSpec(spec), shells);
  // Essentials first; once they're done (or the user says search), one optional deeper question per turn.
  const plan = () => {
    const e = state.ready || wantsSearch ? null : interviewQuestion(spec, pool, asked);
    return { ready: !e, q: e ?? (wantsSearch ? null : deeperQuestion(spec, asked)) };
  };
  let { ready, q } = plan();

  let ack = "";
  let llm = false;
  // Tapped answers are already structured; only free text goes to the model.
  if (hasGemini() && text && !tapped) {
    try {
      const history: Content[] = state.history.slice(-8).map((m) => ({ role: m.role === "hermit" ? "model" : "user", parts: [{ text: m.text }] }));
      const out = await generateJSON(SYSTEM, [...history, { role: "user", parts: [{ text: `What I know: ${spec.useType ? describe(spec) : "nothing yet"}.\nCURRENT SKETCH: ${sketchText(spec)}\nUser's last message: ${text}\nNEXT QUESTION: ${q ? q.text : "none"}${ready ? "\n(The essentials are done; this is an optional extra question and the See your matches button is showing.)" : ""}` }] }], Update, 9000);
      if (out) {
        llm = true;
        spec = applyUpdate(spec, out.update, !!state.spec.useType);
        spec = fitHeadcount(spec, state.spec.headcount);
        ({ stages, pool } = funnel(asSpec(spec), shells));
        ({ ready, q } = plan());
        ack = cleanWording(out.acknowledgement);
        if (q && out.question && !["city", "use"].includes(q.field)) q = { ...q, text: cleanWording(out.question) };
      }
    } catch {
      // the deterministic interview continues
    }
  }
  if (!llm) spec = fitHeadcount(spec, state.spec.headcount);
  if (text && q?.field === "city") q = { ...q, text: CITY_AGAIN };
  if (notes.length) ack = "";
  else if (!ack && text && !tapped) ack = ["Got it.", "Thanks.", "Okay.", "Noted."][state.history.length % 4];
  const changed = sketchText(spec) !== sketchText(state.spec);

  const history: Msg[] = [...state.history, ...(text ? [{ role: "user" as const, text }] : [])];
  const basics = basicsDone(spec, asked);
  const out = (reply: string, why?: string): ITurn => ({
    reply, why, quick: [], state: { spec, asked, history: [...history, { role: "hermit" as const, text: reply }].slice(-40), field: q?.field ?? null, quick: [], ready },
    ready, basicsDone: ready || basics, stages, llm, progress: progress(spec, asked, ready),
  });
  if (ready) {
    const lead = state.ready ? `${ack || "Updated."}${changed ? ` Sketch on the right: ${sketchText(spec)}.` : ""}` : `${ack} That's everything I need for ${describe(spec)}.`.trim();
    const go = wantsSearch ? "Tap “See your matches” below and I'll send the crew in." : "You can tap “See your matches” below whenever you're ready.";
    return out([lead, go, wantsSearch ? "" : q?.text ?? "Is there anything else you'd like me to factor in?"].filter(Boolean).join(" "), q?.why);
  }
  const lead2 = notes.join(" ");
  const sketchNote = lead2 ? ` ${lead2}` : basics && !basicsDone(state.spec, state.asked) ? " I've sketched a typical layout on the right; change anything you like." : "";
  return out(`${ack}${sketchNote} ${q!.text}`.trim(), q!.why);
}

const sketchText = (s: Draft) => {
  const rooms = s.useType ? seedRooms(s) : [];
  const area = rooms.reduce((t, r) => t + r.count * (r.minSqft ?? 100), 0);
  const size = s.sizeSqft ? `, target ${s.sizeSqft[0].toLocaleString()}–${s.sizeSqft[1].toLocaleString()} sq ft` : "";
  return rooms.length ? `${rooms.map((r) => `${r.count} ${plural(r.label, r.count)}${r.minSqft ? ` (${r.minSqft} sq ft)` : ""}`).join(", ")}; about ${area.toLocaleString()} sq ft of rooms${size}` : "nothing drawn yet";
};

// A bigger team must not leave a 2,500 sq ft range and a 300 sq ft open area behind, whether or not the model resized them.
export function fitHeadcount(spec: Draft, prevHeadcount?: number): Draft {
  const hc = spec.headcount;
  if (!hc || hc === prevHeadcount || spec.mode === "home") return spec;
  const s: Draft = { ...spec };
  if (!s.sizeSqft || s.sizeSqft[1] < hc * 100) s.sizeSqft = [hc * 150, hc * 250];
  if (packFor(s).key === "office") {
    s.rooms = seedRooms(s).map((r) => (r.label === "open" && (r.minSqft ?? 0) < hc * 40 ? { ...r, minSqft: hc * 50 } : r));
    s.input = "chat";
  }
  return s;
}

function applyUpdate(spec: Draft, u: z.infer<typeof Update>["update"], useLocked: boolean): Draft {
  const s: Draft = { ...spec, needs: { ...spec.needs }, rooms: [...spec.rooms] };
  if (u.useType && !useLocked && !spec.useType) s.useType = u.useType;
  if (u.sizeMinSqft && u.sizeMaxSqft && u.sizeMaxSqft >= u.sizeMinSqft) s.sizeSqft = [u.sizeMinSqft, u.sizeMaxSqft];
  for (const k of ["headcount", "beds", "baths", "budgetMonthly", "budgetTotal"] as const) if (u[k] != null && u[k]! > 0) s[k] = u[k]!;
  if (u.baths && spec.mode !== "home") {
    if (!s.rooms.length && s.useType) s.rooms = seedRooms(s);
    const i = s.rooms.findIndex((r) => r.label === "bathroom");
    if (i >= 0) s.rooms[i] = { ...s.rooms[i], count: Math.round(u.baths) };
    else s.rooms.push({ label: "bathroom", count: Math.round(u.baths), hard: false });
    s.input = "chat";
  }
  if (u.parkingStalls != null) Object.assign(s.needs, { parkingStalls: u.parkingStalls, parking: u.parkingStalls > 0 });
  for (const k of ["wheelchair", "stepFree", "heavyPower", "kitchen"] as const) if (u[k] != null) s.needs[k] = u[k]!;
  if (u.moveIn) s.moveInBy = u.moveIn;
  // Editing one room of the sketch means the rest of the sketch is now the user's too.
  if ((u.rooms.length || u.removeRooms.length) && !s.rooms.length && s.useType) s.rooms = seedRooms(s);
  for (const r of u.rooms) {
    const room = { label: r.label.toLowerCase(), count: Math.max(1, Math.round(r.count)), hard: false, ...(r.minSqft ? { minSqft: r.minSqft } : {}), ...(r.fixtures.length ? { fixtures: r.fixtures } : {}) };
    const i = s.rooms.findIndex((x) => x.label === room.label);
    if (i >= 0) s.rooms[i] = { ...s.rooms[i], ...room, fixtures: room.fixtures ?? s.rooms[i].fixtures };
    else s.rooms.push(room);
  }
  if (u.removeRooms.length) s.rooms = s.rooms.filter((r) => !u.removeRooms.map((x) => x.toLowerCase()).includes(r.label));
  if (u.rooms.length || u.removeRooms.length) s.input = "chat";
  return s;
}
