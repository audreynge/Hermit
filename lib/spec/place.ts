import { FURNITURE, type FurnType } from "./furnish";

export type Pt = { x: number; y: number };
export type Placed = { id: string; roomId: string; type: string; x: number; y: number; w: number; h: number };
export type Wall = "north" | "south" | "east" | "west" | null;

const FT = 0.3048;
const GAP = 0.25; // meters of clearance around each piece

export function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

const fits = (x: number, y: number, w: number, h: number, poly: Pt[]) =>
  [{ x, y }, { x: x + w, y }, { x, y: y + h }, { x: x + w, y: y + h }, { x: x + w / 2, y: y + h / 2 }].every((p) => inside(p, poly));
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

let n = 0;
// Place `count` pieces inside a room polygon (scan meters), hugging a wall if asked. Pieces that don't fit are reported, not forced.
export function place(roomId: string, poly: Pt[], existing: Placed[], type: FurnType, count: number, wall: Wall = null): { placed: Placed[]; missed: number } {
  const spec = FURNITURE.find((f) => f.type === type);
  if (!spec || poly.length < 3) return { placed: [], missed: count };
  const w = spec.w * FT, h = spec.h * FT;
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = 0.15;
  const cands: Pt[] = [];
  for (let y = minY + GAP; y + h <= maxY - GAP / 2; y += step) for (let x = minX + GAP; x + w <= maxX - GAP / 2; x += step) cands.push({ x, y });
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const key = (p: Pt) => wall === "north" ? -(p.y + h) : wall === "south" ? p.y : wall === "east" ? -(p.x + w) : wall === "west" ? p.x : Math.hypot(p.x + w / 2 - cx, p.y + h / 2 - cy);
  cands.sort((a, b) => key(a) - key(b) || a.x - b.x);
  const all = [...existing];
  const placed: Placed[] = [];
  for (let i = 0; i < count; i++) {
    const spot = cands.find((p) => fits(p.x, p.y, w, h, poly) && !all.some((o) => overlaps({ x: p.x, y: p.y, w, h }, o)));
    if (!spot) return { placed, missed: count - i };
    const item = { id: `p${Date.now().toString(36)}${(n++).toString(36)}`, roomId, type, x: spot.x, y: spot.y, w, h };
    placed.push(item);
    all.push(item);
  }
  return { placed, missed: 0 };
}

const TYPES = FURNITURE.map((f) => f.type).sort((a, b) => b.length - a.length);
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

// Fallback parser when no LLM is configured: "add 3 chairs to reception along the north wall".
export function parseFurnish(text: string, rooms: { id: string; name: string }[]): { op: "add" | "remove"; type: FurnType; count: number; roomId: string | null; wall: Wall }[] {
  const t = text.toLowerCase();
  const op = /\b(remove|delete|take out|get rid)\b/.test(t) ? "remove" : "add";
  const type = TYPES.find((x) => t.includes(x) || t.includes(`${x}s`) || (x === "styling chair" && /salon chair/.test(t)) || (x === "shampoo sink" && /shampoo bowl/.test(t)));
  if (!type) return [];
  const m = t.match(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight)\b(?=\s+(?:[a-z-]+\s+){0,2}(?:chair|desk|table|sofa|plant|shel|bed|counter|stool|sink|toilet|shower|hood|bowl))/);
  const count = m ? Number(m[1]) || NUM[m[1]] || 1 : 1;
  const room = [...rooms].sort((a, b) => b.name.length - a.name.length).find((r) => t.includes(r.name.toLowerCase()));
  const wall = (t.match(/\b(north|south|east|west)\b/)?.[1] ?? null) as Wall;
  return [{ op, type, count, roomId: room?.id ?? null, wall }];
}
