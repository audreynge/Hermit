import { describe, expect, it } from "vitest";
import { showsFootTraffic } from "./relevance";

describe("showsFootTraffic", () => {
  it("hides heat for homes, industrial uses and plain offices", () => {
    expect(showsFootTraffic("home", "home", "apartment")).toBe(false);
    expect(showsFootTraffic("enterprise", "warehouse", "warehouse")).toBe(false);
    expect(showsFootTraffic("enterprise", "manufacturing", "light industrial")).toBe(false);
    expect(showsFootTraffic("business", "office", "office")).toBe(false);
    expect(showsFootTraffic("business", "office", "")).toBe(false);
  });
  it("shows heat for walk-in uses, including ones that fall back to the office category", () => {
    expect(showsFootTraffic("business", "salon", "salon")).toBe(true);
    expect(showsFootTraffic("business", "medical", "medical clinic")).toBe(true);
    expect(showsFootTraffic("business", "retail", "retail")).toBe(true);
    expect(showsFootTraffic("business", "office", "daycare")).toBe(true);
  });
});
