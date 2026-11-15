import { describe, expect, it } from "vitest";
import { alsoFits } from "./reverse";
import type { Room, RoomGraph, Shell } from "./types";

const room = (id: string, label: string, areaSqft: number): Room => ({ id, label, rawTags: [label], areaSqft, polygon: [], floorId: "f" });
const graph = (rooms: Room[], objects: RoomGraph["objects"] = []): RoomGraph => ({ sid: "g", name: "g", totalAreaSqft: rooms.reduce((s, r) => s + r.areaSqft, 0), rooms, edges: [], objects, panoCount: 8, floorCount: 1 });
const shell: Pick<Shell, "city" | "mode" | "useTags"> = { city: "houston", mode: "business", useTags: ["office"] };

describe("alsoFits", () => {
  // A small office suite: two private offices, a conference room, a break kitchen, a restroom and an open area.
  const office = graph([room("o1", "office", 120), room("o2", "office", 110), room("c", "conference", 200), room("k", "kitchen", 80), room("b", "bathroom", 50), room("op", "open", 600)]);

  it("names other uses the space is already built for, never the current one", () => {
    const out = alsoFits(shell, office, "medical clinic");
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.map((f) => f.use)).not.toContain("medical");
    const o = out.find((f) => f.use === "office");
    expect(o?.why).toBe("Its open floor, 2 offices, conference, kitchen with a sink and restroom are already built.");
  });

  it("returns nothing when no use fits well", () => {
    expect(alsoFits(shell, graph([room("x", "other", 300)]), "office")).toEqual([]);
  });

  it("only offers warehouse uses for industrial buildings", () => {
    const shop = graph([room("op", "open", 3000), room("o", "office", 120), room("b", "bathroom", 50)]);
    expect(alsoFits(shell, shop, "retail").map((f) => f.use)).not.toContain("warehouse");
    const ind = alsoFits({ ...shell, mode: "enterprise", useTags: ["warehouse"] }, shop, "retail");
    expect(ind.map((f) => f.use)).toContain("warehouse");
    expect(ind.map((f) => f.use)).not.toContain("manufacturing"); // same program as warehouse, said once
  });
});
