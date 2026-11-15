import { describe, expect, it } from "vitest";
import { chatTurn } from "./claude";
import { openChat } from "./converse";
import { surveyToSpec } from "../spec/survey";
import { CLINIC } from "../design/fixtures";

const EMPTY = { useType: null, mode: null, city: null, sizeMinSqft: null, sizeMaxSqft: null, budgetMonthly: null, budgetTotal: null, headcount: null, beds: null, baths: null, rooms: [], needs: {} };

const state = openChat(surveyToSpec({ transaction: "lease", accessibility: false, requirements: [], city: "houston" })).state;
const results = { ...state, spec: { ...state.spec, useType: "medical clinic" }, phase: "results" as const };

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

  it("never passes the model's quick replies on", async () => {
    const t = await chatTurn(state, "a nail salon", fake({ reply: "How many stations?", ready: false, quickReplies: ["4", "6"], action: "none", update: { ...EMPTY, useType: "nail salon" } }));
    expect(t.quickReplies).toEqual([]);
  });

  it("passes the model's app actions and match target through", async () => {
    const t = await chatTurn(results, "could I peek at the one in third place", fake({ reply: "Opening it.", ready: false, action: "view", target: 3, update: EMPTY }));
    expect(t).toMatchObject({ action: "view", target: 3, ready: false });
    const bad = await chatTurn(results, "the 9th", fake({ reply: "Opening it.", ready: false, action: "view", target: 9, update: EMPTY }));
    expect(bad.target).toBeUndefined();
    const search = await chatTurn(results, "run it again", fake({ reply: "Searching.", ready: false, action: "search", target: 2, update: EMPTY }));
    expect(search).toMatchObject({ action: "search" });
    expect(search.target).toBeUndefined();
  });

  it("drops match actions before there are results", async () => {
    const t = await chatTurn(state, "keep that one for me", fake({ reply: "Saved.", ready: false, action: "save", update: EMPTY }));
    expect(t.action).toBeUndefined();
  });

  it("answers plain app commands without calling the model", async () => {
    const never = { messages: { parse: async () => { throw new Error("should not be called"); } } } as never;
    const t = await chatTurn(results, "save the second one", never);
    expect(t).toMatchObject({ action: "save", target: 2 });
    expect(t.fallback).toBeUndefined();
  });

  it("offline: edits the layout before any search (resize, move, add N, remove N, rename)", async () => {
    const gathering = { ...state, spec: { ...state.spec, useType: "medical clinic" } };
    const ctx = { layout: CLINIC };
    const big = await chatTurn(gathering, "make the storage bigger", null, { ctx });
    expect(big.edit).toEqual({ target: "layout", ops: [{ op: "resize", id: "t5", scale: 1.5 }] });
    expect((await chatTurn(gathering, "move reception to the back", null, { ctx })).edit?.ops).toEqual([{ op: "move", id: "t1", side: "back" }]);
    expect((await chatTurn(gathering, "2 more exam rooms", null, { ctx })).edit?.ops).toEqual([{ op: "add", label: "exam room", count: 2 }]);
    expect((await chatTurn(gathering, "Can you add another exam room?", null, { ctx })).edit?.ops).toEqual([{ op: "add", label: "exam room", count: 1 }]);
    expect((await chatTurn(gathering, "reset the layout", null, { ctx })).action).toBeUndefined();
    expect((await chatTurn(gathering, "remove one exam room", null, { ctx })).edit?.ops).toEqual([{ op: "remove", id: "t3" }]);
    expect((await chatTurn(gathering, "rename the storage to an office", null, { ctx })).edit?.ops).toEqual([{ op: "relabel", id: "t5", label: "office" }]);
    const which = await chatTurn(gathering, "move the exam room to the front", null, { ctx });
    expect(which.edit).toBeUndefined();
    expect(which.reply).toMatch(/Exam Room 1 or Exam Room 2\?/);
    expect(which.quickReplies).toEqual([]);
  });
});
