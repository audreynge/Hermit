// Room and object catalog shared by Layout Studio and chat layout edits. Sizes are in feet.
export const ROOM_TYPES: { type: string; label: string; w: number; h: number; fill: string; palette: boolean }[] = [
  { type: "reception", label: "Reception", w: 16, h: 10, fill: "#fde3d4", palette: true },
  { type: "exam room", label: "Exam Room", w: 12, h: 10, fill: "#dcefff", palette: true },
  { type: "office", label: "Office", w: 10, h: 10, fill: "#e6f4e8", palette: true },
  { type: "hallway", label: "Hallway", w: 6, h: 18, fill: "#fff1d6", palette: true },
  { type: "storage", label: "Storage", w: 8, h: 8, fill: "#ece6f6", palette: true },
  { type: "kitchen", label: "Kitchen", w: 10, h: 8, fill: "#fff0e0", palette: true },
  { type: "bathroom", label: "Bathroom", w: 7, h: 8, fill: "#e3f4fb", palette: true },
  { type: "waiting area", label: "Waiting Area", w: 12, h: 8, fill: "#fde3d4", palette: true },
  { type: "conference", label: "Conference Room", w: 14, h: 12, fill: "#f3ecff", palette: true },
  { type: "procedure room", label: "Procedure Room", w: 12, h: 12, fill: "#ffe5e5", palette: true },
  { type: "bedroom", label: "Bedroom", w: 12, h: 12, fill: "#e6f4e8", palette: false },
  { type: "living room", label: "Living Room", w: 16, h: 14, fill: "#fde3d4", palette: false },
  { type: "dining", label: "Dining", w: 14, h: 12, fill: "#fff0e0", palette: false },
  { type: "open area", label: "Open Area", w: 20, h: 16, fill: "#f7efe9", palette: false },
  { type: "fitting room", label: "Fitting Room", w: 6, h: 6, fill: "#ece6f6", palette: false },
  { type: "laundry", label: "Laundry", w: 7, h: 7, fill: "#e3f4fb", palette: false },
];

export const OBJECT_TYPES: { type: string; label: string; w: number; h: number; palette: boolean }[] = [
  { type: "chair", label: "Chair", w: 3, h: 3, palette: true }, { type: "table", label: "Table", w: 5, h: 3, palette: true },
  { type: "desk", label: "Desk", w: 5, h: 3, palette: true }, { type: "sink", label: "Sink", w: 3, h: 3, palette: true },
  { type: "counter", label: "Counter", w: 6, h: 2.5, palette: true }, { type: "kitchenette", label: "Kitchenette", w: 6, h: 3, palette: true },
  { type: "door", label: "Door", w: 3, h: 3, palette: true }, { type: "window", label: "Window", w: 4, h: 1.5, palette: true },
  { type: "plant", label: "Plant", w: 2.5, h: 3, palette: true }, { type: "other", label: "Other", w: 3, h: 3, palette: true },
  { type: "exam bed", label: "Exam Bed", w: 9, h: 3, palette: false }, { type: "stool", label: "Stool", w: 2.5, h: 2.5, palette: false },
  { type: "shelf", label: "Shelf", w: 5.5, h: 8, palette: false }, { type: "reception desk", label: "Reception Desk", w: 12, h: 5, palette: false },
  { type: "toilet", label: "Toilet", w: 2.5, h: 3, palette: false }, { type: "shower", label: "Shower", w: 4, h: 4, palette: false },
];

const ROOM_SYNONYMS: Record<string, string> = {
  exam: "exam room", "exam rooms": "exam room", "examination room": "exam room", "consult room": "exam room", "treatment room": "exam room",
  restroom: "bathroom", toilet: "bathroom", wc: "bathroom", washroom: "bathroom", lavatory: "bathroom",
  "meeting room": "conference", "conference room": "conference", boardroom: "conference",
  lobby: "reception", "front desk": "reception", "waiting room": "waiting area",
  "break room": "kitchen", breakroom: "kitchen", kitchenette: "kitchen", pantry: "kitchen",
  closet: "storage", "stock room": "storage", stockroom: "storage", "storage room": "storage",
  corridor: "hallway", hall: "hallway", "private office": "office", study: "office",
  "living": "living room", "family room": "living room", "dining room": "dining", "open plan": "open area", "open space": "open area",
  "procedure": "procedure room", "bed room": "bedroom",
};
const OBJECT_SYNONYMS: Record<string, string> = { "hand sink": "sink", basin: "sink", "exam table": "exam bed", bench: "chair", stool: "stool", shelves: "shelf", shelving: "shelf" };

// "Exam Room 2" / "exam room #2" name a room, not a type: drop the trailing number.
const clean = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ").replace(/\s*#?\d+$/, "");
const singular = (s: string) => s.replace(/(?<!s)s$/, "");

export function roomType(label: string): string | null {
  const l = clean(label);
  const hit = ROOM_TYPES.find((r) => r.type === l || clean(r.label) === l) ?? ROOM_TYPES.find((r) => r.type === singular(l));
  if (hit) return hit.type;
  return ROOM_SYNONYMS[l] ?? ROOM_SYNONYMS[singular(l)] ?? null;
}

export function objectType(label: string): string | null {
  const l = clean(label);
  const hit = OBJECT_TYPES.find((o) => o.type === l || o.type === singular(l));
  return hit ? hit.type : OBJECT_SYNONYMS[l] ?? OBJECT_SYNONYMS[singular(l)] ?? null;
}

export const roomSize = (type: string) => ROOM_TYPES.find((r) => r.type === type) ?? { w: 10, h: 10 };
export const objectSize = (type: string) => OBJECT_TYPES.find((o) => o.type === type) ?? { w: 3, h: 3 };
export const roomName = (type: string) => ROOM_TYPES.find((r) => r.type === type)?.label ?? type.replace(/\b\w/g, (c) => c.toUpperCase());
