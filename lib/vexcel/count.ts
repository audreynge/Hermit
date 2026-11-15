import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths";
import type { AerialCount } from "../types";
import { vexcelImage } from "./client";

// Scan ids and record-only shell ids ("prop-123"): the same shape lib/query/load#isSafeId accepts.
export const SAFE_SID = /^[A-Za-z0-9_-]{1,40}$/;

// Reads a saved aerial count (written by pipeline/aerial.ts, or live by app/api/aerial). Returns null when the space
// wasn't counted: callers must treat null as "not counted", never as zero. On Vercel a live count sits in /tmp and wins
// over the bundled one, since it's newer.
export function loadAerialCount(sid: string | undefined): AerialCount | null {
  if (!sid || !SAFE_SID.test(sid)) return null;
  for (const d of [...(process.env.VERCEL ? ["/tmp"] : []), dataDir()]) {
    const file = path.join(d, "aerial", `${sid}.json`);
    try {
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as AerialCount;
    } catch {}
  }
  return null;
}

// ---- Counting (pipeline only: needs VEXCELAPIKEY and GEMINI_API_KEY) ----

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_VISION_MODEL = "gemini-3.8-flash";
// vexcelImage asks for a 40 m buffer around the point (an 80 m square) rendered at 800 px.
const GSD_CM = 10;

export const AERIAL_PROMPT = `This is a top-down aerial orthophoto, 800x800 px, covering about 80 m x 80 m (about 10 cm per pixel), centered on a commercial building. The center building is the building under the exact center of the image.
Count only what you can actually see inside the image. Never guess to fill a gap; use null when you cannot count something. Lots that run past the image edge are counted only for the part inside the image.
1. image_usable: false if the image is blank, cloud-covered, too blurry, or there is no building at the center.
2. boxes: first, box every HVAC rooftop unit (boxy mechanical units, condensers) on the CENTER building's roof only (label "rooftop_unit"), then box each parking lot that serves the center building (label "parking_area"). box_2d is [ymin, xmin, ymax, xmax] normalized 0-1000.
3. center_rows: go through the surface parking that serves the CENTER building, one row of stalls at a time. Include only lots that touch the center building or clearly belong to it (same driveway, same paved lot). Do NOT include lots that clearly belong to neighboring buildings or lots across a street. For each row give a short "where" (e.g. "west lot, row along building") and "stalls": the marked stalls in that row (count painted stall lines; a car parked in a stall is one stall).
4. stalls_center: the sum of center_rows. stalls_center_low / stalls_center_high: a plausible range for that sum given occlusion by trees, shadows and cars.
5. accessible_stalls_center: stalls in those rows with a visible wheelchair symbol or striped access aisle, or null if you cannot tell.
6. stalls_whole_image: marked surface stalls anywhere in the image, including neighbors' lots.
7. rooftop_units: the number of rooftop_unit boxes you drew.
8. garage_visible: true if a parking garage or deck is visible at or next to the center building (its stalls cannot be counted from above).
9. watermark_date: the date printed in the image's copyright watermark exactly as written after the dash (e.g. "01/2026"), or null if there is none.
10. notes: one short sentence on anything that limited the count.`;

const nullableInt = { type: ["integer", "null"] };
export const AERIAL_SCHEMA = {
  type: "object",
  properties: {
    image_usable: { type: "boolean" },
    boxes: {
      type: "array",
      items: {
        type: "object",
        properties: { label: { type: "string", enum: ["rooftop_unit", "parking_area"] }, box_2d: { type: "array", items: { type: "integer" } } },
        required: ["label", "box_2d"],
      },
    },
    center_rows: { type: "array", items: { type: "object", properties: { where: { type: "string" }, stalls: { type: "integer" } }, required: ["where", "stalls"] } },
    stalls_center: nullableInt,
    stalls_center_low: nullableInt,
    stalls_center_high: nullableInt,
    accessible_stalls_center: nullableInt,
    stalls_whole_image: nullableInt,
    rooftop_units: nullableInt,
    garage_visible: { type: "boolean" },
    watermark_date: { type: ["string", "null"] },
    notes: { type: "string" },
  },
  required: ["image_usable", "boxes", "center_rows", "stalls_center", "stalls_center_low", "stalls_center_high", "accessible_stalls_center", "stalls_whole_image", "rooftop_units", "garage_visible", "watermark_date", "notes"],
};

/** One vision run, normalized. Counts are non-negative integers or null. */
export type AerialRun = {
  usable: boolean;
  stalls: number | null;
  lo: number | null;
  hi: number | null;
  accessible: number | null;
  wholeImage: number | null;
  rooftopUnits: number | null;
  garage: boolean;
  boxes: AerialCount["boxes"];
  watermark: string | null; // "YYYY-MM" read from the image's copyright watermark
  notes: string;
};

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const clamp = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));

// Vexcel stamps "Vexcel Imaging US, Inc. © 2026 - 01/2026" on each ortho; the part after the dash is the capture month.
const watermarkMonth = (v: unknown): string | null => {
  const m = typeof v === "string" ? v.trim().match(/^(0[1-9]|1[0-2])\/(20\d{2})$/) : null;
  return m ? `${m[2]}-${m[1]}` : null;
};

/** Parses the model's JSON text into a normalized run. Throws if the text isn't a JSON object. */
export function parseAerialRun(text: string): AerialRun {
  const j = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("aerial: model did not return a JSON object");
  const usable = j.image_usable !== false;
  const boxes: AerialCount["boxes"] = [];
  for (const b of Array.isArray(j.boxes) ? j.boxes : []) {
    const { label, box_2d } = (b ?? {}) as { label?: unknown; box_2d?: unknown };
    if ((label !== "rooftop_unit" && label !== "parking_area" && label !== "stall") || !Array.isArray(box_2d) || box_2d.length !== 4) continue;
    if (!box_2d.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const [y0, x0, y1, x1] = (box_2d as number[]).map(clamp);
    if (y1 <= y0 || x1 <= x0) continue;
    boxes.push({ label, box: [y0, x0, y1, x1] });
  }
  const stalls = usable ? count(j.stalls_center ?? j.surface_stalls_marked) : null;
  let lo = usable ? count(j.stalls_center_low ?? j.stalls_low) : null;
  let hi = usable ? count(j.stalls_center_high ?? j.stalls_high) : null;
  if (stalls !== null) {
    lo = lo === null ? stalls : Math.min(lo, stalls);
    hi = hi === null ? stalls : Math.max(hi, stalls);
  }
  return {
    usable,
    stalls,
    lo,
    hi,
    accessible: usable ? count(j.accessible_stalls_center ?? j.accessible_stalls) : null,
    wholeImage: usable ? count(j.stalls_whole_image) : null,
    rooftopUnits: usable ? count(j.rooftop_units) : null,
    garage: j.garage_visible === true,
    boxes: usable ? boxes : [],
    watermark: watermarkMonth(j.watermark_date),
    notes: typeof j.notes === "string" ? j.notes.slice(0, 300) : "",
  };
}

/** Stall counts agree when both exist and differ by at most 3 stalls or 20% of their mean, whichever is larger. */
export function stallsAgree(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(3, 0.2 * ((a + b) / 2));
}

/** Rooftop-unit counts agree when both exist and differ by at most one. */
export const unitsAgree = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= 1;

/** Confidence when the first two runs agree, when a third run broke the tie (2 of 3 agreed), and when no two agreed. */
export const CONF_AGREED = 0.8;
export const CONF_TIEBREAK = 0.65;
export const CONF_UNCLEAR = 0.2;

const mean = (a: number, b: number) => Math.round((a + b) / 2);
const minN = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
const maxN = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/**
 * The pair of runs whose values agree: the first two if they do; otherwise the third run against either of the first two
 * (the closer pair if both agree). null when no two usable runs agree.
 */
export function agreeingPair(runs: AerialRun[], val: (r: AerialRun) => number | null, agree: (a: number | null, b: number | null) => boolean): [number, number] | null {
  const ok = ([i, j]: [number, number]) => j < runs.length && runs[i].usable && runs[j].usable && agree(val(runs[i]), val(runs[j]));
  if (ok([0, 1])) return [0, 1];
  const gap = ([i, j]: [number, number]) => Math.abs(val(runs[i])! - val(runs[j])!);
  return ([[0, 2], [1, 2]] as [number, number][]).filter(ok).sort((p, q) => gap(p) - gap(q))[0] ?? null;
}

export type Combined = Pick<AerialCount, "stalls" | "rooftopUnits" | "garageLikely" | "boxes"> & { wholeImage: number | null };

/**
 * Combines two or three runs by the agreement rule. First two agree: their mean, confidence 0.8. Otherwise a third run
 * that agrees with either: the mean of that pair, confidence 0.65. No agreeing pair means "couldn't count": null with
 * low confidence, never a guess.
 */
export function combineRuns(...runs: AerialRun[]): Combined {
  const sp = agreeingPair(runs, (r) => r.stalls, stallsAgree);
  const up = agreeingPair(runs, (r) => r.rooftopUnits, unitsAgree);
  const wp = agreeingPair(runs, (r) => r.wholeImage, stallsAgree);
  const conf = (p: [number, number]) => (p[1] === 1 ? CONF_AGREED : CONF_TIEBREAK);
  const usable = runs.filter((r) => r.usable);
  let stalls: Combined["stalls"] = { n: null, lo: null, hi: null, accessible: null, confidence: CONF_UNCLEAR };
  if (sp) {
    const [a, b] = [runs[sp[0]], runs[sp[1]]];
    stalls = {
      n: mean(a.stalls!, b.stalls!),
      lo: minN(a.lo, b.lo),
      hi: maxN(a.hi, b.hi),
      accessible: a.accessible !== null && b.accessible !== null && Math.abs(a.accessible - b.accessible) <= 1 ? mean(a.accessible, b.accessible) : null,
      confidence: conf(sp),
    };
  }
  // The boxes drawn on the photo come from a run in the agreeing pair, so the outlines show what was counted.
  const shown = (sp ?? up ?? [0]).map((i) => runs[i].boxes).find((b) => b.length) ?? runs[0]?.boxes ?? [];
  return {
    stalls,
    rooftopUnits: up ? { n: mean(runs[up[0]].rooftopUnits!, runs[up[1]].rooftopUnits!), confidence: conf(up) } : { n: null, confidence: CONF_UNCLEAR },
    garageLikely: usable.length >= 2 && usable.some((r) => r.garage),
    boxes: shown,
    wholeImage: wp ? mean(runs[wp[0]].wholeImage!, runs[wp[1]].wholeImage!) : null,
  };
}

/** True when two runs leave stalls or rooftop units without an agreeing pair and a third run could settle it. */
export function needsTiebreak(runs: AerialRun[]): boolean {
  if (runs.length !== 2 || !runs.some((r) => r.usable)) return false;
  return !agreeingPair(runs, (r) => r.stalls, stallsAgree) || !agreeingPair(runs, (r) => r.rooftopUnits, unitsAgree);
}

const list = (xs: (number | null)[]) => {
  const s = xs.map((x) => String(x ?? "none"));
  return s.length === 2 ? `${s[0]} vs ${s[1]}` : `${s.slice(0, -1).join(", ")} and ${s.at(-1)}`;
};

/** Plain-language citation for the count. */
export function aerialSource(model: string, c: Combined, runs: AerialRun[]): string {
  const base = `Vexcel ortho (80 m around the building), counted by Gemini (${model})`;
  if (runs.filter((r) => r.usable).length < 2) return `${base}; the image wasn't clear enough to count`;
  const parts: string[] = [];
  const how = (conf: number) => (conf === CONF_TIEBREAK ? "2 of 3 counts agreed" : "2 runs agreed");
  const st = runs.map((r) => r.stalls), ru = runs.map((r) => r.rooftopUnits);
  parts.push(c.stalls.n !== null ? `${how(c.stalls.confidence)} on ${c.stalls.n} surface stalls in lots serving the building`
    : `${runs.length} ${runs.length === 2 ? "runs" : "counts"} disagreed on stalls serving the building (${list(st)})`);
  parts.push(c.rooftopUnits.n !== null ? `${c.rooftopUnits.n} rooftop units${c.rooftopUnits.confidence === CONF_TIEBREAK ? " (2 of 3 counts agreed)" : ""}` : `rooftop units unclear (${list(ru)})`);
  if (c.wholeImage !== null) parts.push(`about ${c.wholeImage} stalls in the whole image, including neighbors`);
  return `${base}; ${parts.join("; ")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The wait Gemini asks for on a 429/503: the Retry-After header, else google.rpc.RetryInfo.retryDelay ("12s"). */
export function retryHintMs(res: Response, body: unknown): number | null {
  const h = res.headers.get("retry-after");
  if (h) {
    const s = Number(h);
    if (Number.isFinite(s)) return Math.max(0, s * 1000);
    const d = Date.parse(h);
    if (!Number.isNaN(d)) return Math.max(0, d - Date.now());
  }
  const details = (body as { error?: { details?: { retryDelay?: unknown }[] } })?.error?.details;
  for (const d of Array.isArray(details) ? details : []) {
    const m = typeof d?.retryDelay === "string" ? d.retryDelay.match(/^([\d.]+)s$/) : null;
    if (m) return Number(m[1]) * 1000;
  }
  return null;
}

/** A 429 that won't clear with a short wait: a per-day quota is used up (QuotaFailure quotaId "...PerDay...") or billing is out. */
export function quotaExhausted(body: unknown): boolean {
  type V = { quotaId?: unknown; quotaMetric?: unknown };
  const err = (body as { error?: { message?: unknown; details?: { violations?: V[] }[] } })?.error;
  const details = Array.isArray(err?.details) ? err.details : [];
  for (const d of details) {
    for (const v of Array.isArray(d?.violations) ? d.violations : []) if (/per ?day|daily/i.test(`${v?.quotaId ?? ""} ${v?.quotaMetric ?? ""}`)) return true;
  }
  return /per day|daily|prepayment|credits are depleted|billing/i.test(String(err?.message ?? ""));
}

/** Thrown when a model's daily quota is gone; the caller moves on to the next model in the chain. */
export class QuotaExhausted extends Error {
  constructor(readonly model: string, detail: string) { super(`Gemini ${model} quota exhausted: ${detail}`); }
}

/** One Gemini vision call with backoff and jitter on 429/5xx/network errors (honoring the server's retry hint). Returns the model's text. */
export async function geminiVision(image: Buffer, model: string, key: string, fetchFn: typeof fetch = fetch, tries = 5, backoffMs = 2000, timeoutMs = 120_000): Promise<string> {
  const body = {
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: image.toString("base64") } }, { text: AERIAL_PROMPT }] }],
    // Low thinking: on the hero ortho it ran ~6 s per call with steadier counts than the default (60-140 s, wider spread).
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: AERIAL_SCHEMA, thinkingConfig: { thinkingLevel: process.env.GEMINI_VISION_THINKING?.trim() || "low" } },
  };
  let last: unknown;
  let hint: number | null = null;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(Math.min(60_000, Math.max(hint ?? 0, backoffMs * 2 ** (i - 1)) * (0.75 + Math.random() / 2)));
    hint = null;
    try {
      const res = await fetchFn(`${GEMINI}/models/${model}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 429 && quotaExhausted(j)) throw new QuotaExhausted(model, String(j.error?.message ?? "").slice(0, 160));
      if (res.status === 429 || res.status >= 500) { hint = retryHintMs(res, j); last = new Error(`Gemini ${model} ${res.status}`); continue; }
      if (!res.ok) throw Object.assign(new Error(`Gemini ${model} ${res.status}: ${String(j.error?.message ?? "").slice(0, 200)}`), { fatal: true });
      const parts: { text?: string; thought?: boolean }[] = j.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      if (!text) { last = new Error(`Gemini ${model} returned no text (${j.candidates?.[0]?.finishReason ?? "unknown"})`); continue; }
      return text;
    } catch (e) {
      if (e instanceof QuotaExhausted || (e as { fatal?: boolean }).fatal) throw e;
      // A model that takes longer than the timeout is overloaded right now: let the chain move on instead of waiting again.
      if ((e as Error).name === "TimeoutError") throw new SlowModel(model, timeoutMs);
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export const VISION_MODEL_CHAIN = [DEFAULT_VISION_MODEL, "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];

/** The models to try in order: an explicit model, else GEMINI_VISION_MODEL (comma-separated allowed), else the default chain. */
export function visionModels(model?: string): string[] {
  const env = process.env.GEMINI_VISION_MODEL?.split(",").map((s) => s.trim()).filter(Boolean);
  return model ? [model] : env?.length ? env : VISION_MODEL_CHAIN;
}

// Models whose daily quota ran out in this process; skipped until the process restarts.
const exhausted = new Set<string>();
// Models that just timed out; skipped for a few minutes so a live count doesn't wait on an overloaded model again.
const slowUntil = new Map<string, number>();
const SLOW_SKIP_MS = 10 * 60_000;
export const resetExhaustedModels = () => { exhausted.clear(); slowUntil.clear(); };

/** Thrown when a model didn't answer within the timeout; the chain moves on to the next model. */
export class SlowModel extends Error {
  constructor(readonly model: string, ms: number) { super(`Gemini ${model} took longer than ${Math.round(ms / 1000)} s`); }
}

/** One run on the first model in the chain that still has quota. Throws QuotaExhausted when every model is out. */
type Ctx = { key: string; fetchFn: typeof fetch; backoffMs?: number; timeoutMs?: number };

async function runOnChain(img: Buffer, chain: string[], ctx: Ctx): Promise<{ run: AerialRun; model: string }> {
  let lastErr: Error | null = null;
  for (const model of chain) {
    if (exhausted.has(model) || (slowUntil.get(model) ?? 0) > Date.now()) continue;
    try {
      return { run: parseAerialRun(await geminiVision(img, model, ctx.key, ctx.fetchFn, 5, ctx.backoffMs, ctx.timeoutMs)), model };
    } catch (e) {
      if (e instanceof SlowModel) slowUntil.set(model, Date.now() + SLOW_SKIP_MS);
      else if (e instanceof QuotaExhausted) exhausted.add(model);
      else throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new QuotaExhausted(chain.join(", "), "every model in the chain is out of quota today");
}

/**
 * Counts one image: two runs (after any `prior` runs), and a third when they don't settle stalls or rooftop units. All new
 * runs for the image use the same model where possible: if a model ran out of quota midway, the runs it made are redone on
 * the model that's still working.
 */
export async function countRuns(img: Buffer, chain: string[], ctx: Ctx, prior: AerialRun[] = []): Promise<{ runs: AerialRun[]; model: string }> {
  const fresh = await Promise.all(Array.from({ length: Math.max(0, 2 - prior.length) }, () => runOnChain(img, chain, ctx)));
  const runs = [...prior, ...fresh.map((f) => f.run)];
  const models = fresh.map((f) => f.model);
  const unify = async () => {
    const final = models.at(-1);
    if (!final || models.every((m) => m === final)) return;
    const redo = await Promise.all(models.map((m) => (m === final ? null : runOnChain(img, [final], ctx).catch(() => null))));
    redo.forEach((r, i) => { if (r) { runs[prior.length + i] = r.run; models[i] = final; } });
  };
  await unify();
  if (needsTiebreak(runs)) {
    const t = await runOnChain(img, chain, ctx);
    runs.push(t.run);
    models.push(t.model);
    await unify();
  }
  return { runs, model: [...new Set(models)].join(" + ") || chain[0] };
}

/** The watermark month at least two runs read the same way. */
const agreedWatermark = (runs: AerialRun[]) => runs.map((r) => r.watermark).find((w, i, all) => w && all.indexOf(w) !== i) ?? null;

/** Where counts are written. The deploy bundle is read-only on Vercel, so live counts go to /tmp there. */
export const aerialWriteDir = () => path.join(process.env.VERCEL ? "/tmp" : dataDir(), "aerial");

function writeCount(sid: string, img: Buffer | null, runs: AerialRun[], model: string, keep?: Partial<AerialCount>): AerialCount {
  const c = combineRuns(...runs);
  const captured = agreedWatermark(runs) ?? keep?.captured;
  const out: AerialCount = {
    sid,
    provider: "vexcel",
    ...(captured ? { captured } : {}),
    gsdCm: GSD_CM,
    scope: "around-building",
    stalls: c.stalls,
    rooftopUnits: c.rooftopUnits,
    garageLikely: c.garageLikely,
    boxes: c.boxes,
    image: `aerial/${sid}.jpg`,
    model,
    source: aerialSource(model, c, runs),
    retrieved: new Date().toISOString().slice(0, 10),
    runs: runs.map((r) => ({ stalls: r.stalls, rooftopUnits: r.rooftopUnits })),
  };
  const dir = aerialWriteDir();
  fs.mkdirSync(dir, { recursive: true });
  if (img) fs.writeFileSync(path.join(dir, `${sid}.jpg`), img);
  fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify(out, null, 2));
  return out;
}

/** timeoutMs: per vision call (default 120 s); the live route uses less so a slow model hands over to the next. */
export type CountOpts = { model?: string; fetchFn?: typeof fetch; geminiKey?: string; backoffMs?: number; timeoutMs?: number };

function keyFor(opts: CountOpts): string {
  const key = (opts.geminiKey ?? process.env.GEMINI_API_KEY)?.trim();
  if (!key) throw new Error("aerial: GEMINI_API_KEY is not set");
  return key;
}

/**
 * Fetches the Vexcel ortho for a space, counts surface stalls and rooftop units with a vision model (two runs, a third to
 * break a tie), and writes aerial/<sid>.{jpg,json}. Returns null if there's no image (no key or no coverage). Throws if the
 * model fails, so a transient error is never cached as "couldn't count".
 */
export async function countAerial(sid: string, lat: number, lon: number, opts: CountOpts = {}): Promise<AerialCount | null> {
  if (!SAFE_SID.test(sid)) throw new Error(`aerial: bad sid ${sid}`);
  const key = keyFor(opts);
  const fetchFn = opts.fetchFn ?? fetch;
  const img = await vexcelImage(lat, lon, "ortho", fetchFn, { retries: 4, backoffMs: opts.backoffMs });
  if (!img) return null;
  const { runs, model } = await countRuns(img, visionModels(opts.model), { key, fetchFn, backoffMs: opts.backoffMs, timeoutMs: opts.timeoutMs });
  return writeCount(sid, img, runs, model);
}

/**
 * The runs behind a saved count, from its `runs` field or, for older files, its source text. A count two runs agreed on
 * was stored as their mean, so both rebuilt runs carry that mean. null when they can't be recovered (e.g. the image
 * wasn't usable), in which case a recount starts fresh.
 */
export function savedRuns(a: AerialCount): AerialRun[] | null {
  const num = (s: string) => (s === "none" ? null : Number(s));
  let st: (number | null)[] | null = null, ru: (number | null)[] | null = null;
  if (a.runs?.length) {
    st = a.runs.map((r) => r.stalls);
    ru = a.runs.map((r) => r.rooftopUnits);
  } else {
    if (/wasn't clear enough/.test(a.source)) return null;
    const sAgree = a.source.match(/2 runs agreed on (\d+) surface stalls/);
    const sDis = a.source.match(/2 runs disagreed on stalls serving the building \((\w+) vs (\w+)\)/);
    const uDis = a.source.match(/rooftop units unclear \((\w+) vs (\w+)\)/);
    const uAgree = a.source.match(/; (\d+) rooftop units/);
    st = sAgree ? [Number(sAgree[1]), Number(sAgree[1])] : sDis ? [num(sDis[1]), num(sDis[2])] : null;
    ru = uDis ? [num(uDis[1]), num(uDis[2])] : uAgree ? [Number(uAgree[1]), Number(uAgree[1])] : null;
  }
  const bad = (v: number | null) => v !== null && !Number.isFinite(v);
  if (!st || !ru || st.length !== ru.length || st.some(bad) || ru.some(bad)) return null;
  const whole = Number(a.source.match(/about (\d+) stalls in the whole image/)?.[1] ?? NaN);
  const agreed = a.stalls.n !== null && a.stalls.confidence >= 0.5;
  return st.map((s, i) => ({
    usable: true,
    stalls: s,
    lo: agreed && s === a.stalls.n ? a.stalls.lo : s,
    hi: agreed && s === a.stalls.n ? a.stalls.hi : s,
    accessible: agreed ? a.stalls.accessible ?? null : null,
    wholeImage: Number.isFinite(whole) ? whole : null,
    rooftopUnits: ru![i],
    garage: a.garageLikely,
    boxes: i === 0 ? a.boxes : [],
    watermark: a.captured ?? null,
    notes: "saved run",
  }));
}

/** A saved count a third run could still settle: stalls or rooftop units unclear, and no third run yet. */
export const isUnclear = (a: AerialCount) =>
  (a.stalls.n === null || a.stalls.confidence < 0.5 || a.rooftopUnits.n === null || a.rooftopUnits.confidence < 0.5) && (a.runs?.length ?? 0) < 3;

/**
 * Re-counts a saved unclear count on its saved photo under the tie-break rule: the two saved runs plus a third, or a fresh
 * two-or-three-run count when the saved runs can't be recovered. Returns the saved count unchanged when there's nothing to
 * settle, and null when there's no saved count or photo.
 */
export async function recountAerial(sid: string, opts: CountOpts = {}): Promise<AerialCount | null> {
  const saved = loadAerialCount(sid);
  const jpg = saved ? [aerialWriteDir(), path.join(dataDir(), "aerial")].map((d) => path.join(d, `${sid}.jpg`)).find((f) => fs.existsSync(f)) : undefined;
  if (!saved || !jpg) return null;
  if (!isUnclear(saved)) return saved;
  const prior = savedRuns(saved);
  if (prior && !needsTiebreak(prior)) return saved;
  const { runs, model } = await countRuns(fs.readFileSync(jpg), visionModels(opts.model), { key: keyFor(opts), fetchFn: opts.fetchFn ?? fetch, backoffMs: opts.backoffMs, timeoutMs: opts.timeoutMs }, prior ?? []);
  const used = prior && saved.model !== model ? `${saved.model} + ${model}` : model;
  return writeCount(sid, null, runs, used, saved);
}
