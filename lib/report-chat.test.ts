import { describe, expect, it } from "vitest";
import { intent } from "./report-chat";

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
