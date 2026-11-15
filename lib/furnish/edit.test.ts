import { describe, expect, it } from "vitest";
import type { GeminiClient } from "../llm/gemini";
import { furnishEdit } from "./edit";

const fake = (json: unknown): GeminiClient => ({ model: "fake", generate: async () => ({ role: "model", parts: [{ text: JSON.stringify(json) }] }) });
const items = [{ id: "f1", name: "stove" }, { id: "f2", name: "sofa" }];
const suggestions = [{ name: "noodle cooker", terms: ["noodle cooker", "boiler"], size: { w: 0.6, d: 0.7, h: 0.9 } }];

describe("furnishEdit", () => {
  it("turns Gemini's flat ops into typed ops, dropping nulls and folding w/d/h into size", async () => {
    const out = await furnishEdit({ text: "make the sofa navy and add a wok burner", items }, fake({
      reply: "Done.", ops: [{ op: "recolor", id: "f2", color: "navy", terms: [], material: null }, { op: "add", name: "wok burner", terms: ["wok burner", "stove"], at: "front", w: 0.9, d: 0.8, h: 0.8 }],
    }));
    expect(out.source).toBe("gemini");
    expect(out.ops).toEqual([{ op: "recolor", id: "f2", color: "navy" }, { op: "add", name: "wok burner", terms: ["wok burner", "stove"], at: "front", size: { w: 0.9, d: 0.8, h: 0.8 } }]);
  });

  it("converts a resize's value and unit in code", async () => {
    const out = await furnishEdit({ text: "make the sofa 3 ft 6 in wide", items }, fake({ reply: "Resized.", ops: [{ op: "resize", id: "f2", dim: "w", value: 42, unit: "in" }, { op: "resize", id: "f1", scale: 1.2 }] }));
    expect(out.ops).toEqual([{ op: "resize", id: "f2", w: 1.0668 }, { op: "resize", id: "f1", scale: 1.2 }]);
  });

  it("fills terms and size for an add that names a suggestion", async () => {
    const out = await furnishEdit({ text: "add a noodle cooker here", items, suggestions }, fake({ reply: "Added.", ops: [{ op: "add", name: "Noodle Cooker", at: "point" }] }));
    expect(out.ops[0]).toEqual({ op: "add", name: "Noodle Cooker", at: "point", terms: ["noodle cooker", "boiler"], size: { w: 0.6, d: 0.7, h: 0.9 } });
  });

  it("uses the offline parser without Gemini, and says so when Gemini fails", async () => {
    expect(await furnishEdit({ text: "add a noodle cooker here", items, suggestions }, null)).toEqual({
      ops: [{ op: "add", name: "noodle cooker", at: "point", terms: ["noodle cooker", "boiler"], size: { w: 0.6, d: 0.7, h: 0.9 } }], reply: "Done.", source: "offline",
    });
    const broken: GeminiClient = { model: "x", generate: async () => { throw new Error("429"); } };
    const out = await furnishEdit({ text: "remove the sofa", items }, broken);
    expect(out).toMatchObject({ ops: [{ op: "remove", id: "f2" }], source: "offline" });
    expect(out.reply).toMatch(/isn't available/);
  });

  it("passes Gemini's clarifying question through with no ops", async () => {
    const out = await furnishEdit({ text: "move the lamp", items }, fake({ reply: "There's no lamp yet. Want me to add one?", ops: [] }));
    expect(out).toEqual({ ops: [], reply: "There's no lamp yet. Want me to add one?", source: "gemini" });
  });

  it("passes a furnish request through for the layout planner", async () => {
    const out = await furnishEdit({ text: "furnish this place", items }, fake({ reply: "On it.", ops: [{ op: "furnish", scope: "all", room: null, terms: [] }] }));
    expect(out.ops).toEqual([{ op: "furnish", scope: "all" }]);
  });
});
