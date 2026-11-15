import { describe, expect, it } from "vitest";
import { intent, screenText } from "./report-chat";

describe("report chat intent", () => {
  it("routes walls and fixtures to the fit-out editor", () => {
    expect(intent("merge the two offices")).toBe("edit");
    expect(intent("turn the bedroom into an exam room")).toBe("edit");
    expect(intent("add a sink to exam room 2")).toBe("edit");
  });
  it("routes furniture to the 3D tour", () => {
    expect(intent("put a sofa here")).toBe("furnish");
    expect(intent("furnish the whole space")).toBe("furnish");
  });
  it("answers questions", () => {
    expect(intent("how much is rent?")).toBe("ask");
    expect(intent("is there a desk in the office?")).toBe("ask");
  });
});

describe("report chat screen context", () => {
  it("names the tab, the tour, a fit-out proposal and the search brief", () => {
    const s = screenText({
      tab: "inside", tour: "3D tour, walking view; in the Office 1; placed: 2 desk, 1 sofa.", told: "office; 30 people",
      fit: { kept: false, changes: 1, nowMatched: ["exam room"], stillMissing: [] },
    });
    expect(s).toContain("Open tab: Inside (3D tour and fit check).");
    expect(s).toContain("placed: 2 desk, 1 sofa");
    expect(s).toContain("Proposed fit-out (not kept yet): 1 change; now matched: exam room; still missing: none.");
    expect(s).toContain("What they told Hermit while searching: office; 30 people.");
  });
  it("is just the tab when nothing else is on screen", () => {
    expect(screenText({ tab: "lease" })).toBe("Open tab: Lease coach.");
  });
});
