import { describe, expect, it } from "vitest";
import { tourSteps, tourUrl } from "./matterport";
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

describe("tourSteps", () => {
  it("walks each requested room at its first sweep, then wraps up", () => {
    const steps = tourSteps({ ...report, name: "Elm St · suite", unknowns: [] } as unknown as ShellReport);
    expect(steps.map((s) => [s.room, s.sweep])).toEqual([[undefined, undefined], ["exam room 1", 8], ["exam room 2", undefined], ["storage", undefined], [undefined, undefined]]);
    expect(steps[2].text).toMatch(/^This is where your exam room 2 would go/);
    expect(steps[3].text).toMatch(/isn't built here yet/);
  });
});
