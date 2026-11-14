// Minimal Gemini REST client (server only). Used for interview turns and the search planner when GEMINI_API_KEY is set.
import type { z } from "zod";
import { toJSONSchema } from "zod";

const env = (k: string) => process.env[k]?.trim().replace(/^"|"$/g, "");
export const geminiModel = () => env("GEMINI_MODEL") || "gemini-3.5-flash-lite";
export const hasGemini = () => !!env("GEMINI_API_KEY");

export type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; functionResponse?: { name: string; response: Record<string, unknown>; id?: string } };
export type Content = { role: "user" | "model"; parts: Part[] };

// Gemini accepts a JSON-schema subset; strip keys it rejects.
export function cleanSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (["$schema", "additionalProperties", "$id", "$ref", "default", "exclusiveMinimum", "exclusiveMaximum"].includes(k)) continue;
    out[k] = cleanSchema(v);
  }
  return out;
}

export async function generate(body: Record<string, unknown>, timeoutMs = 20_000): Promise<{ parts: Part[]; finish?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env("GEMINI_API_KEY") ?? "" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`gemini ${res.status}: ${JSON.stringify(json.error?.message ?? json).slice(0, 200)}`);
    const c = json.candidates?.[0];
    return { parts: c?.content?.parts ?? [], finish: c?.finishReason };
  } finally {
    clearTimeout(t);
  }
}

export async function generateJSON<T extends z.ZodType>(system: string, contents: Content[], schema: T, timeoutMs?: number): Promise<z.infer<T> | null> {
  const { parts } = await generate({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: cleanSchema(toJSONSchema(schema)), temperature: 0.4 },
  }, timeoutMs);
  const text = parts.map((p) => p.text ?? "").join("");
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
