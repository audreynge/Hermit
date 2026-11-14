import { z } from "zod";
import type { Block } from "../spec/parse";
import { objectSize, objectType, roomName, roomSize, roomType } from "./rooms";

export const MAX_OPS = 10;
const MIN_SIDE = 3;
const MAX_SIDE = 200;

export const LayoutOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), label: z.string().min(1), count: z.number().int().min(1).max(5).optional(), w: z.number().optional(), h: z.number().optional(), nextTo: z.string().optional() }),
  z.object({ op: z.literal("remove"), id: z.string() }),
  z.object({ op: z.literal("resize"), id: z.string(), w: z.number().optional(), h: z.number().optional(), scale: z.number().optional() }),
  z.object({ op: z.literal("relabel"), id: z.string(), label: z.string().min(1) }),
  z.object({ op: z.literal("add_object"), label: z.string().min(1), in: z.string() }),
]);
export type LayoutOp = z.infer<typeof LayoutOp>;

export type Rejected = { op: unknown; reason: string };
export type LayoutResult = { blocks: Block[]; applied: LayoutOp[]; rejected: Rejected[]; notes: string[] };

const isRoom = (b: Block) => b.kind !== "object";
const overlaps = (a: Omit<Block, "id" | "label">, b: Block) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clamp = (v: number) => Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(v * 4) / 4));

/** Display name used in the chat and in the model's context, e.g. "Exam Room 2". Matches Layout Studio's naming. */
export function blockName(blocks: Block[], b: Block): string {
  if (!isRoom(b)) return roomName(b.label);
  const same = blocks.filter((x) => isRoom(x) && x.label === b.label);
  return same.length > 1 ? `${roomName(b.label)} ${same.indexOf(b) + 1}` : roomName(b.label);
}

/** Parses untrusted ops one by one, dedupes identical ones and caps the count; invalid shapes become rejections. */
export function parseOps<T>(raw: unknown[], schema: z.ZodType<T>, max = MAX_OPS): { ops: T[]; rejected: Rejected[] } {
  const ops: T[] = [];
  const rejected: Rejected[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    if (i >= max) return void rejected.push({ op: r, reason: `too many changes at once (max ${max}); split them up` });
    const p = schema.safeParse(r);
    if (!p.success) {
      const name = typeof r === "object" && r && "op" in r ? String((r as { op: unknown }).op) : "unknown";
      return void rejected.push({ op: r, reason: `"${name}" is not a change I can make here, or it's missing details` });
    }
    const key = JSON.stringify(p.data);
    if (seen.has(key)) return;
    seen.add(key);
    ops.push(p.data);
  });
  return { ops, rejected };
}

function place(blocks: Block[], w: number, h: number, nextTo?: Block): { x: number; y: number; touching: boolean } {
  const rooms = blocks.filter(isRoom);
  const free = (x: number, y: number) => x >= 0 && y >= 0 && !rooms.some((r) => overlaps({ x, y, w, h }, r));
  if (nextTo) {
    const t = nextTo;
    const spots: { x: number; y: number }[] = [];
    for (let d = 0; d < Math.max(t.w, t.h) + Math.max(w, h); d++) {
      spots.push({ x: t.x + t.w, y: t.y + d }, { x: t.x + d, y: t.y + t.h }, { x: t.x - w, y: t.y + d }, { x: t.x + d, y: t.y - h });
      if (d) spots.push({ x: t.x + t.w, y: t.y - d }, { x: t.x - d, y: t.y + t.h }, { x: t.x - w, y: t.y - d }, { x: t.x - d, y: t.y - h });
    }
    const touchesT = (s: { x: number; y: number }) => s.x <= t.x + t.w && t.x <= s.x + w && s.y <= t.y + t.h && t.y <= s.y + h;
    const hit = spots.find((s) => touchesT(s) && free(s.x, s.y));
    if (hit) return { ...hit, touching: true };
  }
  // No free wall (or no target): put it just east of everything, aligned with the target or the top.
  const x = rooms.length ? Math.max(...rooms.map((r) => r.x + r.w)) : 4;
  const y = nextTo ? nextTo.y : rooms.length ? Math.min(...rooms.map((r) => r.y)) : 4;
  return { x, y, touching: false };
}

function newId(blocks: Block[], prefix: string): string {
  let n = blocks.length + 1;
  while (blocks.some((b) => b.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Applies validated layout ops in order. Never mutates its input; each op that cannot apply is rejected with a reason. */
export function applyLayoutOps(input: Block[], raw: unknown[]): LayoutResult {
  const { ops, rejected } = parseOps(raw, LayoutOp);
  let blocks = input.map((b) => ({ ...b }));
  const applied: LayoutOp[] = [];
  const notes: string[] = [];
  const byId = (id: string) => blocks.find((b) => b.id === id);
  const room = (id: string) => { const b = byId(id); return b && isRoom(b) ? b : undefined; };
  const reject = (op: LayoutOp, reason: string) => rejected.push({ op, reason });

  for (const op of ops) {
    switch (op.op) {
      case "add": {
        const type = roomType(op.label);
        if (!type) { reject(op, `I don't have a "${op.label}" room type`); continue; }
        if (op.nextTo && !room(op.nextTo)) { reject(op, `there's no room with id ${op.nextTo}`); continue; }
        // "Another exam room": match the existing ones and sit beside them unless told otherwise.
        const twin = blocks.filter((b) => isRoom(b) && b.label === type).at(-1);
        const target = op.nextTo ? room(op.nextTo) : twin;
        const size = twin ? { w: twin.w, h: twin.h } : roomSize(type);
        const w = clamp(op.w ?? size.w), h = clamp(op.h ?? size.h);
        if ((op.w != null && w !== op.w) || (op.h != null && h !== op.h)) notes.push(`Sizes are kept between ${MIN_SIDE} and ${MAX_SIDE} ft per side.`);
        for (let i = 0; i < (op.count ?? 1); i++) {
          const at = place(blocks, w, h, target);
          if (target && op.nextTo && !at.touching) notes.push(`There was no free wall next to ${blockName(blocks, target)}, so I put the new ${roomName(type)} at the east edge.`);
          blocks = [...blocks, { id: newId(blocks, "r"), kind: "room", label: type, x: at.x, y: at.y, w, h }];
        }
        break;
      }
      case "remove": {
        const b = byId(op.id);
        if (!b) { reject(op, `there's no block with id ${op.id}`); continue; }
        const inner = isRoom(b) ? blocks.filter((o) => !isRoom(o) && centreIn(o, b)).map((o) => o.id) : [];
        blocks = blocks.filter((x) => x.id !== b.id && !inner.includes(x.id));
        if (isRoom(b) && !blocks.some(isRoom)) notes.push("The layout has no rooms now.");
        break;
      }
      case "resize": {
        const b = byId(op.id);
        if (!b) { reject(op, `there's no block with id ${op.id}`); continue; }
        if (op.scale != null && op.scale <= 0) { reject(op, "a size multiplier must be above zero"); continue; }
        if (op.scale == null && op.w == null && op.h == null) { reject(op, "no new size given"); continue; }
        if ((op.w != null && op.w <= 0) || (op.h != null && op.h <= 0)) { reject(op, "sizes must be above zero"); continue; }
        const k = op.scale != null ? Math.sqrt(op.scale) : 1; // scale multiplies the area
        const wantW = op.w ?? b.w * k, wantH = op.h ?? b.h * k;
        const w = clamp(wantW), h = clamp(wantH);
        if (Math.abs(w - wantW) > 0.25 || Math.abs(h - wantH) > 0.25) notes.push(`Sizes are kept between ${MIN_SIDE} and ${MAX_SIDE} ft per side.`);
        blocks = blocks.map((x) => (x.id === b.id ? { ...x, w, h } : x));
        break;
      }
      case "relabel": {
        const b = room(op.id);
        if (!b) { reject(op, `there's no room with id ${op.id}`); continue; }
        const type = roomType(op.label);
        if (!type) { reject(op, `I don't have a "${op.label}" room type`); continue; }
        blocks = blocks.map((x) => (x.id === b.id ? { ...x, label: type } : x));
        break;
      }
      case "add_object": {
        const r = room(op.in);
        if (!r) { reject(op, `there's no room with id ${op.in}`); continue; }
        const type = objectType(op.label);
        if (!type) { reject(op, `I don't have a "${op.label}" object`); continue; }
        const s = objectSize(type);
        const w = Math.min(s.w, r.w), h = Math.min(s.h, r.h);
        blocks = [...blocks, { id: newId(blocks, "o"), kind: "object", label: type, x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }];
        break;
      }
    }
    applied.push(op);
  }
  return { blocks, applied, rejected, notes: [...new Set(notes)] };
}

const centreIn = (o: Block, r: Block) => {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
};

/** Compact, id-bearing description of a layout for the model. */
export function describeLayout(blocks: Block[]): string {
  const rooms = blocks.filter(isRoom);
  if (!rooms.length) return "The layout is empty.";
  const lines = rooms.map((b) => {
    const near = rooms.filter((o) => o.id !== b.id && o.x <= b.x + b.w && b.x <= o.x + o.w && o.y <= b.y + b.h && b.y <= o.y + o.h);
    const objs = blocks.filter((o) => !isRoom(o) && centreIn(o, b) && o.label !== "door").map((o) => o.label);
    return `- ${b.id}: "${blockName(blocks, b)}" (${b.label}), ${b.w}×${b.h} ft = ${Math.round(b.w * b.h)} sf${near.length ? `, touches ${near.map((o) => `${o.id} ${blockName(blocks, o)}`).join(", ")}` : ""}${objs.length ? `, contains ${objs.join(", ")}` : ""}`;
  });
  return lines.join("\n");
}
