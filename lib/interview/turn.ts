import { z } from "zod";
import { describe, mergeText } from "../chat/converse";
import { generateJSON, hasGemini, type Content } from "../llm/gemini";
import { cleanWording } from "../llm/wording";
import { funnel } from "../query/shells";
import { TIMING_OPTIONS, type Draft } from "../spec/survey";
import { chipsIn, toggleChip } from "../uses/chips";
import { packFor, seedRooms } from "../uses/packs";
import type { FunnelStage, RequirementSpec, Shell } from "../types";
import { basicsDone, nextQuestion, type Field } from "./next";

export type Msg = { role: "hermit" | "user"; text: string };
export type IState = { spec: Draft; asked: string[]; history: Msg[]; field?: Field | null; quick?: string[]; ready?: boolean };
export type ITurn = { reply: string; why?: string; quick: string[]; multi?: boolean; state: IState; ready: boolean; basicsDone: boolean; stages: FunnelStage[]; llm: boolean };

const SKIP = /\b(just search|search now|go ahead|that'?s (it|all)|skip|find (it|them|spaces)|show me|let'?s see|walk inside)\b/i;
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
    case "rooms":
      if (/typical|works|sounds good|yes/.test(t)) next.rooms = seedRooms(next);
      break;
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
    case "musts":
      for (const c of chipsIn(text, packFor(next).chips)) next = toggleChip(c, next, true);
      break;
  }
  return next;
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
"acknowledgement": one short, friendly sentence that answers or reflects what they said; if it matters, add the expert implication ("Exam rooms need sinks, so I'll look for plumbing"). No exclamation marks, no fluff.
"question": rephrase NEXT QUESTION naturally in one sentence, keeping its meaning. If NEXT QUESTION is "none", write "" (empty).
The screen has only two things: this chat on the left and a sketch of their space on the right (rooms they can drag, resize or delete). There are no property cards until the crew searches. If they ask where to click or what to do, say so plainly; when the interview is finished, the "Walk inside the matches" button sits at the bottom of the chat.
Never claim compliance, availability or guarantees. Never use the words "compliant", "certified" or "guaranteed".`;

export async function interviewTurn(state: IState, text: string | null, shells: Shell[]): Promise<ITurn> {
  let spec = state.spec;
  // Once the sketch is on screen, its rooms are the requirement the user edits.
  if (!spec.rooms.length && spec.useType && basicsDone(spec, state.asked)) spec = { ...spec, rooms: seedRooms(spec) };
  const asked = [...state.asked];
  if (state.field && !asked.includes(state.field)) asked.push(state.field);
  const tapped = !!text && !!state.quick?.includes(text);
  if (text) {
    spec = answerField(spec, state.field, text);
    const merged = mergeText(spec, text).spec;
    // Once the use is set, a stray noun ("a small lab") must not turn a clinic into a factory.
    spec = state.spec.useType ? { ...merged, useType: state.spec.useType, mode: state.spec.mode } : merged;
  }
  const wantsSearch = !!text && SKIP.test(text);
  let { stages, pool } = funnel(asSpec(spec), shells);
  const done = () => !!state.ready || wantsSearch;
  let q = done() ? null : nextQuestion(spec, pool, asked);

  let ack = "";
  let llm = false;
  // Tapped answers are already structured; only free text goes to the model.
  if (hasGemini() && text && !tapped) {
    try {
      const history: Content[] = state.history.slice(-8).map((m) => ({ role: m.role === "hermit" ? "model" : "user", parts: [{ text: m.text }] }));
      const out = await generateJSON(SYSTEM, [...history, { role: "user", parts: [{ text: `What I know: ${spec.useType ? describe(spec) : "nothing yet"}.\nUser's last message: ${text}\nNEXT QUESTION: ${q ? q.text : "none"}${state.ready ? "\n(The interview is finished; the Walk inside button is showing in the chat.)" : ""}` }] }], Update, 9000);
      if (out) {
        llm = true;
        spec = applyUpdate(spec, out.update, !!state.spec.useType);
        ({ stages, pool } = funnel(asSpec(spec), shells));
        q = done() ? null : nextQuestion(spec, pool, asked);
        ack = cleanWording(out.acknowledgement);
        if (q && out.question && !["city", "use", "musts"].includes(q.field)) q = { ...q, text: cleanWording(out.question) };
      }
    } catch {
      // the deterministic interview continues
    }
  }
  if (!ack && text && !tapped) ack = "Got it.";

  const history: Msg[] = [...state.history, ...(text ? [{ role: "user" as const, text }] : [])];
  const basics = basicsDone(spec, asked);
  if (!q) {
    const reply = state.ready
      ? `${ack || "Updated."} Your sketch is up to date. Tap “Walk inside the matches” whenever you're ready.`
      : `${ack} That's everything I need for ${describe(spec)}. Tap “Walk inside the matches” below and I'll send the crew in.`.trim();
    return { reply, quick: [], state: { spec, asked, history: [...history, { role: "hermit", text: reply }], field: null, quick: [], ready: true }, ready: true, basicsDone: true, stages, llm };
  }
  const sketchNote = basics && !basicsDone(state.spec, state.asked) ? " I've sketched a typical layout on the right; change anything you like." : "";
  const reply = `${ack}${sketchNote} ${q.text}`.trim();
  return { reply, why: q.why, quick: q.quick, multi: q.multi, state: { spec, asked, history: [...history, { role: "hermit", text: reply }], field: q.field, quick: q.quick, ready: false }, ready: false, basicsDone: basics, stages, llm };
}

function applyUpdate(spec: Draft, u: z.infer<typeof Update>["update"], useLocked: boolean): Draft {
  const s: Draft = { ...spec, needs: { ...spec.needs }, rooms: [...spec.rooms] };
  if (u.useType && !useLocked && !spec.useType) s.useType = u.useType;
  if (u.sizeMinSqft && u.sizeMaxSqft && u.sizeMaxSqft >= u.sizeMinSqft) s.sizeSqft = [u.sizeMinSqft, u.sizeMaxSqft];
  for (const k of ["headcount", "beds", "baths", "budgetMonthly", "budgetTotal"] as const) if (u[k] != null && u[k]! > 0) s[k] = u[k]!;
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
