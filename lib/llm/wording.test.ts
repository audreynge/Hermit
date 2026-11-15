import { expect, it } from "vitest";
import { cleanWording } from "./wording";

it("keeps lease guarantee terms but scrubs guarantee claims", () => {
  expect(cleanWording("You must sign a personal guarantee; the guarantor pays.")).toBe("You must sign a personal guarantee; the guarantor pays.");
  expect(cleanWording("Guarantees are capped.")).toBe("Guarantees are capped.");
  expect(cleanWording("It is guaranteed to fit and we guarantee approval.")).toBe("It is expected to fit and we expect approval.");
});
