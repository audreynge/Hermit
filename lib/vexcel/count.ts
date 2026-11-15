import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths";
import type { AerialCount } from "../types";
import { vexcelImage } from "./client";

// Reads a precomputed aerial count (written by pipeline/aerial.ts). Returns null when the space wasn't counted:
// callers must treat null as "not counted", never as zero.
export function loadAerialCount(sid: string | undefined): AerialCount | null {
  if (!sid || !/^[A-Za-z0-9]+$/.test(sid)) return null;
  const file = path.join(dataDir(), "aerial", `${sid}.json`);
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as AerialCount) : null;
  } catch {
    return null;
  }
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

const mean = (a: number, b: number) => Math.round((a + b) / 2);
const minN = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
const maxN = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/** Combines two runs by the agreement rule. Disagreement means "couldn't count": null with low confidence, never a guess. */
export function combineRuns(a: AerialRun, b: AerialRun): Pick<AerialCount, "stalls" | "rooftopUnits" | "garageLikely" | "boxes"> & { wholeImage: number | null } {
  const usable = a.usable && b.usable;
  const sOk = usable && stallsAgree(a.stalls, b.stalls);
  const uOk = usable && unitsAgree(a.rooftopUnits, b.rooftopUnits);
  return {
    stalls: sOk
      ? {
          n: mean(a.stalls!, b.stalls!),
          lo: minN(a.lo, b.lo),
          hi: maxN(a.hi, b.hi),
          accessible: a.accessible !== null && b.accessible !== null && Math.abs(a.accessible - b.accessible) <= 1 ? mean(a.accessible, b.accessible) : null,
          confidence: 0.8,
        }
      : { n: null, lo: null, hi: null, accessible: null, confidence: 0.2 },
    rooftopUnits: uOk ? { n: mean(a.rooftopUnits!, b.rooftopUnits!), confidence: 0.8 } : { n: null, confidence: 0.2 },
    garageLikely: usable && (a.garage || b.garage),
    boxes: a.boxes,
    wholeImage: usable && stallsAgree(a.wholeImage, b.wholeImage) ? mean(a.wholeImage!, b.wholeImage!) : null,
  };
}

/** Plain-language citation for the count. */
export function aerialSource(model: string, c: ReturnType<typeof combineRuns>, runs: [AerialRun, AerialRun]): string {
  const base = `Vexcel ortho (80 m around the building), counted by Gemini (${model})`;
  if (!runs[0].usable || !runs[1].usable) return `${base}; the image wasn't clear enough to count`;
  const parts: string[] = [];
  parts.push(c.stalls.n !== null ? `2 runs agreed on ${c.stalls.n} surface stalls in lots serving the building` : `2 runs disagreed on stalls serving the building (${runs[0].stalls ?? "none"} vs ${runs[1].stalls ?? "none"})`);
  parts.push(c.rooftopUnits.n !== null ? `${c.rooftopUnits.n} rooftop units` : `rooftop units unclear (${runs[0].rooftopUnits ?? "none"} vs ${runs[1].rooftopUnits ?? "none"})`);
  if (c.wholeImage !== null) parts.push(`about ${c.wholeImage} stalls in the whole image, including neighbors`);
  return `${base}; ${parts.join("; ")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One Gemini vision call with retries on 429/5xx/network errors. Returns the model's text. */
export async function geminiVision(image: Buffer, model: string, key: string, fetchFn: typeof fetch = fetch, tries = 5, backoffMs = 2000): Promise<string> {
  const body = {
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: image.toString("base64") } }, { text: AERIAL_PROMPT }] }],
    // Low thinking: on the hero ortho it ran ~6 s per call with steadier counts than the default (60-140 s, wider spread).
    generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: AERIAL_SCHEMA, thinkingConfig: { thinkingLevel: process.env.GEMINI_VISION_THINKING?.trim() || "low" } },
  };
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(backoffMs * 2 ** (i - 1) * (0.75 + Math.random() / 2));
    try {
      const res = await fetchFn(`${GEMINI}/models/${model}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 429 || res.status >= 500) { last = new Error(`Gemini ${model} ${res.status}`); continue; }
      if (!res.ok) throw Object.assign(new Error(`Gemini ${model} ${res.status}: ${String(j.error?.message ?? "").slice(0, 200)}`), { fatal: true });
      const parts: { text?: string; thought?: boolean }[] = j.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      if (!text) { last = new Error(`Gemini ${model} returned no text (${j.candidates?.[0]?.finishReason ?? "unknown"})`); continue; }
      return text;
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal) throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export type CountOpts = { model?: string; fetchFn?: typeof fetch; geminiKey?: string; backoffMs?: number };

/**
 * Fetches the Vexcel ortho for a space, counts surface stalls and rooftop units twice with a vision model, and writes
 * data/processed/aerial/<sid>.{jpg,json}. Returns null if there's no image (no key or no coverage). Throws if the model fails,
 * so a transient error is never cached as "couldn't count".
 */
export async function countAerial(sid: string, lat: number, lon: number, opts: CountOpts = {}): Promise<AerialCount | null> {
  if (!/^[A-Za-z0-9]+$/.test(sid)) throw new Error(`aerial: bad sid ${sid}`);
  const key = (opts.geminiKey ?? process.env.GEMINI_API_KEY)?.trim();
  if (!key) throw new Error("aerial: GEMINI_API_KEY is not set");
  const model = opts.model ?? process.env.GEMINI_VISION_MODEL?.trim() ?? DEFAULT_VISION_MODEL;
  const fetchFn = opts.fetchFn ?? fetch;
  const img = await vexcelImage(lat, lon, "ortho", fetchFn, { retries: 4, backoffMs: opts.backoffMs });
  if (!img) return null;
  const dir = path.join(dataDir(), "aerial");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sid}.jpg`), img);
  const runs = (await Promise.all([0, 1].map(() => geminiVision(img, model, key, fetchFn, 5, opts.backoffMs)))).map(parseAerialRun) as [AerialRun, AerialRun];
  const c = combineRuns(runs[0], runs[1]);
  const out: AerialCount = {
    sid,
    provider: "vexcel",
    ...(runs[0].watermark && runs[0].watermark === runs[1].watermark ? { captured: runs[0].watermark } : {}),
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
  };
  fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify(out, null, 2));
  return out;
}
