import type { City, Mode, RequirementSpec } from "../types";
import { fromLayout, type Block } from "./parse";

// A spec still being filled in by the survey and chat; city may be missing until asked.
export type Draft = Omit<RequirementSpec, "city"> & { city?: City };

export const USE_OPTIONS: { value: string; label: string; useType: string; mode: Mode }[] = [
  { value: "medical", label: "Medical / dental clinic", useType: "medical clinic", mode: "business" },
  { value: "salon", label: "Salon / spa", useType: "salon", mode: "business" },
  { value: "retail", label: "Retail shop", useType: "retail shop", mode: "business" },
  { value: "restaurant", label: "Restaurant / café", useType: "restaurant", mode: "business" },
  { value: "office", label: "Office / studio", useType: "office", mode: "business" },
  { value: "fitness", label: "Fitness studio", useType: "fitness studio", mode: "business" },
  { value: "warehouse", label: "Warehouse / light industrial", useType: "warehouse", mode: "enterprise" },
  { value: "home", label: "Home / live-work", useType: "home", mode: "home" },
];

export const SIZE_OPTIONS: { value: string; label: string; range: [number, number] }[] = [
  { value: "lt1000", label: "Under 1,000 sq ft", range: [300, 1000] },
  { value: "1000-2500", label: "1,000 – 2,500 sq ft", range: [1000, 2500] },
  { value: "2500-5000", label: "2,500 – 5,000 sq ft", range: [2500, 5000] },
  { value: "5000-10000", label: "5,000 – 10,000 sq ft", range: [5000, 10000] },
  { value: "10000+", label: "10,000+ sq ft", range: [10000, 60000] },
];

export const TIMING_OPTIONS = [
  { value: "asap", label: "As soon as possible" },
  { value: "1-3m", label: "In 1–3 months" },
  { value: "3-6m", label: "In 3–6 months" },
  { value: "6m+", label: "6+ months out" },
  { value: "flexible", label: "I'm flexible" },
];

export const REQUIREMENTS = [
  { value: "ada", label: "Step-free / wheelchair access" },
  { value: "parking", label: "On-site Parking" },
  { value: "ground", label: "Ground Floor" },
  { value: "flexible", label: "Flexible Layout" },
  { value: "patient", label: "Patient-friendly" },
  { value: "transit", label: "Transit Nearby" },
] as const;

export type Survey = {
  city?: City;
  transaction: "lease" | "buy";
  useType?: string;
  size?: string;
  budget?: string;
  accessibility: boolean;
  requirements: string[];
  moveIn?: string;
  layoutId?: string;
};

export function parseBudget(text: string, transaction: "lease" | "buy"): { budgetMonthly?: number; budgetTotal?: number } {
  const m = text.toLowerCase().replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m)?/);
  if (!m) return {};
  const v = Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
  const monthly = /month|\/\s*mo|mo\b/.test(text.toLowerCase()) || (transaction === "lease" && v < 100000);
  return monthly ? { budgetMonthly: v } : { budgetTotal: v };
}

export function surveyToSpec(s: Survey): Draft {
  const use = USE_OPTIONS.find((u) => u.value === s.useType);
  const req = new Set(s.requirements);
  const needs: RequirementSpec["needs"] = {};
  if (s.accessibility) Object.assign(needs, { wheelchair: true, stepFree: true });
  if (req.has("ada")) needs.wheelchair = true;
  if (req.has("parking")) needs.parking = true;
  if (req.has("ground")) needs.groundFloor = true;
  if (req.has("transit")) needs.transit = true;
  const preferences = s.requirements.filter((r) => r === "flexible" || r === "patient");
  return {
    mode: use?.mode ?? "business",
    ...(s.city ? { city: s.city } : {}),
    useType: use?.useType ?? "",
    ...(s.size ? { sizeSqft: SIZE_OPTIONS.find((o) => o.value === s.size)?.range } : {}),
    ...parseBudget(s.budget ?? "", s.transaction),
    transaction: s.transaction,
    ...(preferences.length ? { preferences } : {}),
    ...(s.moveIn ? { moveInBy: s.moveIn } : {}),
    rooms: [],
    needs,
    priorities: {},
    input: "survey",
  };
}

/** Adds a saved layout's rooms to a survey draft. The survey's own size and use win; the layout fills what it left blank. */
export function withLayout(d: Draft, blocks: Block[]): Draft {
  const types = new Set(blocks.filter((b) => b.kind !== "object").map((b) => b.label));
  const useType = d.useType || (types.has("exam room") || types.has("procedure room") ? "medical clinic" : types.has("kitchen") && !types.has("office") ? "restaurant" : "office");
  const s = fromLayout(blocks, { mode: d.mode, city: d.city ?? "houston", useType });
  return { ...d, useType, rooms: s.rooms, input: "layout", ...(d.sizeSqft || !s.rooms.length ? {} : { sizeSqft: s.sizeSqft }) };
}

export function layoutSummary(name: string, d: Draft, blocks: Block[]): string {
  const one: Record<string, string> = { reception: "a reception area", storage: "storage", kitchen: "a kitchen", office: "an office" };
  const parts = d.rooms.map((r) => `${r.count > 1 ? `${r.count} ${r.label}s` : one[r.label] ?? `a ${r.label}`}${r.fixtures?.length ? ` with ${r.fixtures.join(" and ")}s` : ""}`);
  const area = Math.round(blocks.filter((b) => b.kind !== "object").reduce((s, b) => s + b.w * b.h, 0));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "an open space";
  return `Use my layout \u201c${name}\u201d: ${list}${blocks.some((b) => b.label === "hallway") ? ", connected by a hallway" : ""} (about ${area.toLocaleString()} sq ft).`;
}
