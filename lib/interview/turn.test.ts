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

describe("interview flow", () => {
  const blank = { mode: "business" as const, useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" as const };
  const run = async (state: Parameters<typeof interviewTurn>[0], text: string | null) => interviewTurn(state, text, []);

  it("asks rooms and bathrooms right after use and city, with no suggestion chips", async () => {
    let t = await run({ spec: blank, asked: [], history: [] }, null);
    expect(t.state.field).toBe("city");
    t = await run(t.state, "Houston");
    expect(t.state.field).toBe("use");
    t = await run(t.state, "a salon");
    expect(t.state.field).toBe("rooms");
    t = await run(t.state, "4 styling stations and a storage room");
    expect(t.state.field).toBe("baths");
    t = await run(t.state, "two");
    expect(t.state.spec.rooms.find((r) => r.label === "bathroom")?.count).toBe(2);
    expect(t.state.field).toBe("size");
    expect(t.quick).toEqual([]);
    expect(t.reply).not.toMatch(/e\.g\./);
  });

  it("progress climbs and hits 100 only when ready; deeper questions follow", async () => {
    let t = await run({ spec: blank, asked: [], history: [] }, "a salon in Houston");
    const seen = [t.progress!];
    for (const a of ["typical layout works", "2000 sq ft", "asap", "no", "no", "$40", "6", "nothing"]) {
      t = await run(t.state, a);
      seen.push(t.progress!);
      if (t.ready) break;
    }
    expect(t.ready).toBe(true);
    expect(seen.at(-1)).toBe(100);
    expect(seen.slice(0, -1).every((p) => p < 100)).toBe(true);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(t.state.field).toBeTruthy();
    expect(t.reply).toContain("Walk inside the matches");
    expect(t.reply.trim().endsWith("?")).toBe(true);
  });
});
