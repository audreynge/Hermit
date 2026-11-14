import { describe, expect, it } from "vitest";
import { checkAccess, turnCircleIn } from "./access";
import type { Room, RoomGraph } from "../types";

const room = (id: string, label: string, w = 4, h = 4): Room => ({
  id, label, rawTags: [], areaSqft: w * h * 10.76, polygon: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], floorId: "f",
});
const graph = (edges: RoomGraph["edges"], entry = ["l"]): RoomGraph => ({
  sid: "G", name: "G", totalAreaSqft: 0, objects: [], panoCount: 0, floorCount: 1, entryRoomIds: entry, edges,
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

describe("turnCircleIn", () => {
  it("is the short side of a rectangle, in inches", () => {
    expect(turnCircleIn(room("ba", "bathroom", 1.5, 2))).toBeCloseTo(59.1, 0);
    expect(turnCircleIn(room("ba", "bathroom", 2.5, 3))).toBeCloseTo(98.4, 0);
  });
});
