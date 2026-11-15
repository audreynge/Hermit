import type { SiteFile } from "../neighborhood/types";
import { useCategory } from "./rules";

// Exclusive-use and same-category scan. Centers often grant one tenant an exclusive for its use (a bakery, a salon),
// which can block yours. CoStar tenant records would show the center's tenants; until the kit is loaded we use mapped
// businesses (OpenStreetMap) on the same block, and always ask the broker.
export type Conflict = { name: string; what: string; meters: number; where: string };

const SAME: Record<string, { label: string; match: (t: Record<string, string>) => boolean }> = {
  restaurant: { label: "restaurant or café", match: (t) => /restaurant|cafe|fast_food/.test(t.amenity ?? "") || /bakery/.test(t.shop ?? "") },
  salon: { label: "salon", match: (t) => /hairdresser|beauty|massage/.test(t.shop ?? "") },
  medical: { label: "clinic", match: (t) => /dentist|doctors|clinic/.test(t.amenity ?? "") },
  retail: { label: "similar shop", match: (t) => /clothes|boutique|gift|cosmetics/.test(t.shop ?? "") },
  fitness: { label: "gym or studio", match: (t) => /fitness_centre|sports_centre/.test(t.leisure ?? "") },
};

const where = (m: number) => (m <= 25 ? "next door" : m <= 60 ? "a few doors down" : "on the same block");
const what = (t: Record<string, string>) => (t.shop ?? t.amenity ?? t.leisure ?? "business").replace(/_/g, " ");

export function exclusiveScan(site: SiteFile | null, useType: string): { conflicts: Conflict[]; question: string | null } {
  const use = useCategory(useType);
  const same = SAME[use];
  if (!same) return { conflicts: [], question: null };
  const question = `Does any tenant in this building or center hold an exclusive for ${same.label} use, or would my use need landlord approval?`;
  if (!site?.osmSource) return { conflicts: [], question };
  const conflicts = site.pois
    .filter((p) => (p.km ?? 9) <= 0.12 && same.match(p.tags))
    .sort((a, b) => (a.km ?? 0) - (b.km ?? 0))
    .slice(0, 4)
    .map((p) => { const m = Math.round((p.km ?? 0) * 1000); return { name: p.name ?? `A ${what(p.tags)}`, what: what(p.tags), meters: m, where: where(m) }; });
  return { conflicts, question };
}
