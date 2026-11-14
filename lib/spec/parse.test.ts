import { describe, expect, it } from "vitest";
import { fromLayout, parseText } from "./parse";

const room = (spec: ReturnType<typeof parseText>, label: string) => spec.rooms.find((r) => r.label === label);

describe("parseText", () => {
  it("parses a business request with rooms, fixtures, size and city", () => {
    const s = parseText("Dental clinic in Houston, 2,000-3,000 sq ft, 3 exam rooms with sinks, a waiting room, 2 restrooms, wheelchair accessible");
    expect(s).toMatchObject({ mode: "business", city: "houston", useType: "dental clinic", sizeSqft: [2000, 3000], input: "text" });
    expect(room(s, "exam room")).toMatchObject({ count: 3, fixtures: ["sink"] });
    expect(room(s, "reception")?.count).toBe(1);
    expect(room(s, "bathroom")).toMatchObject({ count: 2, hard: true });
    expect(s.needs.wheelchair).toBe(true);
  });

  it("detects enterprise needs", () => {
    const s = parseText("Need a 20,000 sf warehouse in LA with heavy power, ESFR sprinklers and 2 drive-in doors, 30 parking spaces");
    expect(s).toMatchObject({ mode: "enterprise", city: "los_angeles", useType: "warehouse" });
    expect(s.sizeSqft?.[0]).toBeLessThanOrEqual(20000);
    expect(s.sizeSqft?.[1]).toBeGreaterThanOrEqual(20000);
    expect(s.needs).toMatchObject({ heavyPower: true, esfr: true, driveInBays: 2, parkingStalls: 30 });
  });

  it("parses a home search with beds, baths and budget", () => {
    const s = parseText("3 bedroom 2 bath house in Houston under $450k with a home office");
    expect(s).toMatchObject({ mode: "home", city: "houston", beds: 3, baths: 2, budgetTotal: 450000 });
    expect(room(s, "office")?.count).toBe(1);
  });

  it("reads a monthly budget and a headcount-derived size", () => {
    const s = parseText("Creative office for 12 people in Los Angeles, $9,000/month");
    expect(s.budgetMonthly).toBe(9000);
    expect(s.headcount).toBe(12);
    expect(s.sizeSqft).toEqual([1800, 3000]);
  });

  it("falls back to defaults and keeps the raw text", () => {
    const s = parseText("something nice", { city: "los_angeles", mode: "business" });
    expect(s).toMatchObject({ city: "los_angeles", mode: "business", useType: "office", rawText: "something nice" });
  });

  it("parses 'about N square feet' as a ±20% range", () => {
    expect(parseText("hair salon about 1500 square feet").sizeSqft).toEqual([1200, 1800]);
  });
});

describe("fromLayout", () => {
  it("turns drawn blocks into sized rooms with adjacency for touching blocks", () => {
    const s = fromLayout(
      [
        { id: "a", label: "exam room", x: 0, y: 0, w: 10, h: 12 },
        { id: "b", label: "exam room", x: 10, y: 0, w: 10, h: 12 },
        { id: "c", label: "storage", x: 40, y: 40, w: 5, h: 5 },
      ],
      { mode: "business", city: "houston", useType: "medical clinic" },
    );
    expect(s.input).toBe("layout");
    const exam = s.rooms.find((r) => r.label === "exam room")!;
    expect(exam.count).toBe(2);
    expect(exam.minSqft).toBe(102);
    expect(exam.adjacentTo).toContain("exam room");
    expect(s.rooms.find((r) => r.label === "storage")?.adjacentTo ?? []).toEqual([]);
    expect(s.sizeSqft?.[0]).toBe(265);
  });
});
