import { describe, expect, it } from "vitest";
import { roomStop, tourSteps, tourUrl, yawToward } from "./matterport";
import type { RoomGraph, ShellReport } from "../types";

const sq = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];

// r1: exam room with its own camera spot inside. r2: small exam room nobody scanned from inside; the nearest
// spot (p3) is in reception next door. r4: reception.
const graph = {
  sid: "ABC123", name: "", totalAreaSqft: 0, edges: [],
  panos: [{ id: "p1", label: "8", x: 1, y: 1 }, { id: "p2", label: "9", x: 1.5, y: 1.5 }, { id: "p3", label: "12", x: 5, y: 1 }, { id: "p9", label: "30", x: 20, y: 20 }],
  rooms: [
    { id: "r1", label: "office", rawTags: [], areaSqft: 120, floorId: "f", polygon: sq(0, 0, 3), sweeps: [{ id: "p2", index: 9 }, { id: "p1", index: 8 }] },
    { id: "r2", label: "office", rawTags: [], areaSqft: 80, floorId: "f", polygon: sq(3, 3, 2.5), sweeps: [] },
    { id: "r4", label: "reception", rawTags: [], areaSqft: 200, floorId: "f", polygon: sq(3, 0, 4), sweeps: [{ id: "p3", index: 12 }] },
  ],
} as unknown as RoomGraph;

const report = {
  name: "Elm St · suite", unknowns: [],
  inside: { sid: "ABC123", sweepId: "p9" },
  fit: { assignment: [{ req: "exam room #1", roomId: "r1", cost: 0 }, { req: "exam room #2", roomId: "r2", cost: 0 }, { req: "storage", roomId: null, cost: 70 }] },
  floorplan: graph,
} as unknown as ShellReport;

describe("tourUrl", () => {
  it("builds the Showcase embed, starting at a sweep when given", () => {
    expect(tourUrl("ABC123")).toBe("https://my.matterport.com/show/?m=ABC123&play=1&qs=1&brand=0");
    expect(tourUrl("ABC123", 8)).toBe("https://my.matterport.com/show/?m=ABC123&play=1&qs=1&brand=0&ss=8");
    expect(tourUrl("ABC123", 8, 90)).toBe("https://my.matterport.com/show/?m=ABC123&play=1&qs=1&brand=0&ss=8&sr=0,1.57");
  });

  it("refuses ids that are not Matterport sids", () => {
    expect(() => tourUrl("../evil")).toThrow();
  });
});

describe("roomStop", () => {
  it("stands inside the room, preferring the room's own spot nearest its center", () => {
    expect(roomStop(graph, graph.rooms[0])).toEqual({ sweepId: "p2", index: 9, inside: true });
  });

  it("falls back to the nearest spot outside the room and faces it", () => {
    const s = roomStop(graph, graph.rooms[1])!;
    expect(s).toMatchObject({ sweepId: "p3", index: 12, inside: false });
    expect(s.yaw).toBeTypeOf("number");
  });

  it("uses a pano that no room lists in its sweeps", () => {
    const g = { ...graph, rooms: [{ ...graph.rooms[1], polygon: sq(19, 19, 2) }] } as RoomGraph;
    expect(roomStop(g, g.rooms[0])).toEqual({ sweepId: "p9", index: 30, inside: true });
  });
});

describe("yawToward", () => {
  it("faces plan north (+y, world -z) at yaw 0 and plan east (+x) at -90", () => {
    expect(yawToward({ x: 0, y: 0 }, { x: 0, y: 5 })).toBeCloseTo(0);
    expect(yawToward({ x: 0, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(-90);
  });
});

describe("tourSteps", () => {
  it("walks each requested room, saying when the view is from outside it", () => {
    const steps = tourSteps(report);
    expect(steps.map((s) => [s.room, s.sweepId, s.inside])).toEqual([[undefined, "p9", undefined], ["exam room 1", "p2", true], ["exam room 2", "p3", false], ["storage", undefined, undefined], [undefined, undefined, undefined]]);
    expect(steps[1].text).toBe("This is where your exam room 1 would go. It's about 120 sq ft.");
    expect(steps[2].text).toMatch(/^Your exam room 2 is the room ahead of you, about 80 sq ft\. The scanner never stood inside it/);
    expect(steps[3].text).toMatch(/isn't built here yet/);
  });
});
