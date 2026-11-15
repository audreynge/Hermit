import { expect, it } from "vitest";
import { cachedRun } from "./cached-runs";

it("matches a demo prompt regardless of case, spacing and punctuation", () => {
  expect(cachedRun("  we need a NEW office in houston for our medical billing company which has outgrown its current space. We want to lease 4,800 to 5,800 square feet for 25 employees, ideally in a medical office building since our clients are doctors. We need a reception area, 3 private offices, 1 conference room, 2 kitchens, 2 storage rooms for paper records and 2 bathrooms, with the rest as an open work area for our billing team. We need on-site parking for 25 cars and an elevator. We don't have walk-in customers. Our budget is about $12,000 a month for rent, and we'd like to move in within 1 to 3 months on a 3 to 5 year lease. That's everything, so search now")).toBe("medbill");
  expect(cachedRun("office in Houston")).toBeUndefined();
});
