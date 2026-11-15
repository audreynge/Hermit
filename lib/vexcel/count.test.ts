import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { combineRuns, countAerial, loadAerialCount, parseAerialRun, stallsAgree, unitsAgree, type AerialRun } from "./count";

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

  it("records disagreement as unclear", async () => {
    const f = fakeFetch([gem(reply({ stalls_center: 20 })), gem(reply({ stalls_center: 40 }))]);
    const c = await countAerial("abc124", 29.9, -95.5, { fetchFn: f.fn, geminiKey: "gk", model: "m1", backoffMs: 1 });
    expect(c!.stalls).toEqual({ n: null, lo: null, hi: null, accessible: null, confidence: 0.2 });
    expect(c!.source).toContain("disagreed");
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
