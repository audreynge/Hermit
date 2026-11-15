import { describe, expect, it } from "vitest";
import { isLayoutEdit, localCommand } from "./commands";

describe("localCommand", () => {
  it("routes quick replies and parcel questions locally", () => {
    expect(localCommand("Search with this")).toBe("search");
    expect(localCommand("search now")).toBe("search");
    expect(localCommand("Find matches")).toBe("search");
    expect(localCommand("start over")).toBe("reset");
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

describe("isLayoutEdit", () => {
  it("is true for requests to change rooms or furniture", () => {
    for (const t of [
      "add a bathroom", "make the kitchen bigger", "move reception to the front", "2 more exam rooms", "remove the storage room",
      "one fewer office", "rename the office to a conference room", "turn the office into an exam room", "put a sink in the kitchen",
      "Can you add another exam room?", "make the exam rooms a bit smaller", "let me edit the layout", "delete the hallway",
    ]) expect(isLayoutEdit(t), t).toBe(true);
  });
  it("is false for questions, search changes and chatter", () => {
    for (const t of [
      "what does the kitchen look like?", "how big is the reception?", "do I need a bathroom?", "hi there", "make it 2,500 sq ft",
      "make it bigger", "change the city to Los Angeles", "make room for 10 people", "add space for 12 employees", "find a bigger office", "show me #2", "save the second one", "start over", "",
    ]) expect(isLayoutEdit(t), t).toBe(false);
  });
});
