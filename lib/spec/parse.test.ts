import { describe, expect, it } from "vitest";
import { fromLayout, parseText, parseChairWidth } from "./parse";

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

describe("fromLayout with objects", () => {
  it("turns objects inside rooms into fixtures and skips hallways and furniture", () => {
    const s = fromLayout(
      [
        { id: "r", label: "reception", x: 0, y: 0, w: 30, h: 10 },
        { id: "e1", label: "exam room", x: 0, y: 10, w: 10, h: 10 },
        { id: "e2", label: "exam room", x: 0, y: 20, w: 10, h: 10 },
        { id: "h", label: "hallway", x: 10, y: 10, w: 6, h: 20 },
        { id: "w", label: "waiting area", x: 16, y: 10, w: 8, h: 8 },
        { id: "s1", label: "sink", kind: "object", x: 7, y: 12, w: 2, h: 2 },
        { id: "c1", label: "chair", kind: "object", x: 2, y: 2, w: 2, h: 2 },
      ],
      { mode: "business", city: "houston", useType: "medical clinic" },
    );
    expect(s.rooms.map((r) => r.label).sort()).toEqual(["exam room", "reception"]);
    expect(s.rooms.find((r) => r.label === "exam room")).toMatchObject({ count: 2, fixtures: ["sink"] });
    expect(s.rooms.find((r) => r.label === "reception")?.count).toBe(2);
    expect(s.rooms.find((r) => r.label === "exam room")?.adjacentTo ?? []).not.toContain("hallway");
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
  it("reads the chair width from free text and sanity-checks it", () => {
    expect(parseText("3 bed home in Houston for my 26 inch wheelchair").needs).toMatchObject({ wheelchair: true, chairWidthIn: 26 });
    expect(parseText("my chair is 25.5 in wide").needs.chairWidthIn).toBe(25.5);
    expect(parseText("I use a power chair").needs.chairWidthIn).toBe(27);
    expect(parseText("a 60 inch wheelchair").needs.chairWidthIn).toBeUndefined();
    expect(parseText("2,000-3,000 sq ft, wheelchair accessible").needs.chairWidthIn).toBeUndefined();
    expect(parseChairWidth("Manual (~25 in)", true)).toBe(25);
    expect(parseChairWidth("26", true)).toBe(26);
    expect(parseChairWidth("26")).toBeUndefined(); // a bare number only counts as an answer to the chair question
    expect(parseChairWidth("I'll measure later", true)).toBeUndefined();
  });
});
