import { describe, expect, it } from "vitest";
import { FT_PER_M, chooseMapping, cropRect, decide, isDailyQuota, mapPanosToRooms, parseVision, pickPanos, retryDelayMs, slug, upsertChecks, type PanoPos } from "./decide";
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

describe("chooseMapping", () => {
  // Two rooms in the polygons' frame; the panos sit at (6, 1.5) and (11, 2) in that frame.
  const rooms = [
    { id: "A", polygon: sq(4, 0.5, 8, 2.5), floorId: "f1", sweeps: [] },
    { id: "B", polygon: sq(10, 1, 12, 3), floorId: "f1", sweeps: [] },
  ];
  const cases: [string, PanoPos[]][] = [
    ["x,y", [{ id: "p", x: 6, y: 1.5 }, { id: "q", x: 11, y: 2 }]],
    ["x,-y", [{ id: "p", x: 6, y: -1.5 }, { id: "q", x: 11, y: -2 }]],
    ["-x,y", [{ id: "p", x: -6, y: 1.5 }, { id: "q", x: -11, y: 2 }]],
    ["y,x", [{ id: "p", x: 1.5, y: 6 }, { id: "q", x: 2, y: 11 }]],
    ["x,z", [{ id: "p", x: 6, y: 99, z: 1.5 }, { id: "q", x: 11, y: 99, z: 2 }]],
    ["x,-z", [{ id: "p", x: 6, y: 99, z: -1.5 }, { id: "q", x: 11, y: 99, z: -2 }]],
  ];
  it.each(cases)("finds the %s convention", (name, panos) => {
    const m = chooseMapping(rooms, panos);
    expect(m.transform).toBe(name);
    expect(m).toMatchObject({ hits: 2, total: 2, rate: 1, mappable: true });
    expect(m.byRoom.A.map((p) => p.id)).toEqual(["p"]);
    expect(m.byRoom.B[0]).toMatchObject({ id: "q", x: 11, y: 2 }); // positions come back in the polygons' frame
  });

  it("scales metres to feet when the polygons are about 3.3x the pano extent", () => {
    const ft = [{ id: "A", polygon: sq(10, 0, 14, 4), floorId: "f1" }, { id: "B", polygon: sq(26, 0, 30, 10), floorId: "f1" }];
    const m = chooseMapping(ft, [{ id: "p", x: 11 / FT_PER_M, y: 1 / FT_PER_M }, { id: "q", x: 29 / FT_PER_M, y: 9 / FT_PER_M }]);
    expect(m.ratio).toBeGreaterThan(3);
    expect(m.transform).toBe(`x,y ×${FT_PER_M}`);
    expect(m.hits).toBe(2);
  });

  it("scales feet to metres when the polygons are about 1/3.3 of the pano extent", () => {
    const metres = [{ id: "A", polygon: sq(3, 0, 5, 3), floorId: "f1" }, { id: "B", polygon: sq(8, 0, 10, 3), floorId: "f1" }];
    const m = chooseMapping(metres, [{ id: "p", x: 3.3 * FT_PER_M, y: 0.3 * FT_PER_M }, { id: "q", x: 9.7 * FT_PER_M, y: 2.7 * FT_PER_M }]);
    expect(m.transform).toBe(`x,y ÷${FT_PER_M}`);
    expect(m.hits).toBe(2);
  });

  it("keeps identity on a tie or a one-pano gain", () => {
    const sym = [{ id: "A", polygon: sq(-1, -1, 1, 1), floorId: "f1" }];
    expect(chooseMapping(sym, [{ id: "p", x: 0.2, y: 0.3 }]).transform).toBe("x,y");
    // x,-y would put 2 of 3 panos in a room against identity's 1: not enough to switch.
    const two = [{ id: "A", polygon: sq(0, 0, 4, 4), floorId: "f1" }, { id: "B", polygon: sq(6, -4, 8, -2), floorId: "f1" }];
    expect(chooseMapping(two, [{ id: "p", x: 2, y: 2 }, { id: "q", x: 2, y: -2 }, { id: "r", x: 7, y: 3 }]).transform).toBe("x,y");
  });

  it("never picks a transform that squashes the panos onto a line (constant camera height)", () => {
    // One room spans y = 1.3 across the whole plan; (x, z) with z = 1.3 would put every pano in it.
    const plan = [{ id: "strip", polygon: sq(0, 1, 20, 1.6), floorId: "f1" }, { id: "A", polygon: sq(0, 4, 5, 9), floorId: "f1" }, { id: "B", polygon: sq(10, 4, 15, 9), floorId: "f1" }];
    const panos = [{ id: "p", x: 2, y: 6, z: 1.3 }, { id: "q", x: 12, y: 30, z: 1.3 }, { id: "r", x: 18, y: 30, z: 1.3 }, { id: "s", x: 8, y: 30, z: 1.3 }];
    const m = chooseMapping(plan, panos);
    expect(m.transform).toBe("x,y");
    expect(m.mappable).toBe(false); // 1 of 4 inside: unmappable rather than a guess
  });

  it("calibrates on the room graph's own pano positions, and then trusts a low hit rate", () => {
    const panos = [{ id: "p", x: 6, y: -1.5 }, { id: "a", x: 50, y: -50 }, { id: "b", x: 60, y: -60 }, { id: "c", x: 70, y: -70 }];
    const ref = panos.map((p) => ({ id: p.id, x: p.x, y: -p.y }));
    const m = chooseMapping(rooms, panos, ref);
    expect(m).toMatchObject({ transform: "x,-y", calibrated: true, hits: 1, mappable: true });
    expect(m.byRoom.A.map((p) => p.id)).toEqual(["p"]);
    // Stored positions that match no transform are ignored and the hit-rate search runs instead.
    const junk = panos.map((p, i) => ({ id: p.id, x: i * 37, y: i * -11 }));
    expect(chooseMapping(rooms, panos, junk)).toMatchObject({ calibrated: false, mappable: false });
  });

  it("marks a scan unmappable below 30% hits and maps nothing", () => {
    const panos = [{ id: "p", x: 6, y: 1.5 }, { id: "a", x: 50, y: 50 }, { id: "b", x: 60, y: 60 }, { id: "c", x: 70, y: 70 }];
    const m = chooseMapping(rooms, panos);
    expect(m).toMatchObject({ hits: 1, total: 4, mappable: false, byRoom: {} });
    expect(m.unmapped).toHaveLength(4);
    expect(chooseMapping([{ id: "x", polygon: [], floorId: "f1" }], panos).mappable).toBe(false);
    expect(chooseMapping(rooms, []).mappable).toBe(false);
  });
});

describe("retryDelayMs / isDailyQuota", () => {
  const half = () => 0.5;
  it("honors Retry-After seconds and dates, then RetryInfo, then backs off exponentially", () => {
    expect(retryDelayMs(0, "7", null, half)).toBe(7500);
    expect(retryDelayMs(0, new Date(10_000).toUTCString(), null, half, 0)).toBe(10_500);
    const body = { error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" }] } };
    expect(retryDelayMs(3, null, body, half)).toBe(37_500);
    expect(retryDelayMs(0, null, null, half)).toBe(2000);
    expect(retryDelayMs(2, null, null, half)).toBe(8000);
    expect(retryDelayMs(1, null, null, () => 0)).toBe(3000); // jitter spans 0.75x to 1.25x
    expect(retryDelayMs(20, null, null, half)).toBe(120_000);
  });
  it("tells a daily quota from a per-minute rate limit", () => {
    const viol = (quotaId: string) => ({ error: { code: 429, message: "You exceeded your current quota", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] }] } });
    expect(isDailyQuota(viol("GenerateRequestsPerDayPerProjectPerModel-FreeTier"))).toBe(true);
    expect(isDailyQuota(viol("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"))).toBe(false);
    expect(isDailyQuota({ error: { message: "You exceeded your current quota" } })).toBe(false);
    expect(isDailyQuota(null)).toBe(false);
  });
});
