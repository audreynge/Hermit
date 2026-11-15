import { describe, expect, it } from "vitest";
import { countLine, countTier, fit, roomCounts, severe, shortfalls } from "./fit";
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

  it("records a hard fail when a required non-counted room is absent", () => {
    const g = graph([room("r1", "office", 150)]);
    const r = fit(spec([{ label: "kitchen", count: 1, hard: true }]), g);
    expect(r.hardFails).toHaveLength(1);
    expect(r.hardFails[0]).toMatch(/kitchen/);
    expect(r.score).toBeLessThan(60);
  });

  it("reports a missing bathroom as a count shortfall, not a hard fail, and never fills it with a closet", () => {
    const s = spec([{ label: "restroom", count: 1, hard: true }]);
    const r = fit(s, graph([room("r1", "office", 150), room("c", "storage", 40), room("x", "other", 30)]));
    expect(r.assignment[0].roomId).toBeNull();
    expect(r.hardFails).toEqual([]);
    const counts = roomCounts(s, r, true);
    expect(shortfalls(s, counts)).toEqual(["Has no restrooms; you need 1"]);
    expect(severe(counts)).toBe(true);
  });

  it("states real counts: 3 of 3 exam rooms, 1 of 2 restrooms", () => {
    const s = spec([{ label: "exam room", count: 3, hard: false }, { label: "restroom", count: 2, hard: false }, { label: "reception", count: 1, hard: false }]);
    const g = graph([room("a", "office", 120), room("b", "office", 120), room("c", "office", 120), room("w", "bathroom", 50), room("cl", "storage", 30), room("r", "reception", 300)]);
    const r = fit(s, g);
    const counts = roomCounts(s, r, true);
    expect(countLine(s, counts)).toBe("3 of 3 exam rooms, 1 of 2 restrooms already built");
    expect(shortfalls(s, counts)).toEqual(["Has 1 restroom; you need 2"]);
    expect(r.assignment.find((a) => a.roomId === "cl")).toBeUndefined();
    expect(countTier(counts)).toBe(2);
  });

  it("fills primary rooms before lesser rooms when the scan is short on rooms", () => {
    const s = spec([{ label: "exam room", count: 2, hard: false }, { label: "reception", count: 1, hard: false }, { label: "storage", count: 1, hard: false }]);
    const r = fit(s, graph([room("a", "office", 120), room("b", "office", 120)]));
    expect(shortfalls(s, roomCounts(s, r, true))).toEqual([]);
  });

  it("treats counts as unknown, never met, without a readable scan", () => {
    const s = spec([{ label: "bathroom", count: 2, hard: false }]);
    const sparse = fit(s, graph([room("r1", "other", 150), room("r2", "other", 140), room("r3", "office", 120)]));
    const counts = roomCounts(s, sparse, true);
    expect(counts[0]).toMatchObject({ have: 0, unknown: 2 });
    expect(shortfalls(s, counts)).toEqual([]);
    expect(countTier(counts)).toBe(1);
    expect(countTier(roomCounts(s, { score: 0, assignment: [], edits: [], breakdown: {}, hardFails: [], unknowns: [] }, false))).toBe(1);
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
