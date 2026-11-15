import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aerialSource, combineRuns, countAerial, loadAerialCount, needsTiebreak, parseAerialRun, quotaExhausted, recountAerial, resetExhaustedModels,
  retryHintMs, savedRuns, stallsAgree, unitsAgree, type AerialRun,
} from "./count";
import type { AerialCount } from "../types";

const run = (o: Partial<AerialRun> = {}): AerialRun => ({
  usable: true, stalls: 30, lo: 28, hi: 33, accessible: 2, wholeImage: 50, rooftopUnits: 7, garage: false,
  boxes: [{ label: "rooftop_unit", box: [100, 100, 150, 150] }], watermark: "2026-01", notes: "", ...o,
});

const reply = (o: Record<string, unknown>) => JSON.stringify({
  image_usable: true, boxes: [{ label: "rooftop_unit", box_2d: [490, 630, 550, 670] }, { label: "parking_area", box_2d: [360, 0, 980, 410] }],
  center_rows: [{ where: "west lot", stalls: 20 }, { where: "east lot", stalls: 9 }], stalls_center: 29, stalls_center_low: 27, stalls_center_high: 32,
  accessible_stalls_center: 2, stalls_whole_image: 50, rooftop_units: 7, garage_visible: false, watermark_date: "01/2026", notes: "clear", ...o,
});

describe("agreement rule", () => {
  it("agrees within 20% of the mean or 3 stalls, never on null", () => {
    expect(stallsAgree(76, 78)).toBe(true);
    expect(stallsAgree(5, 8)).toBe(true); // 3 stalls
    expect(stallsAgree(5, 9)).toBe(false);
    expect(stallsAgree(100, 120)).toBe(true); // 20 <= 22
    expect(stallsAgree(28, 35)).toBe(false); // 7 > 6.3
    expect(stallsAgree(null, 30)).toBe(false);
    expect(stallsAgree(null, null)).toBe(false);
    expect(unitsAgree(6, 7)).toBe(true);
    expect(unitsAgree(5, 7)).toBe(false);
    expect(unitsAgree(0, 0)).toBe(true);
    expect(unitsAgree(null, 0)).toBe(false);
  });

  it("combines agreeing runs: rounded mean, widest range, high confidence, first run's boxes", () => {
    const c = combineRuns(run({ stalls: 76, lo: 65, hi: 85 }), run({ stalls: 78, lo: 70, hi: 90, rooftopUnits: 8, boxes: [] }));
    expect(c.stalls).toEqual({ n: 77, lo: 65, hi: 90, accessible: 2, confidence: 0.8 });
    expect(c.rooftopUnits).toEqual({ n: 8, confidence: 0.8 }); // mean of 7 and 8 rounds up
    expect(c.boxes).toHaveLength(1);
  });

  it("says 'couldn't count' (null, low confidence) when runs disagree or one is null", () => {
    const c = combineRuns(run({ stalls: 28, rooftopUnits: 4 }), run({ stalls: 35, rooftopUnits: 7 }));
    expect(c.stalls).toEqual({ n: null, lo: null, hi: null, accessible: null, confidence: 0.2 });
    expect(c.rooftopUnits).toEqual({ n: null, confidence: 0.2 });
    expect(combineRuns(run({ stalls: null }), run()).stalls.n).toBeNull();
    expect(combineRuns(run({ rooftopUnits: null }), run()).rooftopUnits.n).toBeNull();
  });

  it("an unusable image never yields a count", () => {
    const c = combineRuns(run({ usable: false }), run());
    expect(c.stalls.n).toBeNull();
    expect(c.rooftopUnits.n).toBeNull();
    expect(c.garageLikely).toBe(false);
  });
});

describe("parseAerialRun", () => {
  it("normalizes counts, boxes and the watermark month", () => {
    const r = parseAerialRun(reply({}));
    expect(r).toMatchObject({ usable: true, stalls: 29, lo: 27, hi: 32, accessible: 2, wholeImage: 50, rooftopUnits: 7, garage: false, watermark: "2026-01" });
    expect(r.boxes).toEqual([{ label: "rooftop_unit", box: [490, 630, 550, 670] }, { label: "parking_area", box: [360, 0, 980, 410] }]);
  });

  it("drops bad boxes, negative counts and odd watermarks; widens the range to include the count", () => {
    const r = parseAerialRun("```json\n" + reply({
      boxes: [{ label: "tree", box_2d: [1, 2, 3, 4] }, { label: "rooftop_unit", box_2d: [5, 5, 1, 1] }, { label: "rooftop_unit", box_2d: [1, 2, 3] }, { label: "parking_area", box_2d: [-5, 0, 1200, 500] }],
      stalls_center_low: 40, stalls_center_high: null, rooftop_units: -1, accessible_stalls_center: null, watermark_date: "2026",
    }) + "\n```");
    expect(r.boxes).toEqual([{ label: "parking_area", box: [0, 0, 1000, 500] }]);
    expect(r).toMatchObject({ stalls: 29, lo: 29, hi: 29, rooftopUnits: null, accessible: null, watermark: null });
  });

  it("nulls every count when the image isn't usable, and rejects non-objects", () => {
    expect(parseAerialRun(reply({ image_usable: false }))).toMatchObject({ usable: false, stalls: null, rooftopUnits: null, boxes: [] });
    expect(() => parseAerialRun("[1,2]")).toThrow();
    expect(() => parseAerialRun("not json")).toThrow();
  });
});

describe("countAerial and loadAerialCount", () => {
  let dir: string;
  beforeEach(() => {
    resetExhaustedModels();
    delete process.env.GEMINI_VISION_MODEL;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "aerial-"));
    process.env.HERMIT_DATA_DIR = dir;
    process.env.VEXCELAPIKEY = "vk";
  });

  function fakeFetch(replies: Response[]) {
    const urls: string[] = [];
    const fn = (async (url: string) => {
      urls.push(url);
      if (url.includes("vexcelgroup")) return new Response(Buffer.from([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg" } });
      return replies.shift() ?? new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    return { fn, urls };
  }
  const gem = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hmm", thought: true }, { text }] } }] }), { headers: { "Content-Type": "application/json" } });

  it("fetches the ortho, retries a 429, writes jpg + json and loads it back", async () => {
    const f = fakeFetch([new Response("{}", { status: 429 }), gem(reply({ stalls_center: 76 })), gem(reply({ stalls_center: 78 }))]);
    const c = await countAerial("abc123", 29.9, -95.5, { fetchFn: f.fn, geminiKey: "gk", model: "m1", backoffMs: 1 });
    expect(c).toMatchObject({ sid: "abc123", provider: "vexcel", scope: "around-building", captured: "2026-01", image: "aerial/abc123.jpg", model: "m1", garageLikely: false });
    expect(c!.stalls).toMatchObject({ n: 77, confidence: 0.8 });
    expect(c!.source).toContain("Gemini (m1)");
    expect(c!.source).toContain("2 runs agreed on 77");
    expect(f.urls.filter((u) => u.includes("models/m1:generateContent"))).toHaveLength(3);
    expect(fs.existsSync(path.join(dir, "aerial", "abc123.jpg"))).toBe(true);
    expect(loadAerialCount("abc123")).toEqual(c);
  });

  it("records disagreement as unclear when a third run agrees with neither", async () => {
    const f = fakeFetch([gem(reply({ stalls_center: 20 })), gem(reply({ stalls_center: 40 })), gem(reply({ stalls_center: 60 }))]);
    const c = await countAerial("abc124", 29.9, -95.5, { fetchFn: f.fn, geminiKey: "gk", model: "m1", backoffMs: 1 });
    expect(c!.stalls).toEqual({ n: null, lo: null, hi: null, accessible: null, confidence: 0.2 });
    expect(c!.source).toContain("3 counts disagreed on stalls serving the building (20, 40 and 60)");
    expect(c!.runs).toEqual([{ stalls: 20, rooftopUnits: 7 }, { stalls: 40, rooftopUnits: 7 }, { stalls: 60, rooftopUnits: 7 }]);
  });

  it("breaks a tie with a third run: 2 of 3 agreed, confidence 0.65, all runs kept for audit", async () => {
    const f = fakeFetch([gem(reply({ stalls_center: 20, rooftop_units: 2 })), gem(reply({ stalls_center: 40, rooftop_units: 6 })), gem(reply({ stalls_center: 38, rooftop_units: 5 }))]);
    const c = await countAerial("abc125", 29.9, -95.5, { fetchFn: f.fn, geminiKey: "gk", model: "m1", backoffMs: 1 });
    expect(c!.stalls).toMatchObject({ n: 39, confidence: 0.65 });
    expect(c!.rooftopUnits).toEqual({ n: 6, confidence: 0.65 }); // 6 and 5 agree within 1; mean 5.5 rounds up
    expect(c!.source).toContain("2 of 3 counts agreed on 39 surface stalls");
    expect(c!.runs).toHaveLength(3);
    expect(f.urls.filter((u) => u.includes("generateContent"))).toHaveLength(3);
  });

  it("skips the third run when the first two agree", async () => {
    const f = fakeFetch([gem(reply({})), gem(reply({ stalls_center: 30 }))]);
    const c = await countAerial("abc126", 29.9, -95.5, { fetchFn: f.fn, geminiKey: "gk", model: "m1", backoffMs: 1 });
    expect(c!.runs).toHaveLength(2);
    expect(c!.stalls.confidence).toBe(0.8);
  });

  it("loadAerialCount returns null for missing, bad or unsafe ids", () => {
    fs.mkdirSync(path.join(dir, "aerial"), { recursive: true });
    fs.writeFileSync(path.join(dir, "aerial", "broken.json"), "{");
    expect(loadAerialCount("nope")).toBeNull();
    expect(loadAerialCount("broken")).toBeNull();
    expect(loadAerialCount("../x")).toBeNull();
    expect(loadAerialCount(undefined)).toBeNull();
  });
});

describe("tie-break rule", () => {
  it("uses the mean of the pair the third run agrees with, at confidence 0.65", () => {
    const c = combineRuns(run({ stalls: 20, lo: 18, hi: 22 }), run({ stalls: 40, lo: 35, hi: 45 }), run({ stalls: 38, lo: 30, hi: 41 }));
    expect(c.stalls).toEqual({ n: 39, lo: 30, hi: 45, accessible: 2, confidence: 0.65 });
    expect(c.rooftopUnits).toEqual({ n: 7, confidence: 0.8 }); // the first two agreed on units
  });

  it("picks the closer pair when the third run agrees with both", () => {
    expect(combineRuns(run({ stalls: 10 }), run({ stalls: 14 }), run({ stalls: 13 })).stalls.n).toBe(14); // 14 & 13 (gap 1) over 10 & 13
  });

  it("stays 'couldn't count' when all three disagree; rooftop units tie-break within 1", () => {
    const runs = [run({ stalls: 10, rooftopUnits: 1 }), run({ stalls: 30, rooftopUnits: 5 }), run({ stalls: 60, rooftopUnits: 2 })];
    const c = combineRuns(...runs);
    expect(c.stalls).toEqual({ n: null, lo: null, hi: null, accessible: null, confidence: 0.2 });
    expect(c.rooftopUnits).toEqual({ n: 2, confidence: 0.65 }); // 1 and 2
    const src = aerialSource("m", c, runs);
    expect(src).toContain("3 counts disagreed on stalls serving the building (10, 30 and 60)");
    expect(src).toContain("2 rooftop units (2 of 3 counts agreed)");
  });

  it("an unusable run can be outvoted by two usable runs that agree", () => {
    const runs = [run({ usable: false, stalls: null }), run({ stalls: 30 }), run({ stalls: 32 })];
    expect(combineRuns(...runs).stalls).toMatchObject({ n: 31, confidence: 0.65 });
    expect(aerialSource("m", combineRuns(...runs), runs)).toContain("2 of 3 counts agreed on 31");
    const bad = [run({ usable: false }), run(), run({ usable: false })];
    expect(aerialSource("m", combineRuns(...bad), bad)).toContain("wasn't clear enough");
  });

  it("asks for a third run only when two runs leave something unsettled", () => {
    expect(needsTiebreak([run(), run()])).toBe(false);
    expect(needsTiebreak([run(), run({ stalls: 60 })])).toBe(true);
    expect(needsTiebreak([run(), run({ rooftopUnits: 2 })])).toBe(true);
    expect(needsTiebreak([run({ usable: false }), run()])).toBe(true);
    expect(needsTiebreak([run({ usable: false }), run({ usable: false })])).toBe(false);
    expect(needsTiebreak([run(), run({ stalls: 60 }), run()])).toBe(false); // already has three
  });
});

describe("Gemini retry hints and quota", () => {
  it("reads Retry-After and RetryInfo", () => {
    expect(retryHintMs(new Response("{}", { headers: { "Retry-After": "7" } }), {})).toBe(7000);
    expect(retryHintMs(new Response("{}"), { error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "12.5s" }] } })).toBe(12500);
    expect(retryHintMs(new Response("{}"), {})).toBeNull();
  });

  it("tells a used-up daily quota from a per-minute rate limit", () => {
    const q = (quotaId: string) => ({ error: { code: 429, message: "You exceeded your current quota", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] }] } });
    expect(quotaExhausted(q("GenerateRequestsPerDayPerProjectPerModel-FreeTier"))).toBe(true);
    expect(quotaExhausted(q("GenerateRequestsPerMinutePerProjectPerModel"))).toBe(false);
    expect(quotaExhausted({ error: { message: "Your prepayment credits are depleted." } })).toBe(true);
    expect(quotaExhausted({})).toBe(false);
  });
});

describe("model chain and recount", () => {
  let dir: string;
  beforeEach(() => {
    resetExhaustedModels();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "aerial-"));
    process.env.HERMIT_DATA_DIR = dir;
    process.env.VEXCELAPIKEY = "vk";
    process.env.GEMINI_VISION_MODEL = "m1,m2";
  });
  afterEach(() => { delete process.env.GEMINI_VISION_MODEL; });
  const gem = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { headers: { "Content-Type": "application/json" } });
  const perDay = () => new Response(JSON.stringify({ error: { code: 429, message: "quota", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }] } }), { status: 429 });
  const perMinute = () => new Response(JSON.stringify({ error: { code: 429, message: "quota", details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }] }, { retryDelay: "0.001s" }] } }), { status: 429 });
  function byModel(table: Record<string, Response[]>) {
    const calls: string[] = [];
    const fn = (async (url: string) => {
      if (url.includes("vexcelgroup")) return new Response(Buffer.from([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg" } });
      const m = url.match(/models\/([^:]+):/)![1];
      calls.push(m);
      return table[m]?.shift() ?? new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    return { fn, calls };
  }

  it("moves to the next model when a model's daily quota is gone, and records the model used", async () => {
    const f = byModel({ m1: [perDay(), perDay()], m2: [gem(reply({})), gem(reply({ stalls_center: 30 }))] });
    const c = await countAerial("chain1", 29.9, -95.5, { fetchFn: f.fn, geminiKey: "gk", backoffMs: 1 });
    expect(c!.model).toBe("m2");
    expect(c!.stalls.n).toBe(30);
    // Later counts in the same process skip the exhausted model.
    const g = byModel({ m2: [gem(reply({})), gem(reply({}))] });
    await countAerial("chain2", 29.9, -95.5, { fetchFn: g.fn, geminiKey: "gk", backoffMs: 1 });
    expect(g.calls).toEqual(["m2", "m2"]);
  });

  it("hands over to the next model when one times out (overloaded)", async () => {
    const calls: string[] = [];
    const fn = (async (url: string) => {
      if (url.includes("vexcelgroup")) return new Response(Buffer.from([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg" } });
      const m = url.match(/models\/([^:]+):/)![1];
      calls.push(m);
      if (m === "m1") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      return gem(reply({}));
    }) as unknown as typeof fetch;
    const c = await countAerial("slow1", 29.9, -95.5, { fetchFn: fn, geminiKey: "gk", backoffMs: 1, timeoutMs: 10 });
    expect(c!.model).toBe("m2");
    expect(calls.filter((m) => m === "m1").length).toBeLessThanOrEqual(2); // no retries on the slow model
  });

  it("backs off and stays on the same model for a per-minute 429", async () => {
    const f = byModel({ m1: [perMinute(), gem(reply({})), gem(reply({}))] });
    const c = await countAerial("chain3", 29.9, -95.5, { fetchFn: f.fn, geminiKey: "gk", backoffMs: 1 });
    expect(c!.model).toBe("m1");
    expect(f.calls).toEqual(["m1", "m1", "m1"]);
  });

  it("redoes runs on the working model when the quota ran out midway, so one count isn't a mix", async () => {
    // Run A succeeds on m1, run B hits m1's daily limit and moves to m2; A is then redone on m2.
    const f = byModel({ m1: [gem(reply({ stalls_center: 5 })), perDay()], m2: [gem(reply({})), gem(reply({ stalls_center: 31 }))] });
    const c = await countAerial("chain4", 29.9, -95.5, { fetchFn: f.fn, geminiKey: "gk", backoffMs: 1 });
    expect(c!.model).toBe("m2");
    expect(c!.stalls).toMatchObject({ n: 30, confidence: 0.8 });
  });

  const oldFile = (o: Partial<AerialCount> = {}): AerialCount => ({
    sid: "old1", provider: "vexcel", captured: "2026-01", gsdCm: 10, scope: "around-building",
    stalls: { n: null, lo: null, hi: null, accessible: null, confidence: 0.2 }, rooftopUnits: { n: 4, confidence: 0.8 }, garageLikely: false,
    boxes: [{ label: "parking_area", box: [0, 0, 500, 500] }], image: "aerial/old1.jpg", model: "m0",
    source: "Vexcel ortho (80 m around the building), counted by Gemini (m0); 2 runs disagreed on stalls serving the building (11 vs 5); 4 rooftop units", retrieved: "2026-11-14", ...o,
  });
  function save(a: AerialCount) {
    fs.mkdirSync(path.join(dir, "aerial"), { recursive: true });
    fs.writeFileSync(path.join(dir, "aerial", `${a.sid}.json`), JSON.stringify(a));
    fs.writeFileSync(path.join(dir, "aerial", `${a.sid}.jpg`), Buffer.from([0xff, 0xd8, 0xff]));
  }

  it("rebuilds the two saved runs from an older file's source text", () => {
    expect(savedRuns(oldFile())!.map((r) => [r.stalls, r.rooftopUnits])).toEqual([[11, 4], [5, 4]]);
    const mixed = oldFile({ source: "x; 2 runs disagreed on stalls serving the building (none vs 5); rooftop units unclear (3 vs none)" });
    expect(savedRuns(mixed)!.map((r) => [r.stalls, r.rooftopUnits])).toEqual([[null, 3], [5, null]]);
    expect(savedRuns(oldFile({ source: "x; the image wasn't clear enough to count" }))).toBeNull();
  });

  it("recounts an unclear saved count with one third run on the saved photo", async () => {
    save(oldFile());
    const f = byModel({ m1: [gem(reply({ stalls_center: 10, rooftop_units: 4 }))] });
    const c = await recountAerial("old1", { fetchFn: f.fn, geminiKey: "gk", backoffMs: 1 });
    expect(f.calls).toEqual(["m1"]);
    expect(c!.stalls).toMatchObject({ n: 11, confidence: 0.65 }); // 11 & 10 agree; mean 10.5 rounds up
    expect(c!.rooftopUnits).toEqual({ n: 4, confidence: 0.8 });
    expect(c!.runs).toEqual([{ stalls: 11, rooftopUnits: 4 }, { stalls: 5, rooftopUnits: 4 }, { stalls: 10, rooftopUnits: 4 }]);
    expect(c!.model).toBe("m0 + m1");
    expect(c!.retrieved).toBe(new Date().toISOString().slice(0, 10));
    expect(loadAerialCount("old1")).toEqual(c);
    // Already tie-broken: nothing more to do, no model call.
    const none = byModel({});
    expect(await recountAerial("old1", { fetchFn: none.fn, geminiKey: "gk", backoffMs: 1 })).toEqual(c);
    expect(none.calls).toEqual([]);
  });

  it("recounts an unreadable older count from scratch, and loads record-only ids", async () => {
    save(oldFile({ sid: "prop-42", source: "x; the image wasn't clear enough to count", rooftopUnits: { n: null, confidence: 0.2 } }));
    const f = byModel({ m1: [gem(reply({})), gem(reply({}))] });
    const c = await recountAerial("prop-42", { fetchFn: f.fn, geminiKey: "gk", backoffMs: 1 });
    expect(c!.stalls).toMatchObject({ n: 29, confidence: 0.8 });
    expect(c!.model).toBe("m1");
    expect(loadAerialCount("prop-42")!.runs).toHaveLength(2);
  });
});
