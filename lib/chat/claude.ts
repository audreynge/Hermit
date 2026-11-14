import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODEL } from "../agent/model";
import { RoomReq } from "../types";
import { converse, describe, question, type ChatState, type Turn } from "./converse";

const n = z.number().nullable();
const b = z.boolean().nullable();
const ChatOut = z.object({
  reply: z.string(),
  ready: z.boolean(),
  quickReplies: z.array(z.string()),
  action: z.enum(["none", "compare", "email", "regulations"]),
  update: z.object({
    useType: z.string().nullable(), mode: z.enum(["home", "business", "enterprise"]).nullable(), city: z.enum(["houston", "los_angeles"]).nullable(),
    sizeMinSqft: n, sizeMaxSqft: n, budgetMonthly: n, budgetTotal: n, headcount: n, beds: n, baths: n,
    rooms: z.array(z.object({ label: z.string(), count: z.number(), minSqft: n, fixtures: z.array(z.string()), hard: z.boolean() })),
    needs: z.object({ parking: b, wheelchair: b, groundFloor: b, heavyPower: b, esfr: b, driveInBays: n }),
  }),
});

const SYSTEM = `You are Hermit, a friendly assistant that helps small businesses (and people looking for homes) find spaces in Houston or Los Angeles that are already built for what they need.
Talk like a warm, concise human: one or two short sentences, then at most one question. Ask only for what is still missing to search well: what the space is for, the city, rough size, and the key rooms or equipment. Never ask more than three questions in total; if the user wants to search now, set ready true.
In "update", put only what the user's latest message adds or changes, and use null for everything else. Never invent requirements.
After results exist, set action "compare" when they want a comparison, "email" when they want to contact the property manager, and ready true when they change the search. Set action "regulations" whenever they ask about permits, licenses, zoning or other rules.
quickReplies: 2-4 short tap-to-answer suggestions for your question.`;

type Client = Pick<Anthropic, "messages">;

export async function chatTurn(state: ChatState, text: string, client?: Client | null): Promise<Turn> {
  const c = client !== undefined ? client : process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  if (!c) return converse(state, text);
  try {
    const res = await c.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: "low", format: zodOutputFormat(ChatOut) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Phase: ${state.phase}\nWhat I know so far: ${describe(state.spec)}\nQuestions already asked: ${state.asked.join(", ") || "none"}\nUser says: ${text}` }],
    });
    const out = res.parsed_output;
    if (!out) return fallbackTurn(state, text, "no structured output");
    const u = out.update;
    const spec = { ...state.spec, needs: { ...state.spec.needs }, rooms: [...state.spec.rooms], input: "chat" as const };
    if (u.useType) spec.useType = u.useType;
    if (u.mode) spec.mode = u.mode;
    if (u.city) spec.city = u.city;
    if (u.sizeMinSqft && u.sizeMaxSqft) spec.sizeSqft = [u.sizeMinSqft, u.sizeMaxSqft];
    for (const k of ["budgetMonthly", "budgetTotal", "headcount", "beds", "baths"] as const) if (u[k] != null) spec[k] = u[k]!;
    for (const [k, v] of Object.entries(u.needs)) if (v != null && v !== false) Object.assign(spec.needs, { [k]: v });
    for (const r of u.rooms) {
      const room = RoomReq.parse({ label: r.label, count: Math.max(1, Math.round(r.count)), hard: r.hard, ...(r.minSqft ? { minSqft: r.minSqft } : {}), ...(r.fixtures.length ? { fixtures: r.fixtures } : {}) });
      const i = spec.rooms.findIndex((x) => x.label === room.label);
      if (i >= 0) spec.rooms[i] = room;
      else spec.rooms.push(room);
    }
    const next: ChatState = { ...state, spec };
    if (out.ready && (!spec.useType || !spec.city)) {
      const slot = !spec.useType ? "use" : "city";
      const q = question(slot, spec);
      return { reply: q.q, state: { ...next, asked: [...next.asked, slot] }, ready: false, quickReplies: q.quick };
    }
    return { reply: out.reply, state: next, ready: out.ready, quickReplies: out.quickReplies.slice(0, 4), ...(out.action !== "none" ? { action: out.action } : {}) };
  } catch (e) {
    return fallbackTurn(state, text, e instanceof Error ? e.message : String(e));
  }
}

function fallbackTurn(state: ChatState, text: string, why: string): Turn {
  console.warn(`[hermit] Claude chat turn failed (${why}); answering deterministically`);
  return { ...converse(state, text), fallback: "deterministic" };
}
