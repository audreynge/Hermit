// What someone would put in this room for their intended use ("ramen shop" kitchen → commercial range, prep table…).
// Gemini proposes the list once per (use, room) and it is cached; without Gemini, starter items per room label.
import { z } from "zod";
import { geminiClient, geminiJson, type GeminiClient } from "../llm/gemini";
import { getCached, putCached } from "../regs/cache";
import { clampSize, normName, starterItems, type FurnishItem } from "./catalog";

const Name = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 '&/-]*$/);
const Out = z.object({
  items: z.array(z.object({ name: Name, terms: z.array(Name).min(1).max(3), w: z.number(), d: z.number(), h: z.number() })).max(12),
});
const SCHEMA = z.toJSONSchema(Out);

const PROMPT = `You help someone picture furniture and equipment in a space they might rent or buy.
Given their intended use and the room they are standing in, list up to 10 movable items they would most likely need in THAT room for THAT use, most essential first.
- name: 1-3 plain generic words (e.g. "commercial range", "two-top table", "styling chair").
- terms: 2-3 search keywords from specific to generic that would match a simple low-poly 3D model title (e.g. ["commercial range", "stove", "oven"]).
- w, d, h: typical width, depth and height in meters.
Never use vague terms like "furniture" or "equipment". Only furniture and equipment; no walls, built-in plumbing, wiring or decor themes. If the room doesn't suit the use, suggest what the use would still put there.`;

export type SuggestIn = { use: string; room: string; areaSqm?: number };
export type Suggestions = { items: FurnishItem[]; source: "gemini" | "starter" };

export async function suggestItems(input: SuggestIn, gemini?: GeminiClient | null): Promise<Suggestions> {
  const use = input.use.trim().slice(0, 80) || "home";
  const key = `furnish-suggest:${normName(use)}|${normName(input.room)}`;
  const hit = await getCached<FurnishItem[]>(key);
  if (hit) return { items: hit, source: "gemini" };
  const fallback: Suggestions = { items: starterItems(input.room), source: "starter" };
  const g = gemini !== undefined ? gemini : await geminiClient().catch(() => null);
  if (!g) return fallback;
  try {
    const area = input.areaSqm ? ` (about ${Math.round(input.areaSqm)} m²)` : "";
    const out = Out.safeParse(await geminiJson(g, PROMPT, [{ text: `Intended use: ${use}\nRoom: ${input.room}${area}` }], SCHEMA));
    if (!out.success || !out.data.items.length) return fallback;
    const items = out.data.items.slice(0, 10).map((i) => ({ name: normName(i.name), terms: i.terms, size: clampSize({ w: i.w, d: i.d, h: i.h }) }));
    await putCached(key, items, 30);
    return { items, source: "gemini" };
  } catch (e) {
    console.warn(`[hermit] furniture suggestions fell back (${e instanceof Error ? e.message : e})`);
    return fallback;
  }
}
