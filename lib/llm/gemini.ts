// Gemini as a planner/chat provider via the Gemini API (REST generateContent), keyed by GEMINI_API_KEY.
const API = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiPart = { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: Record<string, unknown> }; functionResponse?: object; thoughtSignature?: string };
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
export type GeminiClient = { model: string; generate(body: Record<string, unknown>): Promise<GeminiContent> };

let picked: Promise<string | null> | null = null;
// Newest stable "flash" model the key can call (fast enough for a <45 s search); GEMINI_MODEL overrides.
async function pickModel(key: string): Promise<string | null> {
  const res = await fetch(`${API}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  if (!res.ok) throw new Error(`Gemini models ${res.status}`);
  const names: string[] = ((await res.json()).models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: { name: string }) => m.name.replace(/^models\//, ""));
  const ver = (n: string) => Number(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const best = (re: RegExp) => names.filter((n) => re.test(n)).sort((a, b) => ver(b) - ver(a))[0];
  return best(/^gemini-[\d.]+-flash$/) ?? best(/^gemini-[\d.]+-flash/) ?? best(/^gemini-/) ?? null;
}

export async function geminiClient(): Promise<GeminiClient | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL ?? (await (picked ??= pickModel(key).catch((e) => { picked = null; throw e; })));
  if (!model) return null;
  return {
    model,
    async generate(body) {
      const res = await fetch(`${API}/models/${model}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${j.error?.message?.slice(0, 200) ?? "request failed"}`);
      const c = j.candidates?.[0];
      if (!c?.content) throw new Error(`Gemini returned no content (${c?.finishReason ?? j.promptFeedback?.blockReason ?? "unknown"})`);
      return { role: "model", parts: c.content.parts ?? [] };
    },
  };
}

export const geminiText = (c: GeminiContent) => c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
