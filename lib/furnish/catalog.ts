// Offline knowledge for furnishing: typical sizes, colors, materials, and starter suggestions per room.
// Gemini suggestions replace the per-room lists when available; these keep the feature working without it.

export type Size = { w: number; d: number; h: number }; // meters: width, depth, height
export type FurnishItem = { name: string; terms: string[]; size: Size };

const MIN = 0.1, MAX = 6;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Number.isFinite(n) ? n : MIN));
export const clampSize = (s: Size): Size => ({ w: clamp(s.w), d: clamp(s.d), h: clamp(s.h) });

const S = (w: number, d: number, h: number): Size => ({ w, d, h });
// Typical footprints (m). Unknown items fall back to DEFAULT_SIZE and are labeled approximate in the UI.
const TYPICAL: Record<string, Size> = {
  stove: S(0.76, 0.66, 0.91), range: S(0.76, 0.66, 0.91), "commercial range": S(1.52, 0.84, 0.91), oven: S(0.76, 0.66, 0.91),
  fridge: S(0.84, 0.76, 1.78), refrigerator: S(0.84, 0.76, 1.78), "reach-in fridge": S(0.74, 0.8, 2.0), dishwasher: S(0.6, 0.6, 0.86),
  microwave: S(0.5, 0.4, 0.3), sink: S(0.8, 0.55, 0.9), "kitchen island": S(1.8, 0.9, 0.91), "prep table": S(1.52, 0.76, 0.86),
  hood: S(1.5, 0.9, 0.6), "kitchen hood": S(1.5, 0.9, 0.6),
  sofa: S(2.1, 0.9, 0.85), couch: S(2.1, 0.9, 0.85), sectional: S(2.8, 1.8, 0.85), armchair: S(0.9, 0.85, 0.9),
  "coffee table": S(1.2, 0.6, 0.45), "tv stand": S(1.5, 0.45, 0.55), tv: S(1.25, 0.1, 0.75), bookshelf: S(0.9, 0.35, 1.8), shelf: S(0.9, 0.35, 1.8),
  rug: S(2.4, 1.7, 0.02), lamp: S(0.4, 0.4, 1.6), "floor lamp": S(0.4, 0.4, 1.6), plant: S(0.5, 0.5, 1.2),
  bed: S(1.6, 2.1, 0.6), "queen bed": S(1.6, 2.1, 0.6), "king bed": S(1.95, 2.1, 0.6), nightstand: S(0.5, 0.4, 0.55), dresser: S(1.5, 0.5, 0.8), wardrobe: S(1.2, 0.6, 2.0),
  desk: S(1.4, 0.7, 0.75), "office chair": S(0.65, 0.65, 1.1), chair: S(0.5, 0.55, 0.9), stool: S(0.4, 0.4, 0.75), "bar stool": S(0.42, 0.42, 0.76),
  table: S(1.2, 0.8, 0.75), "dining table": S(1.8, 0.9, 0.75), "two-top table": S(0.75, 0.75, 0.75), booth: S(1.5, 0.7, 1.1),
  "conference table": S(3.0, 1.2, 0.75), "filing cabinet": S(0.4, 0.6, 1.3), "reception desk": S(2.0, 0.8, 1.1), "host stand": S(0.6, 0.5, 1.1),
  toilet: S(0.4, 0.7, 0.8), bathtub: S(1.5, 0.75, 0.6), shower: S(0.9, 0.9, 2.0), "washing machine": S(0.6, 0.6, 0.85), dryer: S(0.6, 0.6, 0.85),
  "styling chair": S(0.65, 0.7, 1.0), "shampoo sink": S(0.7, 1.2, 0.95), "exam table": S(0.7, 1.9, 0.8), "display rack": S(1.2, 0.5, 1.6),
  counter: S(1.8, 0.6, 0.95), "checkout counter": S(1.8, 0.7, 1.0), treadmill: S(0.85, 2.0, 1.4), piano: S(1.5, 0.6, 1.2),
  "trash can": S(0.4, 0.4, 0.65), "garbage can": S(0.4, 0.4, 0.65), bin: S(0.4, 0.4, 0.65), "recycling bin": S(0.4, 0.4, 0.65), wastebasket: S(0.3, 0.3, 0.35),
  wheelchair: S(0.65, 1.05, 0.9), walker: S(0.6, 0.55, 0.85), "hospital bed": S(1.0, 2.2, 0.75), crib: S(0.75, 1.35, 0.95), "high chair": S(0.6, 0.75, 1.05),
  "coat rack": S(0.5, 0.5, 1.8), mirror: S(0.6, 0.05, 1.2), "floor mirror": S(0.6, 0.05, 1.6), "bar cart": S(0.8, 0.45, 0.85), "kitchen cart": S(0.8, 0.45, 0.9),
  "dining chair": S(0.45, 0.5, 0.9), "accent chair": S(0.75, 0.8, 0.85), recliner: S(0.9, 0.95, 1.0), loveseat: S(1.5, 0.9, 0.85), ottoman: S(0.6, 0.6, 0.45), bench: S(1.2, 0.4, 0.45),
  "side table": S(0.5, 0.5, 0.55), "end table": S(0.5, 0.5, 0.55), "console table": S(1.2, 0.35, 0.75), "round table": S(1.0, 1.0, 0.75), "cafe table": S(0.6, 0.6, 0.75),
  "four top table": S(0.9, 0.9, 0.75), "bar table": S(0.7, 0.7, 1.05), "picnic table": S(1.8, 1.5, 0.75), "work table": S(1.5, 0.75, 0.9), workbench: S(1.5, 0.75, 0.9),
  cabinet: S(0.9, 0.45, 0.9), "storage cabinet": S(0.9, 0.45, 1.8), locker: S(0.4, 0.5, 1.8), "file cabinet": S(0.4, 0.6, 1.3), "storage shelving": S(1.2, 0.45, 1.8), rack: S(1.2, 0.45, 1.8),
  "single bed": S(1.0, 2.0, 0.55), "double bed": S(1.4, 2.0, 0.55), "bunk bed": S(1.0, 2.0, 1.6), "desk lamp": S(0.2, 0.2, 0.45), "table lamp": S(0.3, 0.3, 0.55),
  "potted plant": S(0.5, 0.5, 1.2), tree: S(0.8, 0.8, 1.9), "fiddle leaf fig": S(0.6, 0.6, 1.8), vase: S(0.2, 0.2, 0.4),
  "water heater": S(0.55, 0.55, 1.5), "air conditioner": S(0.8, 0.3, 0.3), "space heater": S(0.3, 0.2, 0.5), fan: S(0.45, 0.35, 1.2), "ceiling fan": S(1.3, 1.3, 0.4),
  "sink cabinet": S(0.8, 0.55, 0.85), vanity: S(0.9, 0.55, 0.85), "kitchen sink": S(0.8, 0.55, 0.9), "three compartment sink": S(2.0, 0.6, 0.95), "hand sink": S(0.45, 0.4, 0.9),
  "deep fryer": S(0.4, 0.8, 1.1), griddle: S(0.9, 0.8, 0.9), "ice machine": S(0.75, 0.75, 1.6), "espresso machine": S(0.7, 0.55, 0.5), "display fridge": S(0.6, 0.65, 2.0),
  "pos terminal": S(0.4, 0.4, 0.35), "cash register": S(0.4, 0.4, 0.3), "salon chair": S(0.65, 0.7, 1.0), "massage table": S(0.75, 1.85, 0.75), "dental chair": S(0.8, 1.9, 1.2),
  "office desk": S(1.4, 0.7, 0.75), "standing desk": S(1.4, 0.7, 1.1), whiteboard: S(1.8, 0.05, 1.2), printer: S(0.5, 0.45, 0.4), "water cooler": S(0.35, 0.35, 1.05), "vending machine": S(0.9, 0.85, 1.8),
  "pool table": S(1.4, 2.5, 0.8), "ping pong table": S(1.5, 2.75, 0.76), "exercise bike": S(0.6, 1.2, 1.3), "weight bench": S(0.6, 1.3, 0.45), "punching bag": S(0.4, 0.4, 1.2),
};
export const DEFAULT_SIZE = S(0.6, 0.6, 0.8);

const singular = (w: string) => (w.length > 3 && w.endsWith("es") && /(ch|sh|x|s)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map(singular);
export const normName = (s: string) => words(s).join(" ");

/** Typical size for a named item: exact name, then its last word ("velvet sofa" → sofa). */
export function typicalSize(name: string): { size: Size; known: boolean } {
  const n = normName(name);
  const hit = TYPICAL[n] ?? TYPICAL[n.split(" ").slice(-2).join(" ")] ?? TYPICAL[n.split(" ").at(-1) ?? ""];
  return hit ? { size: hit, known: true } : { size: DEFAULT_SIZE, known: false };
}

/** A search result counts only if every word of one search term appears in its title ("Hotel" is not a host stand). */
export function matchesTerms(title: string, terms: string[]): boolean {
  const t = new Set(words(title));
  return terms.some((term) => { const w = words(term); return w.length > 0 && w.every((x) => t.has(x)); });
}

export const COLORS: Record<string, string> = {
  white: "#f4f4f2", black: "#1d1d1f", gray: "#8a8d91", grey: "#8a8d91", silver: "#c4c7cc", red: "#c0392b", orange: "#e67e22", yellow: "#f1c40f",
  green: "#2e8b57", "sage green": "#9caf88", olive: "#708238", teal: "#1f8a8a", blue: "#2e6fd8", navy: "#1f2f5a", purple: "#7d3c98", pink: "#e8a0b4",
  brown: "#7b5134", tan: "#d2b48c", beige: "#e8dcc4", cream: "#f3ead3", gold: "#c9a227", walnut: "#5d4030", oak: "#b88a57", charcoal: "#36393d",
};
const HEX = /^#[0-9a-f]{6}$/i;
/** A color name or #rrggbb → hex, else null. */
export const toHex = (c: string): string | null => (HEX.test(c.trim()) ? c.trim().toLowerCase() : COLORS[c.trim().toLowerCase()] ?? null);

// Physical look presets applied to every mesh of a model (color, then roughness/metalness). Metalness stays low:
// the tour scene has no environment map, so fully metallic surfaces would render nearly black.
export const MATERIALS = {
  wood: { color: "#a0703f", roughness: 0.7, metalness: 0 },
  "stainless steel": { color: "#d3d7db", roughness: 0.3, metalness: 0.35 },
  metal: { color: "#a9aeb3", roughness: 0.35, metalness: 0.35 },
  brass: { color: "#c9a85a", roughness: 0.3, metalness: 0.35 },
  marble: { color: "#eeeae4", roughness: 0.15, metalness: 0 },
  fabric: { color: "#8c8f94", roughness: 0.95, metalness: 0 },
  leather: { color: "#6b4226", roughness: 0.5, metalness: 0 },
  velvet: { color: "#4b2e5a", roughness: 0.9, metalness: 0 },
  plastic: { color: "#e8e8e8", roughness: 0.4, metalness: 0 },
  glass: { color: "#d8eef2", roughness: 0.05, metalness: 0.1 },
} as const;
export type MaterialName = keyof typeof MATERIALS;
export const MATERIAL_NAMES = Object.keys(MATERIALS) as MaterialName[];
export const toMaterial = (m: string): MaterialName | null => {
  const n = m.trim().toLowerCase().replace(/^steel$/, "stainless steel").replace(/^stainless$/, "stainless steel");
  return (MATERIAL_NAMES as string[]).includes(n) ? (n as MaterialName) : null;
};

const item = (name: string, ...extra: string[]): FurnishItem => ({ name, terms: [name, ...extra], size: typicalSize(name).size });
// Starter suggestions by room label (offline fallback). Use-specific lists come from Gemini.
const BY_ROOM: Record<string, FurnishItem[]> = {
  kitchen: [item("stove", "oven"), item("fridge", "refrigerator"), item("dishwasher"), item("kitchen island", "island"), item("bar stool", "stool"), item("microwave")],
  living: [item("sofa", "couch"), item("armchair", "chair"), item("coffee table", "table"), item("tv stand"), item("rug"), item("floor lamp", "lamp"), item("plant")],
  bedroom: [item("bed"), item("nightstand"), item("dresser"), item("wardrobe"), item("desk"), item("floor lamp", "lamp")],
  bathroom: [item("toilet"), item("sink"), item("bathtub", "bath"), item("shower")],
  office: [item("desk"), item("office chair", "chair"), item("bookshelf", "shelf"), item("filing cabinet", "cabinet"), item("plant")],
  dining: [item("dining table", "table"), item("chair"), item("rug"), item("plant")],
  storage: [item("shelf", "shelving"), item("filing cabinet", "cabinet")],
  utility: [item("washing machine", "washer"), item("dryer"), item("shelf")],
  garage: [item("shelf", "shelving"), item("workbench", "table")],
};
const GENERIC = [item("table"), item("chair"), item("sofa", "couch"), item("shelf"), item("plant"), item("desk")];
export const starterItems = (roomLabel: string): FurnishItem[] => BY_ROOM[roomLabel] ?? GENERIC;

/** Meters → feet and inches, e.g. 0.762 → 2′ 6″ (rounded to the nearest inch). */
export function ftIn(m: number): string {
  const total = Math.round(m / 0.0254);
  const ft = Math.floor(total / 12), inch = total % 12;
  return ft ? (inch ? `${ft}′ ${inch}″` : `${ft}′`) : `${inch}″`;
}
