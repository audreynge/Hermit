import { describe, expect, it, vi } from "vitest";
vi.mock("../llm/gemini", () => ({ hasGemini: () => false, generateJSON: vi.fn() }));
import { interviewTurn } from "./turn";

describe("interview sketch", () => {
  it("resizes the sketch when the team grows past the drawn space", async () => {
    const spec = { mode: "business" as const, useType: "office", city: "houston" as const, sizeSqft: [1000, 2500] as [number, number], rooms: [], needs: {}, priorities: {}, input: "chat" as const };
    const t = await interviewTurn({ spec, asked: ["city", "use", "size", "accessibility", "musts", "moveIn", "parking"], history: [], ready: true }, "map it out for a team of 50 engineers", []);
    expect(t.state.spec.headcount).toBe(50);
    expect(t.state.spec.sizeSqft![0]).toBeGreaterThanOrEqual(7500);
    expect(t.state.spec.rooms.find((r) => r.label === "open")!.minSqft).toBeGreaterThanOrEqual(2000);
    expect(t.reply).toContain("Sketch on the right");
  });
});
