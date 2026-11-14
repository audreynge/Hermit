import { describe, expect, it } from "vitest";
import { roomStops, tourUrl } from "./matterport";
import type { ShellReport } from "../types";

const report = {
  inside: { sid: "ABC123" },
  fit: { assignment: [{ req: "exam room #1", roomId: "r1", cost: 0 }, { req: "exam room #2", roomId: "r2", cost: 0 }, { req: "storage", roomId: null, cost: 70 }] },
  floorplan: { rooms: [
    { id: "r1", label: "office", sweeps: [{ id: "p1", index: 8 }, { id: "p2", index: 9 }] },
    { id: "r2", label: "office", sweeps: [] },
    { id: "r3", label: "bathroom", sweeps: [{ id: "p9", index: 30 }] },
  ] },
} as unknown as ShellReport;

describe("tourUrl", () => {
  it("builds the Showcase embed, starting at a sweep when given", () => {
    expect(tourUrl("ABC123")).toBe("https://my.matterport.com/show/?m=ABC123&play=1&qs=1&brand=0");
    expect(tourUrl("ABC123", 8)).toBe("https://my.matterport.com/show/?m=ABC123&play=1&qs=1&brand=0&ss=8");
  });

  it("refuses ids that are not Matterport sids", () => {
    expect(() => tourUrl("../evil")).toThrow();
  });
});

describe("roomStops", () => {
  it("lists the requested rooms that map to a scanned room with a sweep, then other scanned rooms", () => {
    expect(roomStops(report)).toEqual([
      { label: "Exam room #1", index: 8 },
      { label: "Bathroom", index: 30 },
    ]);
  });

  it("is empty without a scan", () => {
    expect(roomStops({ ...report, floorplan: undefined } as ShellReport)).toEqual([]);
  });
});
