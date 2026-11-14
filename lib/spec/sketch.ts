import type { RoomReq } from "../types";
import type { Pack } from "../uses/packs";

export type SketchRoom = { key: string; label: string; index: number; x: number; y: number; w: number; h: number; fixtures: string[]; pinned?: boolean };

const ROW_FT = 56;

// Dimensions in feet for one room: the user's size if given, else the pack's typical block.
export function dims(r: RoomReq, pack: Pack): { w: number; h: number } {
  const p = pack.rooms.find((x) => x.label === r.label);
  if (r.minSqft && (!p || (r.minSqft !== p.minSqft && Math.abs(p.w * p.h - r.minSqft) > 10))) {
    const ratio = p ? p.w / p.h : 1.2;
    const h = Math.max(5, Math.round(Math.sqrt(r.minSqft / ratio)));
    return { w: Math.max(5, Math.round(r.minSqft / h)), h };
  }
  return p ? { w: p.w, h: p.h } : { w: 10, h: 10 };
}

// Lays the requirement out on shelves. Rooms the user dragged stay where they put them; the rest re-flow around them.
export function toLayout(rooms: RoomReq[], pack: Pack, prev: SketchRoom[] = []): SketchRoom[] {
  const pinned = new Map(prev.filter((p) => p.pinned).map((p) => [p.key, p]));
  const out: SketchRoom[] = [];
  const free: SketchRoom[] = [];
  for (const r of rooms) for (let i = 0; i < r.count; i++) {
    const key = `${r.label}#${i}`;
    const { w, h } = dims(r, pack);
    const old = pinned.get(key);
    if (old) out.push({ ...old, w, h, fixtures: r.fixtures ?? [] });
    else free.push({ key, label: r.label, index: i, x: 0, y: 0, w, h, fixtures: r.fixtures ?? [] });
  }
  let x = 0, y = 0, rowH = 0;
  for (const b of free) {
    for (let tries = 0; tries < 200; tries++) {
      if (x + b.w > ROW_FT && x > 0) { x = 0; y += rowH + 1; rowH = 0; }
      const cand = { ...b, x, y };
      const hit = out.find((o) => overlaps(o, cand));
      if (!hit) { out.push(cand); x += b.w + 1; rowH = Math.max(rowH, b.h); break; }
      x = hit.x + hit.w + 1;
    }
  }
  return out;
}

const overlaps = (a: SketchRoom, b: SketchRoom) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const touches = (a: SketchRoom, b: SketchRoom) => a.x <= b.x + b.w + 0.5 && b.x <= a.x + a.w + 0.5 && a.y <= b.y + b.h + 0.5 && b.y <= a.y + a.h + 0.5;

// Blocks that touch on the sketch become "next to" requirements.
export function adjacency(sketch: SketchRoom[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const a of sketch) for (const b of sketch) {
    if (a.key === b.key || a.label === b.label || !touches(a, b)) continue;
    (out[a.label] ??= new Set()).add(b.label);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

export const sketchArea = (s: SketchRoom[]) => Math.round(s.reduce((t, r) => t + r.w * r.h, 0));
