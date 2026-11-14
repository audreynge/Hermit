import type { Draft } from "../spec/survey";

// Must-have chips from the use packs, mapped onto spec needs. Chips without a mapping are kept as preferences.
const SET: Record<string, Partial<Draft["needs"]>> = {
  "Step-free / wheelchair access": { wheelchair: true, stepFree: true },
  "On-site parking": { parking: true }, Parking: { parking: true },
  "Ground floor": { groundFloor: true }, "Street-level storefront": { groundFloor: true },
  "Near transit": { transit: true },
  "Patio / outdoor seating": { outdoorArea: true }, "Outdoor space": { outdoorArea: true },
  "Heavy power": { heavyPower: true }, "Drive-in doors": { driveInBays: 1 }, "ESFR sprinklers": { esfr: true },
};

export function chipOn(chip: string, s: Draft): boolean {
  const set = SET[chip];
  if (!set) return !!s.preferences?.includes(chip);
  return Object.keys(set).every((k) => !!s.needs[k as keyof Draft["needs"]]);
}

export function toggleChip(chip: string, s: Draft, on = !chipOn(chip, s)): Draft {
  const set = SET[chip];
  if (!set) {
    const prefs = new Set(s.preferences ?? []);
    if (on) prefs.add(chip); else prefs.delete(chip);
    return { ...s, preferences: [...prefs] };
  }
  const needs = { ...s.needs };
  for (const [k, v] of Object.entries(set)) {
    if (on) Object.assign(needs, { [k]: v });
    else delete needs[k as keyof typeof needs];
  }
  return { ...s, needs };
}

export const chipsIn = (text: string, chips: string[]) => chips.filter((c) => text.toLowerCase().includes(c.toLowerCase()));
