import { describe, expect, it } from "vitest";
import { checkAccess, doorPoint, turnCircleIn } from "./access";
import type { Room, RoomGraph } from "../types";

const room = (id: string, label: string, w = 4, h = 4): Room => ({
  id, label, rawTags: [], areaSqft: w * h * 10.76, polygon: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], floorId: "f",
});
const graph = (edges: RoomGraph["edges"], entries: RoomGraph["entries"] = [{ roomId: "l", widthIn: 36 }]): RoomGraph => ({
  sid: "G", name: "G", totalAreaSqft: 0, objects: [], panoCount: 0, floorCount: 1, entries, edges,
  rooms: [room("l", "living", 6, 5), room("h", "hallway"), room("b", "bedroom"), room("ba", "bathroom", 1.5, 2)],
});
const status = (g: RoomGraph, key: "asScanned" | "hinges" = "asScanned") =>
  Object.fromEntries(checkAccess(g)![key].map((r) => [r.roomId, r.status]));

describe("checkAccess", () => {
  it("routes a 27 in chair only through doors with enough clear width", () => {
    const g = graph([
      { a: "l", b: "h", kind: "door", widthIn: 36 },
      { a: "h", b: "b", kind: "door", widthIn: 32 },
      { a: "h", b: "ba", kind: "door", widthIn: 26 },
    ]);
    expect(status(g)).toEqual({ l: "reachable", h: "reachable", b: "reachable", ba: "blocked" });
    expect(checkAccess(g)!.asScanned.find((r) => r.roomId === "ba")!.reason).toMatch(/from hallway.*24\.0 in clear, 3\.0 in short/);
    expect(checkAccess(g)!.asScanned.find((r) => r.roomId === "ba")!.stopDoor).toEqual({ from: "h", clearIn: 24 });
  });

  it("lets swing-clear hinges recover a door that is just short", () => {
    const g = graph([{ a: "l", b: "b", kind: "door", widthIn: 28 }]); // 26 in clear as scanned, 27.75 with hinges
    expect(status(g).b).toBe("blocked");
    expect(status(g, "hinges").b).toBe("reachable");
  });

  it("calls a room unknown, never blocked, when its door was not measured", () => {
    const g = graph([{ a: "l", b: "h", kind: "door", widthIn: 36 }, { a: "h", b: "b", kind: "door" }, { a: "l", b: "ba", kind: "possible" }]);
    expect(status(g)).toMatchObject({ b: "unknown", ba: "unknown" });
  });

  it("blocks rooms reachable only through a room the chair can't enter", () => {
    const g = graph([{ a: "l", b: "h", kind: "door", widthIn: 24 }, { a: "h", b: "b", kind: "door", widthIn: 36 }]);
    expect(status(g)).toMatchObject({ h: "blocked", b: "blocked" });
    expect(checkAccess(g)!.asScanned.find((r) => r.roomId === "b")!.reason).toMatch(/opens off a room/);
    const narrowToo = graph([{ a: "l", b: "h", kind: "door", widthIn: 24 }, { a: "h", b: "b", kind: "door", widthIn: 26 }]);
    expect(checkAccess(narrowToo)!.asScanned.find((r) => r.roomId === "b")!.reason).toMatch(/24\.0 in clear.*and it opens off/);
  });

  it("skips scans with no door widths, and starts from the largest room without an entry", () => {
    expect(checkAccess(graph([{ a: "l", b: "h", kind: "door" }]))).toBeNull();
    expect(status(graph([{ a: "l", b: "h", kind: "door", widthIn: 36 }], [])).h).toBe("reachable");
  });
});

describe("checkAccess on real-scan shapes", () => {
  const inside = [{ a: "l", b: "h", kind: "door" as const, widthIn: 36 }, { a: "h", b: "b", kind: "door" as const, widthIn: 36 }];

  it("stops at a front door the chair can't fit through, and says hinges would fix a near miss", () => {
    const narrow = checkAccess(graph(inside, [{ roomId: "l", widthIn: 26 }]))!;
    expect(narrow.entry).toMatchObject({ status: "blocked", clearIn: 24, roomId: "l" });
    expect(narrow.asScanned.every((r) => r.status === "blocked" && r.stopDoor?.from === "outside")).toBe(true);
    expect(narrow.asScanned[0].reason).toMatch(/outside door is ~24\.0 in clear, 3\.0 in short/);
    const close = checkAccess(graph(inside, [{ roomId: "l", widthIn: 28.5 }]))!;
    expect([close.entry.status, close.hingesEntry.status]).toEqual(["blocked", "fits"]);
  });

  it("treats a front door with no measured width as unknown but still lets the chair in", () => {
    const a = checkAccess(graph(inside, [{ roomId: "l" }]))!;
    expect(a.entry.status).toBe("unknown");
    expect(a.asScanned.find((r) => r.roomId === "b")!.status).toBe("reachable");
  });

  it("takes no door-leaf allowance off a cased opening, and gives it no hinge gain", () => {
    const g = graph([{ a: "l", b: "h", kind: "door", widthIn: 27, open: true }, { a: "h", b: "b", kind: "door", widthIn: 26, open: true }]);
    expect(status(g)).toMatchObject({ h: "reachable", b: "blocked" });
    expect(status(g, "hinges").b).toBe("blocked");
  });

  it("blocks rooms on a floor the chair can't reach instead of calling them unmeasured", () => {
    const g = graph(inside);
    g.rooms = [...g.rooms, { ...room("up", "bedroom"), floorId: "f2" }];
    const up = checkAccess(g)!.asScanned.find((r) => r.roomId === "up")!;
    expect(up).toMatchObject({ status: "blocked", otherFloor: true });
    expect(up.reason).toMatch(/another floor/);
  });

  it("explains an unmeasured room that shares an open wall with a reached living space", () => {
    const g = graph([...inside, { a: "l", b: "k", kind: "possible" }]);
    g.rooms = [...g.rooms, room("k", "kitchen")];
    const k = checkAccess(g)!.asScanned.find((r) => r.roomId === "k")!;
    expect(k.status).toBe("unknown");
    expect(k.reason).toMatch(/likely open plan/);
  });
});

describe("turnCircleIn", () => {
  it("is the short side of a rectangle, in inches", () => {
    expect(turnCircleIn(room("ba", "bathroom", 1.5, 2))).toBeCloseTo(59.1, 0);
    expect(turnCircleIn(room("ba", "bathroom", 2.5, 3))).toBeCloseTo(98.4, 0);
  });
});

describe("doorPoint", () => {
  const at = (id: string, x: number, y = 0): Room => ({ ...room(id, "office"), polygon: [{ x, y }, { x: x + 4, y }, { x: x + 4, y: y + 4 }, { x, y: y + 4 }] });
  // a | b share the wall x=4; c sits apart. Scan polygons can stop short, so a measured centre may miss one room.
  const g = { ...graph([]), rooms: [at("a", 0), at("b", 4), at("c", 20)] };

  it("keeps a measured centre on the shared wall and snaps one that misses a room's outline onto it", () => {
    expect(doorPoint(g, "a", "b", { x: 4, y: 2 })).toEqual({ x: 4, y: 2 });
    const p = doorPoint(g, "a", "b", { x: 8, y: 2 })!; // on b's far wall, nowhere near a
    expect(Math.abs(p.x - 4)).toBeLessThan(0.01);
    expect(doorPoint(g, "a", "c", { x: 20, y: 2 })).toBeNull();
  });

  it("drops an outside door that lands inside another room", () => {
    expect(doorPoint(g, "a", null, { x: 0, y: 2 })).toEqual({ x: 0, y: 2 });
    expect(doorPoint(g, "c", null, { x: 6, y: 2 })).toBeNull();
  });
});
