import { describe, expect, it } from "vitest";
import type { FitResult, Room, RoomGraph } from "../types";
import { ghost, ghostText } from "./ghost";

const sq = (x: number): Room["polygon"] => [{ x, y: 0 }, { x: x + 3, y: 0 }, { x: x + 3, y: 3 }, { x, y: 3 }];
const room = (id: string, label: string, areaSqft: number, extra: Partial<Room> = {}): Room =>
  ({ id, label, rawTags: [label], areaSqft, polygon: sq(0), floorId: "f1", ...extra });
const graph = (rooms: Room[]): RoomGraph =>
  ({ sid: "s1", name: "Suite", totalAreaSqft: 900, rooms, edges: [], objects: [], panoCount: 5, floorCount: 1 });
const fitOf = (assignment: FitResult["assignment"], extra: Partial<FitResult> = {}): FitResult =>
  ({ score: 80, assignment, edits: [], breakdown: {}, hardFails: [], unknowns: [], ...extra });

const g = graph([room("a", "other", 109), room("b", "office", 86.4), room("c", "bathroom", 40), room("h", "hallway", 200)]);

describe("ghost", () => {
  it("maps matched rooms with the user's name and measured size, and leaves the rest as other", () => {
    const out = ghost(fitOf([{ req: "exam room #1", roomId: "a", cost: 20 }, { req: "restroom", roomId: "c", cost: 0 }]), g);
    expect(out.matched).toEqual([
      { roomId: "a", reqs: ["exam room #1"], label: "exam room #1", sf: 109 },
      { roomId: "c", reqs: ["restroom"], label: "restroom", sf: 40 },
    ]);
    expect(out.toBuild).toEqual([]);
    expect(out.other).toEqual(["b", "h"]);
  });

  it("marks a room the scan names differently as 'could become', but never a vague one", () => {
    const out = ghost(fitOf([{ req: "exam room #1", roomId: "b", cost: 15 }, { req: "lab", roomId: "a", cost: 15 }]), g);
    expect(out.matched[0]).toMatchObject({ roomId: "b", sf: 86, convert: "office" });
    expect(out.matched[1].convert).toBeUndefined();
  });

  it("turns unmatched rooms into to-build chips sized from the spec, the fit edit, or the drawn block", () => {
    const fit = fitOf([
      { req: "exam room #1", roomId: "a", cost: 20 },
      { req: "exam room #2", roomId: null, cost: 70 },
      { req: "lab", roomId: null, cost: 70 },
      { req: "storage", roomId: null, cost: 70 },
      { req: "break room", roomId: null, cost: 70 },
    ], { edits: ["Build lab (~90 sf)", "Build storage"] });
    const out = ghost(fit, g, {
      spec: { rooms: [{ label: "exam room", count: 2, minSqft: 110, hard: false }], layout: [{ label: "storage", x: 0, y: 0, w: 5, h: 6 }] },
      similarity: { score: 50, scale: 2, breakdown: { program: 1, adjacency: null, size: 1, shape: 1 }, pairs: [] },
    });
    expect(out.toBuild).toEqual([
      { label: "exam room #2", sf: 110 },
      { label: "lab", sf: 90 },
      { label: "storage", sf: 60 },
      { label: "break room" },
    ]);
  });

  it("joins two requests that share one room and flags proposed merges", () => {
    const merged = graph([room("m", "office", 210, { proposed: true, parts: [sq(0), sq(3)] }), room("z", "other", 50)]);
    const out = ghost(fitOf([{ req: "office", roomId: "m", cost: 0 }, { req: "reception", roomId: "m", cost: 15 }]), merged);
    expect(out.matched).toHaveLength(1);
    expect(out.matched[0]).toMatchObject({ roomId: "m", label: "office + reception", reqs: ["office", "reception"], merged: true });
    expect(out.other).toEqual(["z"]);
  });

  it("calls a room unsure when the scan's labels couldn't tell, or when the matched room isn't in the graph", () => {
    const out = ghost(fitOf([{ req: "bathroom", roomId: null, cost: 70 }, { req: "lab", roomId: "gone", cost: 15 }], { unknowns: ["bathroom: not identifiable in scan s1 (0 of 9 rooms labeled)"] }), g);
    expect(out.matched).toEqual([]);
    expect(out.toBuild).toEqual([{ label: "bathroom", unsure: true }, { label: "lab", unsure: true }]);
  });

  it("handles an empty fit", () => {
    expect(ghost(fitOf([]), g)).toEqual({ matched: [], toBuild: [], other: ["a", "b", "c", "h"] });
    expect(ghost(null, g).other).toHaveLength(4);
    expect(ghost(undefined, undefined)).toEqual({ matched: [], toBuild: [], other: [] });
  });

  it("record-only (no graph): nothing is matched and every room is unsure, never 'missing'", () => {
    const out = ghost(fitOf([{ req: "exam room #1", roomId: null, cost: 70 }, { req: "lab", roomId: "a", cost: 15 }]), null);
    expect(out.matched).toEqual([]);
    expect(out.other).toEqual([]);
    expect(out.toBuild.every((b) => b.unsure)).toBe(true);
  });
});

describe("ghostText", () => {
  it("reads one plain line per room", () => {
    const out = ghost(fitOf([{ req: "exam room #1", roomId: "b", cost: 15 }, { req: "lab", roomId: null, cost: 70 }, { req: "bathroom", roomId: null, cost: 70 }],
      { edits: ["Build lab (~90 sf)"], unknowns: ["bathroom: not identifiable"] }), g);
    expect(ghostText(out, () => "Room 2")).toEqual([
      "Exam room #1 → Room 2, 86 sf (scanned as office; could become yours)",
      "Lab → to build, about 90 sf",
      "Bathroom → couldn't find it in the scan",
    ]);
  });
});
