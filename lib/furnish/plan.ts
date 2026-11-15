// "Furnish it for me": Gemini plans every requested room at once from the use and the user's own words; code lays it
// out (layout.ts). Without Gemini, each room gets its cached or starter suggestions.
import { z } from "zod";
import { geminiClient, geminiJson, type GeminiClient } from "../llm/gemini";
import { clampSize, normName } from "./catalog";
import type { PlanItem } from "./layout";
import { suggestItems } from "./suggest";

const Name = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 '&/-]*$/);
const Out = z.object({
  reply: z.string(),
  rooms: z.array(z.object({
    id: z.string(),
    items: z.array(z.object({ name: Name, terms: z.array(Name).min(1).max(3), count: z.number(), at: z.enum(["wall", "center"]), w: z.number(), d: z.number(), h: z.number() })).max(14),
  })),
});
const SCHEMA = z.toJSONSchema(Out);

const PROMPT = `You furnish a real scanned space for someone deciding whether to rent or buy it. For each listed room, choose the movable furniture and equipment their intended use needs there, following their brief.
- Scale quantities to the room's floor area and the brief (e.g. desks for a stated headcount, spread over the rooms that suit them). Leave walking space: furniture should cover at most about 40% of a room's floor.
- Rooms like hallways, bathrooms and closets get little or nothing.
- name: 1-3 plain generic words. terms: 2-3 search keywords, specific to generic, that would match a simple low-poly 3D model title. Never vague words like "furniture" or "equipment".
- at: "wall" for pieces that stand against a wall (desks in rows, shelves, counters, beds, sofas, cabinets); "center" for tables, islands, chairs around a table, exam tables.
- w, d, h: typical width, depth and height in meters. count: how many.
- Use each room's id exactly as given; skip a room by leaving it out.
reply: one short friendly sentence describing the setup, without promising it fits or meets code.`;

export type PlanRoom = { id: string; label: string; areaSqm?: number };
export type PlanIn = { use: string; brief?: string; rooms: PlanRoom[] };
export type PlanOut = { rooms: { id: string; items: PlanItem[] }[]; reply: string; source: "gemini" | "starter" };

const TABLEISH = /table|desk|island|chair|stool|bench/;

async function starter(input: PlanIn): Promise<PlanOut> {
  const rooms = await Promise.all(input.rooms.map(async (r) => {
    const { items } = await suggestItems({ use: input.use, room: r.label, areaSqm: r.areaSqm }, null);
    return { id: r.id, items: items.slice(0, 6).map((i) => ({ ...i, count: 1, at: (TABLEISH.test(i.name) ? "center" : "wall") as PlanItem["at"] })) };
  }));
  return { rooms, reply: "I set out the basics for each room (simple mode: the AI planner isn't available right now).", source: "starter" };
}

export async function planFurnishing(input: PlanIn, gemini?: GeminiClient | null): Promise<PlanOut> {
  const g = gemini !== undefined ? gemini : await geminiClient().catch(() => null);
  if (!g) return starter(input);
  const ids = new Set(input.rooms.map((r) => r.id));
  const lines = [
    `Intended use: ${input.use || "home"}`,
    `Brief: ${input.brief?.slice(0, 500) || "a typical, practical setup for this use"}`,
    "Rooms:",
    ...input.rooms.map((r) => `- id ${r.id}: ${r.label}${r.areaSqm ? `, about ${Math.round(r.areaSqm)} m²` : ""}`),
  ];
  try {
    const out = Out.safeParse(await geminiJson(g, PROMPT, [{ text: lines.join("\n") }], SCHEMA));
    if (!out.success) return starter(input);
    const rooms = out.data.rooms.filter((r) => ids.has(r.id)).map((r) => ({
      id: r.id,
      items: r.items.map((i) => ({ name: normName(i.name), terms: i.terms, count: Math.max(1, Math.min(40, Math.round(i.count))), at: i.at, size: clampSize({ w: i.w, d: i.d, h: i.h }) })),
    }));
    return { rooms, reply: out.data.reply.slice(0, 300), source: "gemini" };
  } catch (e) {
    console.warn(`[hermit] furnishing plan fell back (${e instanceof Error ? e.message : e})`);
    return starter(input);
  }
}
