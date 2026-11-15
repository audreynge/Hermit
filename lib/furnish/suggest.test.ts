import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../db";
import type { GeminiClient } from "../llm/gemini";
import { starterItems } from "./catalog";
import { suggestItems } from "./suggest";

function fakeGemini(json: unknown) {
  let calls = 0;
  const g: GeminiClient = { model: "fake", generate: async () => { calls++; return { role: "model", parts: [{ text: JSON.stringify(json) }] }; } };
  return { g, calls: () => calls };
}

beforeEach(() => {
  process.env.HERMIT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hermit-s-")), "h.db");
  closeDb();
});

describe("suggestItems", () => {
  it("validates Gemini's list, clamps sizes and caches by (use, room)", async () => {
    const f = fakeGemini({ items: [{ name: "Commercial Range", terms: ["commercial range", "stove"], w: 1.5, d: 0.8, h: 0.9 }, { name: "Walk-in", terms: ["freezer"], w: 40, d: 3, h: 0 }] });
    const a = await suggestItems({ use: "Ramen shop", room: "kitchen" }, f.g);
    expect(a.source).toBe("gemini");
    expect(a.items[0]).toEqual({ name: "commercial range", terms: ["commercial range", "stove"], size: { w: 1.5, d: 0.8, h: 0.9 } });
    expect(a.items[1].size).toEqual({ w: 6, d: 3, h: 0.1 });
    const b = await suggestItems({ use: "ramen  SHOP", room: "Kitchen" }, f.g);
    expect(b.items).toEqual(a.items);
    expect(f.calls()).toBe(1);
  });

  it("falls back to starter items on bad output, errors, or no Gemini", async () => {
    expect(await suggestItems({ use: "salon", room: "kitchen" }, fakeGemini({ items: [{ name: "<b>", terms: [] }] }).g)).toEqual({ items: starterItems("kitchen"), source: "starter" });
    const broken: GeminiClient = { model: "x", generate: async () => { throw new Error("429 quota"); } };
    expect((await suggestItems({ use: "salon", room: "living" }, broken)).source).toBe("starter");
    expect((await suggestItems({ use: "salon", room: "bedroom" }, null)).source).toBe("starter");
  });

  it("starter items exist for every room label, including unknown ones", () => {
    for (const label of ["office", "bathroom", "kitchen", "hallway", "bedroom", "living", "storage", "utility", "open", "other", "garage", "dining", "anything"]) {
      expect(starterItems(label).length, label).toBeGreaterThan(0);
    }
  });
});
