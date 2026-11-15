import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../db";
import type { GeminiClient } from "../llm/gemini";
import type { RoomGraph } from "../types";
import { planRooms, type PlanRoom } from "./layout";
import { describeRoom, planFurnish } from "./plan";

const rect = (w: number, d: number, x = 0, y = 0) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }];
const room = (id: string, label: string, w: number, d: number, extra: Partial<PlanRoom> = {}): PlanRoom =>
  ({ id, label, polygon: rect(w, d), doors: [{ at: { x: w / 2, y: 0 }, width: 0.9 }], objects: [], ...extra });
function fake(json: unknown) {
  const seen: string[] = [];
  const g: GeminiClient = { model: "fake", generate: async (body) => { seen.push(JSON.stringify(body)); return { role: "model", parts: [{ text: JSON.stringify(json) }] }; } };
  return { g, seen };
}
type Add = { op: string; name: string; pos: { x: number; z: number }; rotY: number; size: { w: number; d: number; h: number } };
const names = (ops: object[]) => (ops as Add[]).map((o) => o.name);
const it2 = (o: object) => ({ terms: ["thing"], w: 0.5, d: 0.5, h: 0.5, count: 1, of: null, wall: null, priority: 1, ...o });

beforeEach(() => {
  process.env.HERMIT_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hermit-p-")), "h.db");
  closeDb();
});

describe("planFurnish", () => {
  it("caches Gemini's plan by use, request and room signature", async () => {
    const f = fake({ rooms: [{ roomId: "b", items: [it2({ key: "bed", name: "bed", w: 1.6, d: 2.1, h: 0.6, place: "wall" })] }] });
    const ask = (text: string, w = 4) => planFurnish({ text, use: "Home", rooms: [room("b", "bedroom", w, 4)], placed: [] }, f.g);
    const a = await ask("furnish this");
    const b = await ask("Furnish  this");
    expect(f.seen).toHaveLength(1);
    expect(b).toEqual(a);
    expect(b.source).toBe("gemini");
    await ask("furnish this", 5); // different room size
    expect(f.seen).toHaveLength(2);
  });

  it("offline: a once item that doesn't fit its room goes to the next public room", async () => {
    const rooms = [room("a", "reception", 1.2, 1.2), room("b", "living", 6, 4, { polygon: rect(6, 4, 2, 0) })];
    const out = await planFurnish({ text: "furnish everything", use: "dental practice", rooms, placed: [] }, null);
    const desks = (out.ops as Add[]).filter((o) => o.name === "reception desk");
    expect(desks).toHaveLength(1);
    expect(desks[0].pos.x).toBeGreaterThan(2); // in the second room
    expect(out.reply).not.toMatch(/No room for:.*reception desk/);
  });

  it("lays out Gemini's plan: validated, capped, positions in world coordinates", async () => {
    const f = fake({ rooms: [
      { roomId: "op", items: [
        it2({ key: "dc", name: "dental chair", terms: ["dental chair"], w: 0.8, d: 1.9, h: 1.2, place: "center" }),
        it2({ key: "st", name: "stool", place: "beside", of: "dc", count: 99 }),
        it2({ key: "bad", name: "!!!", place: "wall" }), // invalid name: dropped, plan kept
        it2({ key: "cab", name: "cabinet", w: 0.9, d: 0.45, h: 0.9, place: "wall", priority: 9 }),
      ] },
      { roomId: "nope", items: [it2({ key: "x", name: "sofa", place: "wall" })] }, // not a listed room
    ] });
    const out = await planFurnish({ text: "furnish this", use: "dentist", rooms: [room("op", "office", 3.2, 3.6)], placed: [] }, f.g);
    expect(out.source).toBe("gemini");
    expect(names(out.ops)).toEqual(expect.arrayContaining(["dental chair", "stool", "cabinet"]));
    expect(names(out.ops)).not.toContain("sofa");
    expect(names(out.ops).filter((n) => n === "stool").length).toBeLessThanOrEqual(6);
    for (const o of out.ops as Add[]) {
      expect(o.op).toBe("add");
      expect(o.pos.x).toBeGreaterThan(0); expect(o.pos.x).toBeLessThan(3.2);
      expect(-o.pos.z).toBeGreaterThan(0); expect(-o.pos.z).toBeLessThan(3.6); // plan y = -world z
    }
    expect(out.reply).toMatch(/^Placed dental chair, .*stool.*cabinet in the office\./); // from what was placed, not the model
    expect(out.reply).not.toMatch(/sofa/);
  });

  it("tells Gemini who the user is, what they asked, and each room's size, doors and contents", async () => {
    const f = fake({ rooms: [] });
    await planFurnish({
      text: "set this up as my ramen shop", use: "ramen shop",
      rooms: [room("k", "kitchen", 4, 3, { objects: ["sink", "stove"], ceiling: 2.7 })],
      placed: [{ name: "prep table", pos: { x: 1, z: -1 }, size: { w: 1.5, d: 0.76, h: 0.86 }, rotY: 0 }],
    }, f.g);
    const sent = f.seen[0];
    for (const s of ["ramen shop", "set this up as my ramen shop", "4.0 × 3.0 m", "12 m²", "ceiling 2.7 m", "1 door", "scan shows: sink, stove", "already placed: prep table"]) expect(sent).toContain(s);
  });

  it("falls back to templates by use when Gemini fails, and says so", async () => {
    const g: GeminiClient = { model: "fake", generate: async () => { throw new Error("quota"); } };
    const out = await planFurnish({ text: "furnish", use: "Ramen restaurant", rooms: [room("d", "open", 10, 8)], placed: [] }, g);
    expect(out.source).toBe("offline");
    expect(names(out.ops)).toContain("four top table");
    expect(names(out.ops)).toContain("chair");
    expect(out.reply).toMatch(/simple mode/);
    expect(out.ops.length).toBeLessThanOrEqual(30);
  });

  it("wheelchair: wider clearances are applied and the reply says so", async () => {
    const base = { text: "furnish", use: "Ramen restaurant", rooms: [room("d", "open", 10, 8)], placed: [] };
    const plain = await planFurnish(base, null), wide = await planFurnish({ ...base, access: { chairWidthIn: 26 } }, null);
    const tables = (ops: object[]) => names(ops).filter((x) => x === "four top table").length;
    expect(tables(wide.ops)).toBeGreaterThan(0); // counts vs plain aren't compared: both stop at the item budget
    expect(wide.reply).toMatch(/wheelchair-wide \(36 in\+\)/);
    expect(plain.reply).not.toMatch(/wheelchair/);
  });

  it("offline templates follow the use and the room", async () => {
    const plan = async (use: string, label: string, w = 4, d = 4) => names((await planFurnish({ text: "furnish", use, rooms: [room("r", label, w, d)], placed: [] }, null)).ops);
    expect(await plan("dental practice", "office")).toEqual(expect.arrayContaining(["dental chair", "stool"]));
    expect(await plan("dental practice", "reception")).toContain("reception desk");
    expect(await plan("hair salon", "open", 7, 5)).toEqual(expect.arrayContaining(["mirror", "styling chair"]));
    expect(await plan("", "bedroom")).toEqual(expect.arrayContaining(["bed", "nightstand"]));
    expect(await plan("home", "living", 5, 4)).toEqual(expect.arrayContaining(["sofa", "coffee table"]));
    expect(await plan("home", "bathroom")).toEqual([]);
    expect(await plan("home", "hallway", 6, 1.2)).toEqual([]);
  });

  it("doesn't repeat what's already placed and works around it", async () => {
    const out = await planFurnish({ text: "furnish", use: "home", rooms: [room("b", "bedroom", 4, 4)], placed: [{ name: "bed", pos: { x: 2, z: -2.9 }, size: { w: 1.6, d: 2.1, h: 0.6 }, rotY: 180 }] }, null);
    expect(names(out.ops)).not.toContain("bed");
  });

  it("whole place: shares the item budget across rooms, current room first", async () => {
    const rooms = [room("a", "open", 10, 8), room("b", "bedroom", 4, 4, { polygon: rect(4, 4, 10, 0) })];
    const out = await planFurnish({ text: "furnish everything", use: "cafe", rooms, placed: [] }, null);
    expect(out.ops.length).toBeLessThanOrEqual(30);
    expect(out.reply).toMatch(/2 rooms/);
  });

  it("no usable room outline: asks instead of guessing", async () => {
    const out = await planFurnish({ text: "furnish", use: "home", rooms: [room("x", "living", 1, 1, { polygon: [] })], placed: [] }, null);
    expect(out.ops).toEqual([]);
    expect(out.reply).toMatch(/floor plan/);
  });

  it("describeRoom flags irregular shapes", () => {
    const L = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2.5 }, { x: 2.5, y: 2.5 }, { x: 2.5, y: 6 }, { x: 0, y: 6 }];
    expect(describeRoom(room("l", "living", 1, 1, { polygon: L }), [])).toContain("irregular shape");
  });
});

describe("planRooms", () => {
  it("builds outline, ceiling, doors and scan objects from the room graph", () => {
    const g = {
      sid: "s", name: "n", totalAreaSqft: 0, panoCount: 0, floorCount: 1,
      rooms: [
        { id: "a", label: "living", rawTags: [], areaSqft: 0, polygon: rect(4, 4), floorId: "f", heightFt: 9 },
        { id: "b", label: "kitchen", rawTags: [], areaSqft: 0, polygon: rect(3, 4, 4, 0), floorId: "f" },
      ],
      edges: [{ a: "a", b: "b", kind: "door", widthIn: 36 }],
      objects: [{ label: "sofa", roomId: "a", confidence: 1 }, { label: "sofa", roomId: "a", confidence: 1 }, { label: "weird (label)", roomId: "a", confidence: 1 }, { label: "rre_kitchen_sink", roomId: "a", confidence: 1 }],
    } as RoomGraph;
    const [a] = planRooms(g, ["a", "missing"]);
    expect(a.ceiling).toBeCloseTo(2.743, 2);
    expect(a.doors).toHaveLength(1);
    expect(a.doors[0].at.x).toBeCloseTo(4); // on the shared wall
    expect(a.doors[0].width).toBeCloseTo(0.914, 2);
    expect(a.objects).toEqual(["sofa", "kitchen sink"]); // scan ids like rre_kitchen_sink made readable
  });

  it("offline reception: the receptionist's chair sits behind the desk, facing the room", async () => {
    const out = await planFurnish({ text: "furnish", use: "dental practice", rooms: [room("r", "reception", 6, 4)], placed: [] }, null);
    const ops = out.ops as Add[], desk = ops.find((o) => o.name === "reception desk")!, chair = ops.find((o) => o.name === "office chair")!;
    expect(chair.rotY).toBeCloseTo(desk.rotY);
    const a = (desk.rotY * Math.PI) / 180, f = { x: Math.sin(a), z: Math.cos(a) }; // world front
    expect((chair.pos.x - desk.pos.x) * f.x + (chair.pos.z - desk.pos.z) * f.z).toBeLessThan(0); // behind it
  });
});
