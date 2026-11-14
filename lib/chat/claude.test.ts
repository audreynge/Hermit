import { describe, expect, it } from "vitest";
import { chatTurn } from "./claude";
import { openChat } from "./converse";
import { surveyToSpec } from "../spec/survey";

const state = openChat(surveyToSpec({ transaction: "lease", accessibility: false, requirements: [], city: "houston" })).state;

const fake = (parsed: unknown) => ({ messages: { parse: async () => ({ parsed_output: parsed }) } }) as never;

describe("chatTurn", () => {
  it("applies Claude's spec update and reply, validated against the schema", async () => {
    const t = await chatTurn(state, "a nail salon, maybe 1200 sq ft", fake({
      reply: "Lovely! How many stations?", ready: false, quickReplies: ["4", "6"], action: "none",
      update: { useType: "nail salon", mode: "business", city: null, sizeMinSqft: 1000, sizeMaxSqft: 1400, budgetMonthly: null, budgetTotal: null, headcount: null, beds: null, baths: null, rooms: [], needs: { parking: null, wheelchair: null, chairWidthIn: null, groundFloor: null, heavyPower: null, esfr: null, driveInBays: null } },
    }));
    expect(t.reply).toBe("Lovely! How many stations?");
    expect(t.state.spec).toMatchObject({ useType: "nail salon", city: "houston", sizeSqft: [1000, 1400] });
    expect(t.ready).toBe(false);
  });

  it("treats a home search as having its use type even when the model leaves it blank", async () => {
    const t = await chatTurn({ ...state, spec: { ...state.spec, useType: "" } }, "buy a 3 bedroom house, I use a wheelchair", fake({
      reply: "How wide is the chair?", ready: false, quickReplies: [], action: "none",
      update: { useType: null, mode: "home", city: null, sizeMinSqft: null, sizeMaxSqft: null, budgetMonthly: null, budgetTotal: null, headcount: null, beds: 3, baths: null, rooms: [], needs: { parking: null, wheelchair: true, chairWidthIn: null, groundFloor: null, heavyPower: null, esfr: null, driveInBays: null } },
    }));
    expect(t.state.spec).toMatchObject({ mode: "home", useType: "home", beds: 3, needs: { wheelchair: true } });
  });

  it("refuses to start a search until a use type and city are known", async () => {
    const t = await chatTurn({ ...state, spec: { ...state.spec, city: undefined } }, "go", fake({
      reply: "Searching!", ready: true, quickReplies: [], action: "none",
      update: { useType: "office", mode: null, city: null, sizeMinSqft: null, sizeMaxSqft: null, budgetMonthly: null, budgetTotal: null, headcount: null, beds: null, baths: null, rooms: [], needs: { parking: null, wheelchair: null, chairWidthIn: null, groundFloor: null, heavyPower: null, esfr: null, driveInBays: null } },
    }));
    expect(t.ready).toBe(false);
    expect(t.reply).toMatch(/Houston or Los Angeles/);
  });

  it("keeps captured fields when Claude fails mid-conversation", async () => {
    let calls = 0;
    const flaky = { messages: { parse: async () => {
      if (calls++ === 0) return { parsed_output: { reply: "Which city?", ready: false, quickReplies: [], action: "none", update: { useType: "dental clinic", mode: "business", city: null, sizeMinSqft: null, sizeMaxSqft: null, budgetMonthly: null, budgetTotal: null, headcount: null, beds: null, baths: null, rooms: [], needs: { parking: null, wheelchair: null, groundFloor: null, heavyPower: null, esfr: null, driveInBays: null } } } };
      throw new Error("overloaded");
    } } } as never;
    const t1 = await chatTurn({ ...state, spec: { ...state.spec, city: undefined } }, "a dental clinic", flaky);
    const t2 = await chatTurn(t1.state, "Houston", flaky);
    expect(t2.state.spec).toMatchObject({ useType: "dental clinic", city: "houston" });
  });

  it("marks turns answered by the fallback when Claude was configured but failed", async () => {
    const broken = { messages: { parse: async () => { throw new Error("overloaded"); } } } as never;
    expect((await chatTurn(state, "a dental clinic", broken)).fallback).toBe("deterministic");
    expect((await chatTurn(state, "a dental clinic", null)).fallback).toBeUndefined();
  });

  it("falls back to the deterministic conversation when there is no client or Claude fails", async () => {
    const a = await chatTurn(state, "a dental clinic", null);
    expect(a.state.spec.useType).toMatch(/dental clinic/);
    const broken = { messages: { parse: async () => { throw new Error("boom"); } } } as never;
    const b = await chatTurn(state, "a dental clinic", broken);
    expect(b.state.spec.useType).toMatch(/dental clinic/);
  });
});
