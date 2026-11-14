import { describe, expect, it } from "vitest";
import { fit } from "./fit";
import { normalizeRoomLabel } from "./labels";
import type { RequirementSpec, Room, RoomGraph } from "../types";

const room = (id: string, label: string, areaSqft: number): Room => ({
  id, label, rawTags: [label], areaSqft, polygon: [], floorId: "f1",
});

const graph = (rooms: Room[], extra: Partial<RoomGraph> = {}): RoomGraph => ({
  sid: "SID1", name: "Suite 100", totalAreaSqft: rooms.reduce((s, r) => s + r.areaSqft, 0),
  rooms, edges: [], objects: [], panoCount: 10, floorCount: 1, ...extra,
});

const spec = (rooms: RequirementSpec["rooms"], extra: Partial<RequirementSpec> = {}): RequirementSpec => ({
  mode: "business", city: "houston", useType: "dental clinic", rooms, needs: {}, priorities: {}, input: "survey", ...extra,
});

describe("normalizeRoomLabel", () => {
  it("maps Matterport tags to canonical labels", () => {
    expect(normalizeRoomLabel(["hallway", "unfurnished"])).toBe("hallway");
    expect(normalizeRoomLabel(["Restroom"])).toBe("bathroom");
    expect(normalizeRoomLabel(["kitchenette"])).toBe("kitchen");
    expect(normalizeRoomLabel(["workspace"])).toBe("office");
    expect(normalizeRoomLabel(["other", "unfurnished"])).toBe("other");
    expect(normalizeRoomLabel([])).toBe("other");
  });
});

describe("fit", () => {
  it("scores a like-for-like suite highly with every requirement assigned", () => {
    const g = graph([room("r1", "office", 150), room("r2", "office", 140), room("r3", "bathroom", 50)]);
    const r = fit(spec([
      { label: "office", count: 2, minSqft: 100, hard: false },
      { label: "bathroom", count: 1, hard: true },
    ]), g);
    expect(r.assignment.every((a) => a.roomId)).toBe(true);
    expect(r.hardFails).toEqual([]);
    expect(r.score).toBeGreaterThan(85);
  });

  it("turns a missing soft room into a build edit instead of a hard fail", () => {
    const g = graph([room("r1", "office", 150)]);
    const r = fit(spec([
      { label: "office", count: 1, hard: false },
      { label: "kitchen", count: 1, hard: false },
    ]), g);
    expect(r.assignment.find((a) => a.req.startsWith("kitchen"))?.roomId).toBeNull();
    expect(r.edits.some((e) => /build kitchen/i.test(e))).toBe(true);
    expect(r.hardFails).toEqual([]);
  });

  it("records a hard fail when a required room is absent", () => {
    const g = graph([room("r1", "office", 150)]);
    const r = fit(spec([{ label: "bathroom", count: 1, hard: true }]), g);
    expect(r.hardFails).toHaveLength(1);
    expect(r.hardFails[0]).toMatch(/bathroom/);
    expect(r.score).toBeLessThan(60);
  });

  it("keeps a required room unknown, not failed, when the scan's labels are too sparse to tell", () => {
    const g = graph([room("r1", "other", 150), room("r2", "other", 140), room("r3", "office", 120)]);
    const r = fit(spec([{ label: "bathroom", count: 1, hard: true }]), g);
    expect(r.hardFails).toEqual([]);
    expect(r.unknowns).toEqual([expect.stringMatching(/bathroom/)]);
  });

  it("penalizes requested adjacency the scan does not show, and trusts door edges", () => {
    const rooms = [room("a", "reception", 200), room("b", "office", 150), room("c", "office", 150)];
    const req = spec([
      { label: "reception", count: 1, adjacentTo: ["office"], hard: false },
      { label: "office", count: 1, hard: false },
    ]);
    const apart = fit(req, graph(rooms));
    const linked = fit(req, graph(rooms, { edges: [{ a: "a", b: "b", kind: "door" }, { a: "a", b: "c", kind: "door" }] }));
    expect(linked.breakdown.adjacency).toBe(100);
    expect(apart.breakdown.adjacency).toBeLessThan(100);
    expect(apart.edits.some((e) => /next to office/i.test(e))).toBe(true);
    expect(linked.score).toBeGreaterThan(apart.score);
  });

  it("prefers the room that already has the requested fixture", () => {
    const g = graph([room("r1", "other", 120), room("r2", "other", 120)], {
      objects: [{ label: "sink", roomId: "r2", confidence: 0.9 }],
    });
    const r = fit(spec([{ label: "exam room", count: 1, fixtures: ["sink"], hard: false }]), g);
    expect(r.assignment[0].roomId).toBe("r2");
  });

  it("suggests dividing a room more than twice the required size", () => {
    const g = graph([room("r1", "open", 900)]);
    const r = fit(spec([{ label: "office", count: 1, minSqft: 120, maxSqft: 300, hard: false }]), g);
    expect(r.edits.some((e) => /divide/i.test(e))).toBe(true);
  });

  it("ignores hallways and zero-area voids as candidate rooms", () => {
    const g = graph([room("h", "hallway", 400), room("v", "other", 0)]);
    const r = fit(spec([{ label: "office", count: 1, hard: false }]), g);
    expect(r.assignment[0].roomId).toBeNull();
  });

  it("flags total area far below the requested range as a hard fail", () => {
    const g = graph([room("r1", "office", 300)]);
    const r = fit(spec([], { sizeSqft: [2000, 3000] }), g);
    expect(r.hardFails.some((f) => /area/i.test(f))).toBe(true);
  });
});
