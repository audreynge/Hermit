import { describe, expect, it } from "vitest";
import { blocksToSketch, roomsFromBlocks, sketchToBlocks } from "./blocks";
import type { Block } from "./parse";

describe("sketch <-> Layout Studio blocks", () => {
  const blocks: Block[] = [
    { id: "a", kind: "room", label: "exam room", x: 0, y: 0, w: 10, h: 10 },
    { id: "b", kind: "room", label: "exam room", x: 10, y: 0, w: 12, h: 10 },
    { id: "c", kind: "room", label: "reception", x: 0, y: 10, w: 22, h: 8 },
    { id: "s", kind: "object", label: "sink", x: 2, y: 2, w: 3, h: 3 },
    { id: "e", kind: "object", label: "exam bed", x: 12, y: 2, w: 9, h: 3 },
    { id: "d", kind: "object", label: "door", x: 9, y: 4, w: 3, h: 3 },
  ];
  it("round-trips rooms, furniture and extras", () => {
    const { layout, furniture, extras } = blocksToSketch(blocks);
    expect(layout.map((r) => r.key)).toEqual(["exam room#0", "exam room#1", "reception#0"]);
    expect(layout.every((r) => r.pinned && r.sized)).toBe(true);
    expect(furniture.map((f) => f.type)).toEqual(["sink", "exam table"]);
    expect(extras.map((x) => x.label)).toEqual(["door"]);
    const back = sketchToBlocks(layout, furniture, extras);
    expect(back.map((b) => [b.label, b.x, b.w])).toEqual(blocks.map((b) => [b.label, b.x, b.w]).sort((p, q) => (p[0] === "door" ? 1 : q[0] === "door" ? -1 : 0)));
  });
  it("counts rooms, keeps prior requirements and adds placed fixtures", () => {
    const rooms = roomsFromBlocks(blocks, [{ label: "reception", count: 1, hard: true }]);
    expect(rooms.find((r) => r.label === "exam room")).toMatchObject({ count: 2, fixtures: ["sink"] });
    expect(rooms.find((r) => r.label === "reception")).toMatchObject({ count: 1, hard: true });
  });
});
