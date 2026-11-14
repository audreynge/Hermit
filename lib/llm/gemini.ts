import { toJSONSchema, type z } from "zod";

// Gemini as a planner/chat provider via the Gemini API (REST generateContent), keyed by GEMINI_API_KEY.
const API = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiPart = { text?: string; thought?: boolean; inlineData?: { mimeType: string; data: string }; functionCall?: { id?: string; name: string; args?: Record<string, unknown> }; functionResponse?: object; thoughtSignature?: string };
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type GeminiClient = { model: string; generate(body: Record<string, unknown>): Promise<GeminiContent> };

let picked: Promise<string | null> | null = null;
let replaced: string | null = null; // set when the configured model 404'd and a newer one was picked
// Newest stable flash-lite (fastest for a <45 s search), else flash, the key can call; GEMINI_MODEL overrides.
async function pickModel(key: string, skip?: string): Promise<string | null> {
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  if (!res.ok) throw new Error(`Gemini models ${res.status}`);
  const names: string[] = ((await res.json()).models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: { name: string }) => m.name.replace(/^models\//, ""))
    .filter((n: string) => n !== skip);
  const ver = (n: string) => Number(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const best = (re: RegExp) => names.filter((n) => re.test(n)).sort((a, b) => ver(b) - ver(a))[0];
  return best(/^gemini-[\d.]+-flash-lite$/) ?? best(/^gemini-[\d.]+-flash$/) ?? best(/^gemini-[\d.]+-flash/) ?? best(/^gemini-/) ?? null;
}

export async function geminiClient(): Promise<GeminiClient | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const first = replaced || process.env.GEMINI_MODEL || (await (picked ??= pickModel(key).catch((e) => { picked = null; throw e; })));
  if (!first) return null;
  let model = first;
  const call = async (body: Record<string, unknown>) => {
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    return { res, j: await res.json().catch(() => ({})) };
  };
  const client: GeminiClient = {
    model,
    async generate(body) {
      let { res, j } = await call(body);
      // A retired model (e.g. gemini-2.5-flash-lite for new keys) 404s: re-pick the newest available one once and remember it.
      if (res.status === 404) {
        const next = await pickModel(key, model).catch(() => null);
        if (next) {
          console.warn(`[hermit] Gemini model ${model} unavailable; using ${next}`);
          model = client.model = replaced = next;
          ({ res, j } = await call(body));
        }
      }
      if (!res.ok) throw new Error(`Gemini ${model} ${res.status}: ${j.error?.message?.slice(0, 200) ?? "request failed"}`);
      const c = j.candidates?.[0];
      if (!c?.content) throw new Error(`Gemini returned no content (${c?.finishReason ?? j.promptFeedback?.blockReason ?? "unknown"})`);
      return { role: "model", parts: c.content.parts ?? [] };
    },
  };
  return client;
}

export const geminiText = (c: GeminiContent) => c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();

/** JSON-mode Gemini call for one-shot structured output (vision extraction, research, verification). Returns the parsed JSON or throws. */
export async function geminiJson(g: GeminiClient, system: string, parts: GeminiPart[], schema: object): Promise<unknown> {
  const turn = await g.generate({
    systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
  });
  return JSON.parse(geminiText(turn) || "null");
}

// Interview helpers (from the studio overhaul), routed through the same client so they get model re-picking too.

export const hasGemini = () => !!process.env.GEMINI_API_KEY?.trim();
export type Part = GeminiPart;
export type Content = GeminiContent;

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

export async function generate(body: Record<string, unknown>, timeoutMs = 20_000): Promise<{ parts: Part[] }> {
  const g = await geminiClient();
  if (!g) throw new Error("GEMINI_API_KEY is not set");
  const turn = await Promise.race([
    g.generate(body),
    new Promise<never>((_, no) => setTimeout(() => no(new Error(`Gemini: no answer in ${timeoutMs / 1000}s`)), timeoutMs)),
  ]);
  return { parts: turn.parts };
}

export async function generateJSON<T extends z.ZodType>(system: string, contents: Content[], schema: T, timeoutMs?: number): Promise<z.infer<T> | null> {
  try {
    const { parts } = await generate({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: cleanSchema(toJSONSchema(schema)), temperature: 0.4 },
    }, timeoutMs);
    const parsed = schema.safeParse(JSON.parse(parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
