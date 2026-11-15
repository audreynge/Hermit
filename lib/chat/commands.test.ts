import { describe, expect, it } from "vitest";
import { localCommand } from "./commands";

describe("localCommand", () => {
  it("routes quick replies and parcel questions locally", () => {
    expect(localCommand("Search with this")).toBe("search");
    expect(localCommand("Undo")).toBe("undo");
    expect(localCommand("undo the last change")).toBe("undo");
    expect(localCommand("Keep these changes")).toBe("keep");
    expect(localCommand("Open the layout")).toBe("studio");
    expect(localCommand("Draw a layout")).toBe("studio");
    expect(localCommand("what's the APN?")).toBe("parcel");
    expect(localCommand("what are the property taxes")).toBe("parcel");
  });
  it("leaves everything else to the chat", () => {
    expect(localCommand("Compare the layouts")).toBeNull();
    expect(localCommand("make it 3 exam rooms")).toBeNull();
    expect(localCommand("what's parking like")).toBeNull();
    expect(localCommand("please undo nothing, just search")).toBeNull();
  });
});
