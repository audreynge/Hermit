import { describe, expect, it } from "vitest";
import { parseFurnish } from "./offline";
import type { Placed } from "./ops";
import { PHRASES } from "./phrases.fixture";

const p = (id: string, name: string): Placed => ({ id, name, terms: [name], size: { w: 1, d: 1, h: 1 }, approxSize: false, pos: { x: 0, y: 0, z: 0 }, rotY: 0 });
const room = [p("f1", "stove"), p("f2", "sofa"), p("f3", "bar stool")];

describe("parseFurnish", () => {
  it.each(PHRASES)("%s", (text, selected, ops) => {
    expect(parseFurnish(text, room, selected)).toEqual({ ops });
  });

  it("asks instead of guessing when the target is unclear or nothing is placed", () => {
    expect(parseFurnish("delete it", room)).toHaveProperty("ask");
    expect(parseFurnish("rotate it", [])).toHaveProperty("ask");
    expect(parseFurnish("what's the weather", room)).toHaveProperty("ask");
  });

  it("puts a new item when the article is indefinite, even if one exists", () => {
    expect(parseFurnish("put a stove here", room)).toEqual({ ops: [{ op: "add", name: "stove", at: "point" }] });
    expect(parseFurnish("put the stove here", room)).toEqual({ ops: [{ op: "move", id: "f1", at: "point" }] });
  });
});

describe("toMeters", () => {
  it("converts inches, feet, feet-and-inches, cm and m", async () => {
    const { toMeters } = await import("./offline");
    expect(toMeters("30", "inches")).toBe(0.762);
    expect(toMeters("3", "ft", "6")).toBe(1.0668);
    expect(toMeters("3", "′", "6")).toBe(1.0668);
    expect(toMeters("75", "cm")).toBe(0.75);
    expect(toMeters("2", "m")).toBe(2);
  });

  it("whole-room furnishing: scope from the wording, a named room when given", () => {
    const op = (t: string) => (parseFurnish(t, room) as { ops: object[] }).ops?.[0];
    expect(op("furnish this place")).toEqual({ op: "furnish", scope: "all" });
    expect(op("furnish the whole apartment")).toEqual({ op: "furnish", scope: "all" });
    expect(op("furnish this room")).toEqual({ op: "furnish", scope: "room" });
    expect(op("set this up for me")).toEqual({ op: "furnish", scope: "room" });
    expect(op("fill the bedroom")).toEqual({ op: "furnish", scope: "room", room: "bedroom" });
    expect(op("set up the living room")).toEqual({ op: "furnish", scope: "room", room: "living" });
    expect(op("set up a desk here")).toEqual({ op: "add", name: "desk", at: "point" }); // still an add
    expect(op("remove the sofa")).toEqual({ op: "remove", id: "f2" });
  });
});

describe("parseFurnish: clear, undo, refurnish", () => {
  const ops = (t: string) => (parseFurnish(t, room, "f1") as { ops: object[] }).ops;
  it.each([
    ["clear the room", "room"], ["empty this room", "room"], ["delete all the furniture", "room"], ["remove all of it", "room"],
    ["remove everything", "all"], ["clear everything", "all"], ["clear the whole place", "all"], ["remove everything in this room", "room"],
  ])("%s → clear %s", (t, scope) => expect(ops(t)).toEqual([{ op: "clear", scope }]));

  it.each(["undo", "undo that", "take that back", "go back"])("%s → undo", (t) => expect(ops(t)).toEqual([{ op: "undo" }]));

  it("refurnish clears the target rooms, then furnishes them", () => {
    expect(ops("refurnish")).toEqual([{ op: "clear", scope: "room" }, { op: "furnish", scope: "room" }]);
    expect(ops("start over and furnish this place")).toEqual([{ op: "clear", scope: "all" }, { op: "furnish", scope: "all" }]);
    expect(ops("redo the layout")).toEqual([{ op: "clear", scope: "room" }, { op: "furnish", scope: "room" }]);
  });

  it("single-item edits are unchanged", () => {
    expect(ops("remove the sofa")).toEqual([{ op: "remove", id: "f2" }]);
    expect(ops("make it clear glass")).not.toEqual([{ op: "clear", scope: "room" }]);
  });
});
