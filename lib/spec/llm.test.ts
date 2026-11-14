import { describe, expect, it } from "vitest";
import { fromLlm, specFromText } from "./llm";

describe("fromLlm", () => {
  it("converts Claude's flat extraction into a validated RequirementSpec", () => {
    const s = fromLlm(
      { mode: "business", city: "houston", useType: "dental clinic", sizeMinSqft: 2000, sizeMaxSqft: 3000, headcount: null, beds: null, baths: null,
        budgetMonthly: 8000, budgetTotal: null, rooms: [{ label: "exam room", count: 3, minSqft: null, fixtures: ["sink"], hard: false }],
        needs: { kitchen: null, threePhase: null, heavyPower: null, parkingStalls: 10, groundFloor: null, stepFree: null, wheelchair: true, outdoorArea: null, driveInBays: null, esfr: null } },
      "raw",
    );
    expect(s).toMatchObject({ sizeSqft: [2000, 3000], budgetMonthly: 8000, needs: { parkingStalls: 10, wheelchair: true }, input: "text", rawText: "raw" });
    expect(s.rooms[0]).toEqual({ label: "exam room", count: 3, fixtures: ["sink"], hard: false });
    expect("headcount" in s).toBe(false);
  });
});

describe("specFromText", () => {
  it("uses the deterministic parser when there is no client", async () => {
    const s = await specFromText("salon in Houston", {}, null);
    expect(s).toMatchObject({ city: "houston", useType: "salon" });
  });

  it("falls back to the deterministic parser when Claude errors", async () => {
    const client = { messages: { parse: async () => { throw new Error("boom"); } } };
    const s = await specFromText("salon in Houston", {}, client as never);
    expect(s.useType).toBe("salon");
  });
});
