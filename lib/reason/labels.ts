const RULES: [RegExp, string][] = [
  [/bath|restroom|toilet|powder|lavatory|\bwc\b/i, "bathroom"],
  [/kitchen|breakroom|break room|pantry/i, "kitchen"],
  [/bedroom|\bbed\b/i, "bedroom"],
  [/conference|meeting|board/i, "conference"],
  [/reception|lobby|waiting/i, "reception"],
  [/office|workspace|study|den/i, "office"],
  [/hall|corridor|entry|foyer|stair|landing/i, "hallway"],
  [/living|family|dining|great room/i, "living"],
  [/closet|storage/i, "storage"],
  [/utility|laundry|mechanical|server|electrical/i, "utility"],
  [/garage|carport/i, "garage"],
  [/balcony|patio|deck|porch|yard|terrace/i, "outdoor"],
  [/warehouse|showroom|open|retail|sales floor/i, "open"],
];

export function normalizeRoomLabel(tags: (string | null | undefined)[]): string {
  for (const t of tags) {
    if (!t) continue;
    for (const [re, label] of RULES) if (re.test(t)) return label;
  }
  return "other";
}

// Requested labels that a given observed label can serve with minor fit-out.
const COMPATIBLE: Record<string, string[]> = {
  office: ["conference", "reception", "bedroom", "other", "open", "living"],
  conference: ["office", "living", "open", "other"],
  reception: ["living", "open", "office", "other"],
  bedroom: ["office", "other", "living"],
  living: ["open", "other", "reception"],
  storage: ["utility", "other", "office"],
  open: ["living", "other", "reception", "garage"],
};

export function labelCost(req: string, observed: string): number {
  if (req.toLowerCase() === observed) return 0; // a room the user re-labelled for this exact use
  const want = normalizeRoomLabel([req]);
  if (want === observed) return 0;
  if (COMPATIBLE[want]?.includes(observed)) return 15;
  if (want === "other" && ["other", "office", "open", "living", "bedroom"].includes(observed)) return 15;
  return 100;
}

export const IMPLIED_FIXTURES: Record<string, string[]> = {
  bathroom: ["toilet", "sink"],
  kitchen: ["sink", "range"],
};
