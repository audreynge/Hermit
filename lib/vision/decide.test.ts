import { describe, expect, it } from "vitest";
import { cropRect, decide, mapPanosToRooms, parseVision, pickPanos, slug, upsertChecks } from "./decide";
import type { PanoCheck } from "../types";

const sq = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe("mapPanosToRooms", () => {
  const rooms = [
    { id: "big", polygon: sq(0, 0, 10, 10), floorId: "f1", sweeps: [] },
    { id: "exam", polygon: sq(1, 1, 3, 3), floorId: "f1", sweeps: [] },
    { id: "up", polygon: sq(0, 0, 10, 10), floorId: "f2", sweeps: [{ id: "p4", index: 4 }] },
    { id: "empty", polygon: [], floorId: "f1" },
  ];
  it("puts a pano in the smallest room that contains it and respects Matterport's floor list", () => {
    const { byRoom, unmapped } = mapPanosToRooms(rooms, [
      { id: "p1", x: 2, y: 2 }, // inside exam and big: exam wins
      { id: "p2", x: 8, y: 8 }, // only big on f1 (and up on f2, same size; big comes first)
      { id: "p3", x: 20, y: 20 }, // outside everything
      { id: "p4", x: 2, y: 2 }, // listed by a room on f2, so only f2 rooms count
    ]);
    expect(byRoom.exam.map((p) => p.id)).toEqual(["p1"]);
    expect(byRoom.big.map((p) => p.id)).toEqual(["p2"]);
    expect(byRoom.up.map((p) => p.id)).toEqual(["p4"]);
    expect(unmapped.map((p) => p.id)).toEqual(["p3"]);
  });
  it("picks panos nearest the centroid", () => {
    const picked = pickPanos(sq(0, 0, 4, 4), [{ id: "a", x: 0.1, y: 0.1 }, { id: "b", x: 2, y: 2.1 }, { id: "c", x: 3, y: 3 }]);
    expect(picked.map((p) => p.id)).toEqual(["b", "c"]);
  });
});

describe("decide", () => {
  it("downgrades seen without a box to unclear", () => {
    const d = decide("sink", { result: "seen", image: 2, box_2d: [], note: "A sink." }, "all", 8);
    expect(d.result).toBe("unclear");
    expect(d.box).toBeNull();
    expect(d.confidence).toBe(0.3);
  });
  it("downgrades seen with a degenerate box or a bad image index", () => {
    expect(decide("sink", { result: "seen", image: 1, box_2d: [100, 100, 101, 400] }, "all", 8).result).toBe("unclear");
    expect(decide("sink", { result: "seen", image: 9, box_2d: [100, 100, 300, 400] }, "all", 8).result).toBe("unclear");
  });
  it("keeps seen with a box", () => {
    const d = decide("exam table", { result: "seen", image: 3, box_2d: [100, 200, 500, 900], note: "An exam table by the wall." }, "most", 8);
    expect(d).toMatchObject({ result: "seen", image: 3, box: [100, 200, 500, 900], confidence: 0.8, note: "An exam table by the wall." });
  });
  it("allows not_seen only when all walls are visible", () => {
    expect(decide("toilet", { result: "not_seen", image: 0, box_2d: [] }, "all", 8)).toMatchObject({ result: "not_seen", confidence: 0.6 });
    expect(decide("toilet", { result: "not_seen", image: 0, box_2d: [] }, "most", 8).result).toBe("unclear");
  });
});

describe("parseVision", () => {
  it("matches features by name and makes missing or malformed answers unclear", () => {
    const text = JSON.stringify({ walls_visible: "all", features: [
      { feature: "Sink", result: "seen", image: 0, box_2d: [10, 10, 200, 200], note: "A sink on the left." },
      { feature: "counter", result: "not_seen", image: 1, box_2d: [], note: "No counter." },
    ] });
    const out = parseVision(text, ["sink", "counter", "toilet"], 4);
    expect(out.map((d) => d.result)).toEqual(["seen", "not_seen", "unclear"]);
    expect(parseVision("not json", ["sink"], 4)[0].result).toBe("unclear");
  });
});

describe("helpers", () => {
  it("crops inside the image with padding", () => {
    const r = cropRect([400, 400, 600, 600], 2048, 2048);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.left + r.width).toBeLessThanOrEqual(2048);
    expect(r.width).toBeGreaterThan(0.2 * 2048);
    const edge = cropRect([0, 950, 50, 1000], 1000, 1000);
    expect(edge.left + edge.width).toBeLessThanOrEqual(1000);
    expect(edge.top).toBe(0);
  });
  it("slugs features for file names the asset route accepts", () => {
    expect(slug("Exam Table")).toBe("exam-table");
    expect(/^[A-Za-z0-9_-]{1,80}\.jpg$/.test(`room1-${slug("lab counter!")}.jpg`)).toBe(true);
  });
  it("upserts by room and feature", () => {
    const c = (roomId: string, feature: string, result: PanoCheck["result"]): PanoCheck => ({ sid: "s", roomId, feature, result, confidence: 0.3, note: "", model: "m", retrieved: "" });
    const out = upsertChecks([c("r1", "sink", "unclear"), c("r1", "toilet", "unclear")], [c("r1", "Sink", "seen")]);
    expect(out.map((x) => `${x.feature}:${x.result}`)).toEqual(["toilet:unclear", "Sink:seen"]);
  });
});
