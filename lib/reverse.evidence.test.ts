import { describe, expect, it } from "vitest";
import { alsoFitsFromEvidence } from "./reverse";
import type { RoomGraph } from "./types";

const sq = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }];
const room = (id: string, label: string, areaSqft: number) => ({ id, label, rawTags: [], areaSqft, polygon: sq });
const graph = (rooms: ReturnType<typeof room>[]) => ({ sid: "s", rooms, edges: [] }) as unknown as RoomGraph;

describe("alsoFitsFromEvidence", () => {
  const g = graph([room("a", "other", 120), room("b", "other", 140), room("c", "office", 100), room("d", "bathroom", 60), room("big", "other", 900)]);
  const sinks = [{ roomId: "a", feature: "sink", result: "seen" }, { roomId: "b", feature: "sink", result: "seen" }];

  it("offers a dental office for private rooms with sinks seen, never the user's own use", () => {
    const out = alsoFitsFromEvidence(g, sinks, "pediatric clinic");
    expect(out[0]).toEqual({ use: "dental", label: "Dental office", why: "Its 2 private rooms with sinks seen in the scan photos, and a restroom." });
    expect(out.some((o) => o.use === "medical")).toBe(false);
    expect(out).toHaveLength(2);
  });

  it("counts only seen sinks and private-sized rooms", () => {
    const out = alsoFitsFromEvidence(g, [{ roomId: "big", feature: "sink", result: "seen" }, { roomId: "a", feature: "sink", result: "unclear" }], "office");
    expect(out.map((o) => o.use)).toEqual(["therapy"]);
    expect(out[0].why).toBe("Its 3 private rooms off a hallway and a restroom.");
  });

  it("returns nothing without a restroom or enough rooms", () => {
    expect(alsoFitsFromEvidence(graph([room("a", "other", 120), room("b", "other", 120)]), sinks, "salon")).toEqual([]);
  });
});
