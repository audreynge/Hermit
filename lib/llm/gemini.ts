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
