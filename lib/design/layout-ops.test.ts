import { describe, expect, it } from "vitest";
import { fromLayout, type Block } from "../spec/parse";
import { CLINIC, OFFICE, SALON } from "./fixtures";
import { applyLayoutOps, blockName, describeLayout, MAX_OPS } from "./layout-ops";

const rooms = (bs: Block[]) => bs.filter((b) => b.kind !== "object");
const overlap = (a: Block, b: Block) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const touch = (a: Block, b: Block) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const base = { mode: "business" as const, city: "houston" as const, useType: "medical clinic" };

describe("applyLayoutOps", () => {
  it("[L1] add next to a room touches it and overlaps no other room", () => {
    const r = applyLayoutOps(CLINIC, [{ op: "add", label: "exam room", nextTo: "t1" }]);
    const added = r.blocks.at(-1)!;
    expect(added.label).toBe("exam room");
    expect(touch(added, CLINIC[0])).toBe(true);
    for (const o of rooms(CLINIC)) expect(overlap(added, o)).toBe(false);
    expect(r.rejected).toEqual([]);
  });

  it("[L2] add next to a fully enclosed room goes to the nearest free spot with a note", () => {
    const box: Block[] = [
      { id: "c", kind: "room", label: "office", x: 10, y: 10, w: 10, h: 10 },
      { id: "n", kind: "room", label: "storage", x: 0, y: 0, w: 30, h: 10 }, { id: "s", kind: "room", label: "storage", x: 0, y: 20, w: 30, h: 10 },
      { id: "w", kind: "room", label: "storage", x: 0, y: 10, w: 10, h: 10 }, { id: "e", kind: "room", label: "storage", x: 20, y: 10, w: 10, h: 10 },
    ];
    const r = applyLayoutOps(box, [{ op: "add", label: "office", nextTo: "c" }]);
    const added = r.blocks.at(-1)!;
    for (const o of box) expect(overlap(added, o)).toBe(false);
    expect(r.notes.join(" ")).toMatch(/no free wall next to Office/);
  });

  it("[L3] add with an unknown room type is rejected, not invented", () => {
    const r = applyLayoutOps(CLINIC, [{ op: "add", label: "ball pit" }]);
    expect(r.blocks).toHaveLength(CLINIC.length);
    expect(r.rejected[0].reason).toMatch(/ball pit/);
  });

  it("[L4] remove deletes the room and the objects inside it", () => {
    const r = applyLayoutOps(CLINIC, [{ op: "remove", id: "t2" }]);
    expect(r.blocks.find((b) => b.id === "t2")).toBeUndefined();
    expect(r.blocks.find((b) => b.id === "o10")).toBeUndefined(); // sink inside t2
    expect(r.blocks.find((b) => b.id === "o13")).toBeDefined(); // sink inside t3 stays
  });

  it("[L5] removing the last room leaves an empty, valid layout", () => {
    const r = applyLayoutOps(SALON, ["s1", "s2", "s3"].map((id) => ({ op: "remove", id })));
    expect(rooms(r.blocks)).toEqual([]);
    expect(fromLayout(r.blocks, base).rooms).toEqual([]);
    expect(r.notes).toContain("The layout has no rooms now.");
    expect(describeLayout(r.blocks)).toBe("The layout is empty.");
  });

  it("[L6] sizes are clamped to 3..200 ft; scale must be positive", () => {
    const tiny = applyLayoutOps(CLINIC, [{ op: "resize", id: "t5", w: 1, h: 500 }]);
    const t5 = tiny.blocks.find((b) => b.id === "t5")!;
    expect([t5.w, t5.h]).toEqual([3, 200]);
    expect(tiny.notes.join(" ")).toMatch(/between 3 and 200/);
    for (const scale of [0, -2]) expect(applyLayoutOps(CLINIC, [{ op: "resize", id: "t5", scale }]).rejected).toHaveLength(1);
    const doubled = applyLayoutOps(CLINIC, [{ op: "resize", id: "t5", scale: 2 }]).blocks.find((b) => b.id === "t5")!;
    expect(doubled.w * doubled.h).toBeCloseTo(17 * 20 * 2, -1);
  });

  it("[L7] relabelling to hallway makes it circulation, not a requirement", () => {
    const r = applyLayoutOps(CLINIC, [{ op: "relabel", id: "t5", label: "corridor" }]);
    const spec = fromLayout(r.blocks, base);
    expect(spec.rooms.map((x) => x.label)).not.toContain("storage");
    expect(spec.rooms.some((x) => x.adjacentTo?.includes("hallway"))).toBe(false);
  });

  it("[L8] add_object needs a real room; a sink becomes a fixture requirement", () => {
    expect(applyLayoutOps(OFFICE, [{ op: "add_object", label: "sink", in: "zz" }]).rejected).toHaveLength(1);
    const r = applyLayoutOps(OFFICE, [{ op: "add_object", label: "sink", in: "a5" }]);
    expect(fromLayout(r.blocks, base).rooms.find((x) => x.label === "kitchen")?.fixtures).toEqual(["sink"]);
  });

  it("[L9] an unknown id is rejected by name while other ops still apply", () => {
    const r = applyLayoutOps(CLINIC, [{ op: "remove", id: "t99" }, { op: "add", label: "office" }]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toMatch(/t99/);
    expect(rooms(r.blocks)).toHaveLength(rooms(CLINIC).length + 1);
  });

  it("[L10] ops apply in order: remove then resize the same id rejects the resize", () => {
    const r = applyLayoutOps(CLINIC, [{ op: "remove", id: "t5" }, { op: "resize", id: "t5", scale: 2 }]);
    expect(r.applied).toHaveLength(1);
    expect(r.rejected[0].reason).toMatch(/t5/);
  });

  it("[L11] identical duplicate ops apply once; count adds several on purpose", () => {
    const dup = applyLayoutOps(CLINIC, [{ op: "add", label: "office" }, { op: "add", label: "office" }]);
    expect(rooms(dup.blocks)).toHaveLength(rooms(CLINIC).length + 1);
    const two = applyLayoutOps(CLINIC, [{ op: "add", label: "office", count: 2 }]);
    expect(rooms(two.blocks)).toHaveLength(rooms(CLINIC).length + 2);
  });

  it("[L12] more than the max ops in one turn: the extras are rejected", () => {
    const ops = Array.from({ length: MAX_OPS + 1 }, (_, i) => ({ op: "add", label: "office", w: 10 + i }));
    const r = applyLayoutOps(CLINIC, ops);
    expect(r.applied).toHaveLength(MAX_OPS);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].reason).toMatch(/too many/);
  });

  it("[L13] never mutates its input", () => {
    const copy = structuredClone(CLINIC);
    applyLayoutOps(CLINIC, [{ op: "resize", id: "t2", scale: 3 }, { op: "remove", id: "t3" }, { op: "relabel", id: "t5", label: "office" }]);
    expect(CLINIC).toEqual(copy);
  });

  it("[L14] an empty op list changes nothing", () => {
    const r = applyLayoutOps(CLINIC, []);
    expect(r.blocks).toEqual(CLINIC);
    expect(fromLayout(r.blocks, base)).toEqual(fromLayout(CLINIC, base));
  });

  it("[L15] edit then fromLayout gives the expected spec for three layouts", () => {
    const clinic = fromLayout(applyLayoutOps(CLINIC, [{ op: "add", label: "exam room", nextTo: "t3" }]).blocks, base);
    // A new exam room copies the existing exam rooms' 23x10 size, so the minimum stays 85% of 230 sf.
    expect(clinic.rooms.find((r) => r.label === "exam room")).toMatchObject({ count: 3, minSqft: Math.round(230 * 0.85), fixtures: ["sink"] });
    const office = fromLayout(applyLayoutOps(OFFICE, [{ op: "remove", id: "a3" }, { op: "relabel", id: "a4", label: "meeting room" }]).blocks, base);
    expect(office.rooms).toEqual([
      { label: "open area", count: 1, hard: false, minSqft: 510, adjacentTo: ["office", "conference", "kitchen"] },
      { label: "office", count: 1, hard: false, minSqft: 85, adjacentTo: ["open area"] },
      { label: "conference", count: 1, hard: false, minSqft: 143, adjacentTo: ["open area", "kitchen"] },
      { label: "kitchen", count: 1, hard: false, minSqft: 68, adjacentTo: ["open area", "conference"] },
    ]);
    const salon = fromLayout(applyLayoutOps(SALON, [{ op: "resize", id: "s3", w: 10, h: 10 }]).blocks, base);
    expect(salon.rooms.find((r) => r.label === "storage")?.minSqft).toBe(85);
    expect(salon.rooms.find((r) => r.label === "open area")?.fixtures).toEqual(["sink"]);
  });

  it("[L16] undo restores the exact previous layout; undo with no history does nothing", () => {
    // The chat keeps a stack of previous Block[]; applyLayoutOps returns fresh arrays, so the stack entries are stable.
    const history: Block[][] = [];
    let current = CLINIC;
    const r = applyLayoutOps(current, [{ op: "remove", id: "t2" }]);
    history.push(current);
    current = r.blocks;
    current = history.pop() ?? current;
    expect(current).toEqual(CLINIC);
    expect(history.pop() ?? current).toEqual(CLINIC);
  });

  it("names rooms the way Layout Studio does, so ordinals line up", () => {
    expect(blockName(CLINIC, CLINIC[2])).toBe("Exam Room 2");
    expect(describeLayout(CLINIC)).toContain('t3: "Exam Room 2"');
  });
});
