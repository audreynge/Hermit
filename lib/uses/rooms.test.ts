import { describe, expect, it } from "vitest";
import type { RoomGraph, ShellReport } from "../types";
import { fitLead, fitRows } from "./rooms";

const room = (id: string, label: string) => ({ id, label, areaSqft: 100 }) as RoomGraph["rooms"][number];
const report = {
  fit: { score: 70, edits: [], breakdown: {}, hardFails: [], unknowns: [], assignment: [
    { req: "exam room #1", roomId: "r1", cost: 15 }, { req: "exam room #2", roomId: "r2", cost: 15 },
    { req: "bathroom", roomId: "r3", cost: 0 }, { req: "reception", roomId: "r4", cost: 0 }, { req: "lab", roomId: null, cost: 70 },
  ] },
  floorplan: { rooms: [room("r1", "other"), room("r2", "other"), room("r3", "bathroom"), room("r4", "reception")] } as RoomGraph,
} as Pick<ShellReport, "fit" | "floorplan">;

describe("Will it fit?", () => {
  it("separates rooms already built from rooms that could become them", () => {
    const rows = fitRows(report);
    expect(rows.built).toEqual(["bathroom", "reception"]);
    expect(rows.convert).toEqual([{ req: "exam room #1", from: "an unlabeled room" }, { req: "exam room #2", from: "an unlabeled room" }]);
    expect(rows.toBuild).toEqual(["lab"]);
    expect(fitLead(rows)).toBe("2 of the 5 rooms you want are already built. 2 more could be made from rooms that are here. 1 would need to be built new.");
  });

  it("never calls a matched room built when the scan can't say what it is", () => {
    const rows = fitRows({ ...report, floorplan: undefined });
    expect(rows.built).toEqual([]);
    expect(rows.convert).toHaveLength(4);
  });
});
