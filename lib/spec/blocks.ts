import { FURNITURE, type Furn, type FurnType } from "./furnish";
import type { Block } from "./parse";
import type { SketchRoom } from "./sketch";
import type { RoomReq } from "../types";

// The studio keeps its sketch as rooms + furniture (what the report tabs read); Layout Studio edits Blocks.
const TO_STUDIO: Record<string, string> = { "exam table": "exam bed" };
const FROM_STUDIO: Record<string, FurnType> = { "exam bed": "exam table" };
const FURN = new Set<string>(FURNITURE.map((f) => f.type));
const FIXTURES = new Set<string>(FURNITURE.filter((f) => f.fixture).map((f) => f.type));
const inside = (o: Block, r: Block) => o.x + o.w / 2 >= r.x && o.x + o.w / 2 <= r.x + r.w && o.y + o.h / 2 >= r.y && o.y + o.h / 2 <= r.y + r.h;

export function sketchToBlocks(layout: SketchRoom[], furniture: Furn[], extras: Block[] = []): Block[] {
  return [
    ...layout.map((r) => ({ id: r.key, kind: "room" as const, label: r.label, x: r.x, y: r.y, w: r.w, h: r.h })),
    ...furniture.map((f) => ({ id: f.id, kind: "object" as const, label: TO_STUDIO[f.type] ?? f.type, x: f.x, y: f.y, w: f.w, h: f.h })),
    ...extras,
  ];
}

// Rooms come back pinned and user-sized, keyed like toLayout ("label#i") so the interview can keep re-flowing around them.
// Objects that are furniture become Furn; the rest (doors, windows, kitchenettes) ride along as extras.
export function blocksToSketch(blocks: Block[]): { layout: SketchRoom[]; furniture: Furn[]; extras: Block[] } {
  const seen: Record<string, number> = {};
  const layout = blocks.filter((b) => b.kind !== "object").map((b) => {
    const index = (seen[b.label] = (seen[b.label] ?? -1) + 1);
    return { key: `${b.label}#${index}`, label: b.label, index, x: b.x, y: b.y, w: b.w, h: b.h, fixtures: [], pinned: true, sized: true };
  });
  const furniture: Furn[] = [], extras: Block[] = [];
  for (const b of blocks) {
    if (b.kind !== "object") continue;
    const type = FROM_STUDIO[b.label] ?? (FURN.has(b.label) ? (b.label as FurnType) : null);
    if (type) furniture.push({ id: b.id, type, x: b.x, y: b.y, w: b.w, h: b.h });
    else extras.push(b);
  }
  return { layout, furniture, extras };
}

// Room requirements from a drawing: counts per label, keeping what the interview already knew (hard flags, sizes),
// and a fixture placed inside a room becomes a fixture that room needs.
export function roomsFromBlocks(blocks: Block[], prev: RoomReq[]): RoomReq[] {
  const objects = blocks.filter((b) => b.kind === "object");
  const groups = new Map<string, Block[]>();
  for (const b of blocks) if (b.kind !== "object") groups.set(b.label, [...(groups.get(b.label) ?? []), b]);
  return [...groups].map(([label, bs]) => {
    const old = prev.find((r) => r.label === label);
    const placed = objects.filter((o) => FIXTURES.has(FROM_STUDIO[o.label] ?? o.label) && bs.some((b) => inside(o, b))).map((o) => FROM_STUDIO[o.label] ?? o.label);
    const fixtures = [...new Set([...(old?.fixtures ?? []), ...placed])];
    const base: RoomReq = old ?? { label, count: 1, hard: false, minSqft: Math.round(Math.min(...bs.map((b) => b.w * b.h)) * 0.85) };
    return { ...base, count: bs.length, ...(fixtures.length ? { fixtures } : {}) };
  });
}
