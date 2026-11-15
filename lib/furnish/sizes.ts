// Real-world size for any item name: the typical-size table, else Gemini's typical dimensions (one call per new name,
// cached 30 days), else the default, flagged approximate.
import { z } from "zod";
import { geminiClient, geminiJson, type GeminiClient } from "../llm/gemini";
import { getCached, putCached } from "../regs/cache";
import { clampSize, DEFAULT_SIZE, normName, typicalSize, type Size } from "./catalog";

export type SizeSource = "table" | "gemini" | "default";
const Out = z.object({ w: z.number().min(0.02).max(6), d: z.number().min(0.02).max(6), h: z.number().min(0.01).max(6) });
const SCHEMA = z.toJSONSchema(Out);
const PROMPT = `Give the typical real-world size of one item of furniture or equipment, in meters: w = width (side to side, the longer horizontal side for most items), d = depth (front to back), h = height. Use common North American sizes.`;

export async function sizeFor(name: string, gemini?: GeminiClient | null): Promise<{ size: Size; source: SizeSource }> {
  const t = typicalSize(name);
  if (t.known) return { size: t.size, source: "table" };
  const n = normName(name);
  const key = `furnish-size:${n}`;
  const hit = await getCached<Size>(key);
  if (hit) return { size: hit, source: "gemini" };
  const g = gemini !== undefined ? gemini : await geminiClient().catch(() => null);
  if (g && n) {
    try {
      const out = Out.safeParse(await geminiJson(g, PROMPT, [{ text: `Item: ${n.slice(0, 40)}` }], SCHEMA));
      if (out.success) { const size = clampSize(out.data); await putCached(key, size, 30); return { size, source: "gemini" }; }
    } catch (e) { console.warn(`[hermit] size lookup fell back (${e instanceof Error ? e.message : e})`); }
  }
  return { size: DEFAULT_SIZE, source: "default" };
}
