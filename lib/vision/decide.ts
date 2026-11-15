import { pointInPolygon, shoelaceArea, centroid, type Pt } from "../geometry/polygon";
import type { PanoCheck, Room } from "../types";

// Pure logic for "Hermit looked closer": pano→room mapping, the vision answer parser and the honesty rules.
// No I/O here so it can be unit tested; lib/vision/look.ts does the network and image work.

export type PanoPos = { id: string; x: number; y: number; z?: number };

// Cube face order of a Matterport skybox, checked by eye on x37LjPx62VA: 0 = ceiling, 1-4 = walls (in turn
// around the camera), 5 = floor. Only the wall faces can show a sink or an exam table.
export const WALL_FACES = [1, 2, 3, 4] as const;

/**
 * Puts each pano in the room whose polygon contains it. Pano position (x, y) is on the same floor plane as the
 * room polygons (z is camera height, ~1.3 m); on x37LjPx62VA (x, y) put 20/20 panos inside a room, (x, z) 0/20.
 * Matterport's own room→pano list is too coarse to trust for the room (x37 lists all 20 panos under one room), but it
 * does tell us the floor, so a pano is only matched against rooms on a floor that lists it (any floor if none does).
 * When polygons overlap, the smallest containing room wins.
 */
export function mapPanosToRooms(rooms: Pick<Room, "id" | "polygon" | "floorId" | "sweeps">[], panos: PanoPos[]): { byRoom: Record<string, PanoPos[]>; unmapped: PanoPos[] } {
  const floorsOf = new Map<string, Set<string>>();
  for (const r of rooms) for (const s of r.sweeps ?? []) (floorsOf.get(s.id) ?? floorsOf.set(s.id, new Set()).get(s.id)!).add(r.floorId);
  const byRoom: Record<string, PanoPos[]> = {};
  const unmapped: PanoPos[] = [];
  for (const p of panos) {
    const floors = floorsOf.get(p.id);
    const hits = rooms
      .filter((r) => r.polygon.length > 2 && (!floors?.size || floors.has(r.floorId)) && pointInPolygon(p, r.polygon))
      .sort((a, b) => shoelaceArea(a.polygon) - shoelaceArea(b.polygon));
    if (hits.length) (byRoom[hits[0].id] ??= []).push(p);
    else unmapped.push(p);
  }
  return { byRoom, unmapped };
}

// Room graphs come from more than one ETL (our own and a teammate's catalog), so the pano positions from Matterport
// GraphQL may not share the polygons' axes or units. Per scan, try a few plausible conventions and keep the one that
// puts the most panos inside a room. Identity is tried first and wins ties, so a scan that already maps is unchanged.
const AXES: { name: string; f: (p: PanoPos) => [number, number] | null }[] = [
  { name: "x,y", f: (p) => [p.x, p.y] },
  { name: "x,-y", f: (p) => [p.x, -p.y] },
  { name: "-x,y", f: (p) => [-p.x, p.y] },
  { name: "y,x", f: (p) => [p.y, p.x] },
  { name: "x,z", f: (p) => (p.z === undefined ? null : [p.x, p.z]) },
  { name: "x,-z", f: (p) => (p.z === undefined ? null : [p.x, -p.z]) },
];
export const FT_PER_M = 3.2808;
export const MIN_HIT_RATE = 0.3;
export const UNMAPPABLE_NOTE = "Hermit couldn't match this scan's photos to its rooms, so it didn't look.";
export const NO_PHOTO_NOTE = "No scan photo was taken inside this room.";

type Box = { minX: number; maxX: number; minY: number; maxY: number };
const bbox = (pts: { x: number; y: number }[]): Box | null =>
  pts.length ? { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) } : null;
const side = (b: Box) => Math.max(b.maxX - b.minX, b.maxY - b.minY);

/** Polygon extent / pano extent (longest bounding-box side, floor plane). About 3.3 means the polygons are in feet. */
export function extentRatio(rooms: Pick<Room, "polygon">[], panos: PanoPos[]): number | null {
  const pb = bbox(rooms.flatMap((r) => (r.polygon.length > 2 ? r.polygon : []))), qb = bbox(panos);
  if (!pb || !qb || side(qb) < 0.5) return null;
  return side(pb) / side(qb);
}

export type Mapping = {
  transform: string; // e.g. "x,y" or "x,-y ×3.2808"
  calibrated: boolean; // true when the room graph's own pano positions confirmed the transform (by pano id)
  hits: number;
  total: number;
  rate: number;
  mappable: boolean; // see chooseMapping
  ratio: number | null;
  byRoom: Record<string, PanoPos[]>; // positions already transformed into the polygons' frame
  unmapped: PanoPos[];
};

type Candidate = { name: string; moved: PanoPos[] };

function candidates(panos: PanoPos[], scales: number[]): Candidate[] {
  const out: Candidate[] = [];
  for (const s of scales) {
    for (const a of AXES) {
      const moved: PanoPos[] = [];
      for (const p of panos) {
        const v = a.f(p);
        if (!v) break;
        moved.push({ id: p.id, x: v[0] * s, y: v[1] * s });
      }
      if (moved.length === panos.length) out.push({ name: s === 1 ? a.name : `${a.name} ${s > 1 ? "×" : "÷"}${FT_PER_M}`, moved });
    }
  }
  return out;
}

/**
 * Picks the axis convention (and metres↔feet scale) that puts the scan's panos in the polygons' frame.
 * 1. If the room graph stored its own pano positions (`ref`, same pano ids), pick the transform that reproduces them
 *    (mean error under 0.3 m or 2% of the extent). The frame is then known, so the scan is mappable whenever any pano
 *    lands in a room: a low hit rate there means rooms without outlines, not a wrong frame.
 * 2. Otherwise maximize panos inside a room. A transform that squashes the panos onto a line (z is camera height, so
 *    (x, z) is nearly constant on one floor) is skipped, and a non-identity transform must beat identity by 2 panos
 *    and 10% of them. Below MIN_HIT_RATE the scan is unmappable: no pano is assigned to any room.
 */
export function chooseMapping(rooms: Pick<Room, "id" | "polygon" | "floorId" | "sweeps">[], panos: PanoPos[], ref?: { id: string; x: number; y: number }[]): Mapping {
  const ratio = extentRatio(rooms, panos);
  const finish = (name: string, moved: PanoPos[], calibrated: boolean): Mapping => {
    const { byRoom, unmapped } = mapPanosToRooms(rooms, moved);
    const hits = moved.length - unmapped.length;
    const rate = moved.length ? hits / moved.length : 0;
    const mappable = calibrated ? hits > 0 : moved.length > 0 && rate >= MIN_HIT_RATE;
    return mappable
      ? { transform: name, calibrated, hits, total: moved.length, rate, mappable, ratio, byRoom, unmapped }
      : { transform: name, calibrated, hits, total: moved.length, rate, mappable, ratio, byRoom: {}, unmapped: [...panos] };
  };

  const refById = new Map((ref ?? []).filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y)).map((r) => [r.id, r]));
  if (panos.filter((p) => refById.has(p.id)).length >= 2) {
    const rb = bbox([...refById.values()]);
    const tol = Math.max(0.3, 0.02 * (rb ? side(rb) : 0));
    let best: { c: Candidate; err: number } | null = null;
    for (const c of candidates(panos, [1, FT_PER_M, 1 / FT_PER_M])) {
      const d = c.moved.filter((p) => refById.has(p.id)).map((p) => Math.hypot(p.x - refById.get(p.id)!.x, p.y - refById.get(p.id)!.y));
      const err = d.reduce((s, v) => s + v, 0) / d.length;
      if (!best || err < best.err) best = { c, err };
    }
    if (best && best.err <= tol) return finish(best.c.name, best.c.moved, true);
  }

  const scales = [1];
  if (ratio !== null && ratio > 2.6 && ratio < 4.2) scales.push(FT_PER_M);
  if (ratio !== null && ratio > 1 / 4.2 && ratio < 1 / 2.6) scales.push(1 / FT_PER_M);
  const pb = bbox(rooms.flatMap((r) => (r.polygon.length > 2 ? r.polygon : [])));
  const flat = (moved: PanoPos[]) => {
    const b = bbox(moved);
    if (!b || !pb || moved.length < 3) return false;
    return b.maxX - b.minX < 0.15 * (pb.maxX - pb.minX) || b.maxY - b.minY < 0.15 * (pb.maxY - pb.minY);
  };
  const scored = candidates(panos, scales).map((c) => ({ c, hits: c.moved.length - mapPanosToRooms(rooms, c.moved).unmapped.length }));
  const identity = scored[0];
  if (!identity) return finish("x,y", panos, false);
  const margin = Math.max(2, Math.ceil(0.1 * panos.length));
  let pick = identity;
  for (const s of scored.slice(1)) if (!flat(s.c.moved) && s.hits >= identity.hits + margin && s.hits > pick.hits) pick = s;
  return finish(pick.c.name, pick.c.moved, false);
}

/** Up to n panos inside the room, nearest the polygon centroid first. */
export function pickPanos(polygon: Pt[], panos: PanoPos[], n = 2): PanoPos[] {
  if (!panos.length) return [];
  const c = centroid(polygon);
  return [...panos].sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y)).slice(0, n);
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "feature";

// What the vision model is asked to return (Gemini responseJsonSchema subset).
export const VISION_SCHEMA = {
  type: "object",
  properties: {
    walls_visible: { type: "string", enum: ["all", "most", "few"], description: "How much of THIS room's walls and floor area the photos show together." },
    features: {
      type: "array",
      items: {
        type: "object",
        properties: {
          feature: { type: "string" },
          result: { type: "string", enum: ["seen", "not_seen", "unclear"] },
          image: { type: "integer", description: "Index of the photo that shows it best (or best shows where it would be)." },
          box_2d: { type: "array", items: { type: "integer" }, description: "[ymin, xmin, ymax, xmax] normalized 0-1000, tightly around the feature. Empty unless seen." },
          note: { type: "string", description: "One short plain sentence a non-technical reader understands." },
        },
        required: ["feature", "result", "image", "box_2d", "note"],
      },
    },
  },
  required: ["walls_visible", "features"],
} as const;

export function visionPrompt(features: string[], roomLabel: string, images: number): string {
  return [
    `You are looking at ${images} photos (numbered 0 to ${images - 1}) taken from inside one room of a commercial building scan. Matterport labels this room "${roomLabel}".`,
    `For each feature below, say whether it is visible INSIDE THIS ROOM: ${features.map((f) => `"${f}"`).join(", ")}.`,
    `Rules:`,
    `- "seen" only when the feature itself is clearly in a photo and inside this room. Give box_2d tightly around it on that photo.`,
    `- Things visible through an open doorway in another room or hallway do NOT count for this room.`,
    `- "not_seen" only when the photos together clearly show this room's walls and the feature is absent.`,
    `- "unclear" whenever you are unsure, the view is blocked, blurry, too far, or you might be guessing. Prefer "unclear" over a guess.`,
    `- A "sink" has a basin and a faucet. A "counter" is a fixed countertop or built-in cabinet top (not a loose table or desk). An "exam table" is a padded medical examination table.`,
    `- walls_visible: "all" if the photos show essentially all of this room's walls, "most" if some parts are hidden, "few" if most of the room is not visible.`,
    `- note: one short plain sentence, e.g. "A sink with a cabinet along the left wall." No jargon, no numbers.`,
    `Answer each feature exactly once, using the feature names given.`,
  ].join("\n");
}

const an = (f: string) => (/^[aeiou]/i.test(f) ? "an " : "a ") + f;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type RawFeature = { feature?: unknown; result?: unknown; image?: unknown; box_2d?: unknown; note?: unknown };
export type Decided = { feature: string; result: PanoCheck["result"]; image: number | null; box: [number, number, number, number] | null; note: string; confidence: number };

const validBox = (b: unknown): [number, number, number, number] | null => {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [y0, x0, y1, x1] = b.map((v) => Math.max(0, Math.min(1000, v)));
  return y1 - y0 >= 5 && x1 - x0 >= 5 ? [y0, x0, y1, x1] : null;
};

const sentence = (s: unknown, fallback: string) => {
  const t = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  if (!t) return fallback;
  return t.length > 180 ? t.slice(0, 177).replace(/\s+\S*$/, "") + "..." : t;
};

/**
 * Applies the honesty rules to one raw model answer:
 * - "seen" needs a valid box on a real photo, otherwise it becomes "unclear";
 * - "not_seen" needs the room's walls to be all visible, otherwise "unclear";
 * - anything missing or malformed is "unclear".
 * Confidence is fixed per outcome (no calibration exists): 0.8 seen with a box, 0.6 not seen, 0.3 unclear.
 */
export function decide(feature: string, raw: RawFeature | undefined, wallsVisible: unknown, images: number): Decided {
  const img = typeof raw?.image === "number" && Number.isInteger(raw.image) && raw.image >= 0 && raw.image < images ? raw.image : null;
  const unclear = (note: string): Decided => ({ feature, result: "unclear", image: img, box: null, note, confidence: 0.3 });
  if (!raw) return unclear("Hermit couldn't tell from the scan photos.");
  const note = sentence(raw.note, "");
  if (raw.result === "seen") {
    const box = validBox(raw.box_2d);
    if (!box || img === null) return unclear(`The photos might show ${an(feature)}, but Hermit couldn't point to it, so it couldn't tell.`);
    return { feature, result: "seen", image: img, box, note: note || `${cap(an(feature))} is visible in this room.`, confidence: 0.8 };
  }
  if (raw.result === "not_seen") {
    if (wallsVisible !== "all") return unclear(`The photos don't show the whole room, so Hermit couldn't tell if there is ${an(feature)}.`);
    return { feature, result: "not_seen", image: img, box: null, note: note || `No ${feature} is visible in this room.`, confidence: 0.6 };
  }
  return unclear(note || "Hermit couldn't tell from the scan photos.");
}

/** Parses the model's JSON text and decides every requested feature; unknown or duplicate answers are ignored. */
export function parseVision(text: string, features: string[], images: number): Decided[] {
  let j: { walls_visible?: unknown; features?: RawFeature[] } = {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object") j = v;
  } catch { /* malformed: every feature becomes unclear */ }
  const list = Array.isArray(j.features) ? j.features : [];
  return features.map((f) => decide(f, list.find((r) => typeof r?.feature === "string" && r.feature.trim().toLowerCase() === f.toLowerCase()), j.walls_visible, images));
}

/** Crop rectangle (pixels) around a 0-1000 box on a w×h image, padded by 35% of the box and at least 30% of the image side. */
export function cropRect(box: [number, number, number, number], w: number, h: number): { left: number; top: number; width: number; height: number } {
  const [y0, x0, y1, x1] = box;
  const bw = ((x1 - x0) / 1000) * w, bh = ((y1 - y0) / 1000) * h;
  const cw = Math.min(w, Math.max(bw * 1.7, w * 0.3)), ch = Math.min(h, Math.max(bh * 1.7, h * 0.3));
  const cx = ((x0 + x1) / 2000) * w, cy = ((y0 + y1) / 2000) * h;
  const left = Math.round(Math.max(0, Math.min(w - cw, cx - cw / 2))), top = Math.round(Math.max(0, Math.min(h - ch, cy - ch / 2)));
  return { left, top, width: Math.round(Math.min(cw, w - left)), height: Math.round(Math.min(ch, h - top)) };
}

/** Replaces checks with the same room+feature, keeps the rest. */
export function upsertChecks(existing: PanoCheck[], fresh: PanoCheck[]): PanoCheck[] {
  const key = (c: PanoCheck) => `${c.roomId}|${c.feature.toLowerCase()}`;
  const replaced = new Set(fresh.map(key));
  return [...existing.filter((c) => !replaced.has(key(c))), ...fresh];
}

// ---- Rate limits (Gemini 429/503) ----

/**
 * How long to wait before retry number `attempt` (0-based). Honors a Retry-After header (seconds or HTTP date) or a
 * google.rpc.RetryInfo retryDelay ("37s") in the error body; otherwise exponential backoff from 2 s. Always adds
 * jitter so parallel workers don't retry in lockstep. Capped at 120 s.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null | undefined, body: unknown, rand: () => number = Math.random, now = Date.now()): number {
  let server: number | null = null;
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) server = secs * 1000;
    else if (!Number.isNaN(Date.parse(retryAfter))) server = Math.max(0, Date.parse(retryAfter) - now);
  }
  if (server === null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const details: any[] = (body as any)?.error?.details ?? [];
    const info = Array.isArray(details) ? details.find((d) => String(d?.["@type"] ?? "").endsWith("RetryInfo")) : undefined;
    const m = typeof info?.retryDelay === "string" ? /^([\d.]+)s$/.exec(info.retryDelay) : null;
    if (m) server = Number(m[1]) * 1000;
  }
  const ms = server !== null ? server + rand() * 1000 : 2000 * 2 ** attempt * (0.75 + rand() * 0.5);
  return Math.min(120_000, Math.round(ms));
}

/** True when a 429 body says a per-day quota is used up (waiting minutes won't help), not just the per-minute rate. */
export function isDailyQuota(body: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = (body as any)?.error;
  const details = Array.isArray(err?.details) ? err.details : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids: string[] = details.flatMap((d: any) => (Array.isArray(d?.violations) ? d.violations : [])).map((v: any) => `${v?.quotaId ?? ""} ${v?.quotaMetric ?? ""}`);
  if (ids.some((id) => /per\s*day|perday/i.test(id))) return true;
  return /per\s*day|daily (limit|quota)/i.test(String(err?.message ?? ""));
}
