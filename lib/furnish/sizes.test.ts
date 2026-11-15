import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../db";
import type { GeminiClient } from "../llm/gemini";
import { DEFAULT_SIZE } from "./catalog";
import { sizeFor } from "./sizes";

const fake = (json: unknown) => { let calls = 0; const g: GeminiClient = { model: "f", generate: async () => { calls++; return { role: "model", parts: [{ text: JSON.stringify(json) }] }; } }; return { g, calls: () => calls }; };
beforeEach(() => { process.env.HERMIT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hermit-z-")), "h.db"); closeDb(); });

describe("sizeFor", () => {
  it("uses the table first (trash can, wheelchair) without calling Gemini", async () => {
    const f = fake({ w: 9, d: 9, h: 9 });
    expect(await sizeFor("Trash Can", f.g)).toEqual({ size: { w: 0.4, d: 0.4, h: 0.65 }, source: "table" });
    expect((await sizeFor("wheelchair", f.g)).size).toEqual({ w: 0.65, d: 1.05, h: 0.9 });
    expect(f.calls()).toBe(0);
  });
  it("asks Gemini once per unknown name and caches it", async () => {
    const f = fake({ w: 0.6, d: 0.7, h: 0.9 });
    expect(await sizeFor("noodle cooker", f.g)).toEqual({ size: { w: 0.6, d: 0.7, h: 0.9 }, source: "gemini" });
    await sizeFor("Noodle Cookers", f.g);
    expect(f.calls()).toBe(1);
  });
  it("falls back to the default on bad output, errors or no Gemini", async () => {
    expect(await sizeFor("thingamajig", fake({ w: 50, d: 1, h: 1 }).g)).toEqual({ size: DEFAULT_SIZE, source: "default" });
    expect((await sizeFor("gizmo", { model: "x", generate: async () => { throw new Error("429"); } })).source).toBe("default");
    expect((await sizeFor("doohickey", null)).source).toBe("default");
  });
});
