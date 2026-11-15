import { pointInPolygon, shoelaceArea, centroid, type Pt } from "../geometry/polygon";
import type { PanoCheck, Room } from "../types";

// Pure logic for "Hermit looked closer": pano→room mapping, the vision answer parser and the honesty rules.
// No I/O here so it can be unit tested; lib/vision/look.ts does the network and image work.

export type PanoPos = { id: string; x: number; y: number };

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
