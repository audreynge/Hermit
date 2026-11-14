import { describe, expect, it } from "vitest";
import { openChat } from "../chat/converse";
import { fromLayout, type Block } from "../spec/parse";
import { applyDesign, designToDraft, extractFloorPlan, layoutSummary, validateUpload, type FloorPlanExtraction } from "./extract";
import type { Draft } from "../spec/survey";

const base: Draft = { mode: "business", city: "houston", useType: "", rooms: [], needs: { parking: true }, priorities: {}, input: "chat" };
const plan: FloorPlanExtraction = {
  isFloorPlan: true, totalSqft: 1500, notes: "",
  rooms: [{ label: "exam room", count: 3, approxSqft: 110, fixtures: ["sink"] }, { label: "reception", count: 1, approxSqft: 250, fixtures: [] }],
};
const blocks: Block[] = [
  { id: "a", label: "exam room", x: 0, y: 0, w: 10, h: 12 },
  { id: "b", label: "exam room", x: 10, y: 0, w: 10, h: 12 },
  { id: "s", label: "sink", kind: "object", x: 2, y: 2, w: 2, h: 2 },
];

describe("designToDraft", () => {
  it("maps extracted rooms to requirements and keeps what the chat already knew", () => {
    const d = designToDraft(plan, base);
    expect(d.rooms).toEqual([
      { label: "exam room", count: 3, minSqft: 94, fixtures: ["sink"], hard: false },
      { label: "reception", count: 1, minSqft: 213, hard: false },
    ]);
    expect(d).toMatchObject({ city: "houston", needs: { parking: true }, useType: "medical clinic", sizeSqft: [1500, 2250] });
  });

  it("turns drawn blocks into the same rooms the layout page produced", () => {
    const d = designToDraft(blocks, base);
    expect(d.rooms).toEqual(fromLayout(blocks, { mode: "business", city: "houston", useType: "medical clinic" }).rooms);
    expect(d.input).toBe("layout");
  });
});

describe("applyDesign", () => {
  it("rejects a picture that is not a floor plan without changing the spec", () => {
    const s = openChat(base).state;
    const t = applyDesign(s, { ...plan, isFloorPlan: false });
    expect(t.state.spec).toEqual(s.spec);
    expect(t.ready).toBe(false);
    expect(t.reply).toMatch(/floor plan/i);
  });

  it("continues the conversation from the design", () => {
    const t = applyDesign(openChat({ ...base, city: undefined }).state, plan);
    expect(t.reply).toMatch(/Houston or Los Angeles/);
    expect(t.state.spec.rooms).toHaveLength(2);
  });
});

describe("validateUpload", () => {
  it("accepts plan images and PDFs up to 10 MB", () => {
    expect(validateUpload(2_000_000, "image/png")).toBeNull();
    expect(validateUpload(2_000_000, "application/pdf")).toBeNull();
    expect(validateUpload(11 * 1024 * 1024, "image/jpeg")).toMatchObject({ status: 413 });
    expect(validateUpload(1000, "image/gif")).toMatchObject({ status: 415 });
  });
});

describe("layoutSummary", () => {
  it("describes a drawn layout in plain words", () => {
    expect(layoutSummary(blocks)).toBe("Here's my layout: 2 exam rooms with sinks (about 240 sq ft). Find the closest match.");
  });
});

describe("extractFloorPlan", () => {
  it("sends the image to Claude and returns the parsed extraction", async () => {
    let seen: unknown;
    const client = { messages: { parse: async (req: unknown) => { seen = req; return { parsed_output: plan }; } } };
    const out = await extractFloorPlan({ mediaType: "image/png", base64: "AAAA" }, client as never);
    expect(out.rooms[0].label).toBe("exam room");
    expect(JSON.stringify(seen)).toContain('"type":"image"');
  });

  it("sends PDFs as documents", async () => {
    let seen: unknown;
    const client = { messages: { parse: async (req: unknown) => { seen = req; return { parsed_output: plan }; } } };
    await extractFloorPlan({ mediaType: "application/pdf", base64: "AAAA" }, client as never);
    expect(JSON.stringify(seen)).toContain('"type":"document"');
  });

  it("refuses without an API key", async () => {
    await expect(extractFloorPlan({ mediaType: "image/png", base64: "AAAA" }, null)).rejects.toThrow(/key/i);
  });
});
