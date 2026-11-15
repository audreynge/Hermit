import { describe, expect, it } from "vitest";
import { fromPlacement, glyphFor, migrate, toFootprint } from "./footprint";

const room = { id: "r1", polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }] };

describe("fromPlacement / toFootprint", () => {
  it("round-trips a 2D placement through the 3D item", () => {
    const p = fromPlacement({ id: "x", roomId: "r1", type: "table", x: 1, y: 0.5, w: 1.2, h: 0.9 }, [{ id: "f3" }]);
    expect(p.id).toBe("f4");
    expect(p.pos).toEqual({ x: 1.6, y: 0, z: -0.95 });
    const f = toFootprint(p, [room]);
    expect(f).toMatchObject({ id: "f4", roomId: "r1", type: "table", w: 1.2, h: 0.9 });
    expect(f.x).toBeCloseTo(1);
    expect(f.y).toBeCloseTo(0.5);
  });

  it("swaps the footprint's sides when the item is turned a quarter", () => {
    const p = { ...fromPlacement({ id: "x", roomId: "r1", type: "desk", x: 0, y: 0, w: 1.5, h: 0.75 }, []), rotY: 90 };
    expect(toFootprint(p)).toMatchObject({ w: 0.75, h: 1.5 });
  });
});

describe("glyphFor", () => {
  it("maps names to the closest 2D glyph and keeps unknown names", () => {
    expect(glyphFor("Walnut dining table")).toBe("table");
    expect(glyphFor("salon styling chair")).toBe("styling chair");
    expect(glyphFor("noodle cooker")).toBe("noodle cooker");
  });
});

describe("migrate", () => {
  it("keeps 3D items and converts old 2D placements", () => {
    const keep = fromPlacement({ id: "x", roomId: "r1", type: "chair", x: 0, y: 0, w: 0.6, h: 0.6 }, []);
    const out = migrate([keep, { id: "p1", roomId: "r1", type: "sofa", x: 1, y: 1, w: 1.8, h: 0.9 }, null, "junk"]);
    expect(out.map((p) => [p.id, p.name])).toEqual([["f1", "chair"], ["f2", "sofa"]]);
    expect(migrate("nope")).toEqual([]);
  });
});
