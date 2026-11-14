import type { Pack } from "../uses/packs";
import type { SketchRoom } from "./sketch";

export type FurnType = "chair" | "desk" | "table" | "sofa" | "plant" | "reception desk" | "exam table" | "shelf" | "bed" | "styling chair" | "sink" | "toilet" | "shower" | "hood" | "shampoo sink";
export type Furn = { id: string; type: FurnType; x: number; y: number; w: number; h: number };

export const FURNITURE: { type: FurnType; w: number; h: number; fixture?: boolean }[] = [
  { type: "chair", w: 2, h: 2 }, { type: "desk", w: 5, h: 2.5 }, { type: "table", w: 4, h: 3 }, { type: "sofa", w: 6, h: 3 },
  { type: "reception desk", w: 7, h: 3 }, { type: "exam table", w: 6, h: 2.5 }, { type: "styling chair", w: 3, h: 3 }, { type: "bed", w: 5, h: 6.5 },
  { type: "shelf", w: 4, h: 1.5 }, { type: "plant", w: 1.5, h: 1.5 },
  { type: "sink", w: 2, h: 1.5, fixture: true }, { type: "toilet", w: 1.5, h: 2.5, fixture: true }, { type: "shower", w: 3, h: 3, fixture: true },
  { type: "hood", w: 6, h: 3, fixture: true }, { type: "shampoo sink", w: 2.5, h: 2.5, fixture: true },
];
export const isFixture = (t: FurnType) => !!FURNITURE.find((f) => f.type === t)?.fixture;
const size = (t: FurnType) => FURNITURE.find((f) => f.type === t)!;
let n = 0;
export const furnId = () => `f${Date.now().toString(36)}${(n++).toString(36)}`;

// What a designer would put in each kind of room. Fixtures go along the wall; furniture in the middle.
const PLAN: Record<string, FurnType[]> = {
  reception: ["reception desk", "chair", "chair", "chair", "plant"],
  "exam room": ["exam table", "sink", "chair"],
  office: ["desk", "chair", "shelf"],
  conference: ["table", "chair", "chair", "chair", "chair"],
  bathroom: ["toilet", "sink"],
  kitchen: ["sink", "shelf"],
  storage: ["shelf", "shelf"],
  lab: ["desk", "sink", "shelf"],
  "styling floor": ["styling chair", "styling chair", "styling chair", "shampoo sink", "shampoo sink"],
  dining: ["table", "chair", "chair", "table", "chair", "chair", "plant"],
  open: ["desk", "chair", "desk", "chair", "plant"],
  bedroom: ["bed", "shelf"],
  living: ["sofa", "table", "plant"],
};

export function furnishRoom(room: SketchRoom): Furn[] {
  const items = PLAN[room.label] ?? ["table", "chair"];
  if (room.label === "kitchen" && room.fixtures.includes("hood")) items.unshift("hood");
  const out: Furn[] = [];
  // Leave the top strip for the room's name.
  let x = room.x + 0.6, y = room.y + 2.3, rowH = 0;
  for (const t of items) {
    const s = size(t);
    if (x + s.w > room.x + room.w - 0.4) { x = room.x + 0.6; y += rowH + 0.6; rowH = 0; }
    if (s.w > room.w - 1) continue;
    if (y + s.h > room.y + room.h - 1.6) break;
    out.push({ id: furnId(), type: t, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, w: s.w, h: s.h });
    x += s.w + 0.6;
    rowH = Math.max(rowH, s.h);
  }
  return out;
}

export const furnishAll = (layout: SketchRoom[]) => layout.flatMap(furnishRoom);

export const roomOf = (f: Furn, layout: SketchRoom[]) => {
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  return layout.find((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h);
};

// Short, practical design notes for the use. Screening-level advice, not a design review.
export function designTips(pack: Pack, opts: { wheelchair?: boolean }): string[] {
  const tips: Record<string, string[]> = {
    medical: ["Put reception right at the entry so patients check in before they reach the exam rooms.", "Line the exam rooms along one hallway; it keeps the plumbing on one wall and saves money.", "Each exam room needs about 10×11 ft to fit a table, a sink and a chair."],
    salon: ["Group the shampoo sinks together near the back; plumbing in one run is far cheaper.", "Leave about 5 ft between styling chairs so stylists can move around clients.", "Keep the reception desk where it can see the door and the floor."],
    restaurant: ["Put the kitchen against an outside wall; the hood needs a path to the roof.", "Plan about 15 sf per seat in the dining room.", "Restrooms near the dining room, away from the kitchen door."],
    office: ["Private offices on the window side, shared space in the middle.", "The conference room near the entry keeps visitors out of the work area.", "One small kitchen beats coffee machines scattered around."],
    retail: ["Keep the front 15 ft open; that's where shoppers decide to come in.", "Stockroom at the back, with a door near the register."],
    fitness: ["Studios need open floor without columns; showers go next to the locker area.", "Put reception between the door and the studio to control entry."],
    warehouse: ["Office by the front door, storage by the dock.", "Keep a clear aisle from the drive-in door to the racks."],
    home: ["Bedrooms away from the living room keep noise down.", "Check where the washer hookups are before moving furniture."],
  };
  const out = [...(tips[pack.key] ?? tips.office)];
  if (opts.wheelchair) out.push("Keep a 5 ft turning circle in the restroom and 36 in clear in every hallway.");
  return out;
}
