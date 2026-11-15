import { Check } from "lucide-react";
import type { RequirementSpec } from "@/lib/types";

const fmt = (n: number) => Math.round(n).toLocaleString();
const plural = (n: number, w: string) => (n === 1 || w.endsWith("s") ? w : `${w}s`);

// The requirements a search runs on, restated so the user can catch a misheard one.
export function specItems(s: RequirementSpec): string[] {
  const out: string[] = [];
  if (s.useType && s.useType !== "space") out.push(`${s.useType[0].toUpperCase()}${s.useType.slice(1)} use`);
  if (s.sizeSqft) out.push(s.sizeSqft[0] ? `${fmt(s.sizeSqft[0])} – ${fmt(s.sizeSqft[1])} sq ft` : `Up to ${fmt(s.sizeSqft[1])} sq ft`);
  const rooms = [...s.rooms].sort((a, b) => b.count - a.count).map((r) => `${r.count} ${plural(r.count, r.label)}`);
  if (rooms[0]) out.push(rooms[0]);
  if (s.budgetMonthly) out.push(`≤ $${fmt(s.budgetMonthly)}/month`);
  else if (s.budgetTotal) out.push(`≤ $${fmt(s.budgetTotal)} total`);
  if (rooms[1]) out.push(rooms[1]);
  if (s.needs?.wheelchair) out.push("Wheelchair accessible");
  return out.slice(0, 4);
}

export function SpecChecklist({ spec }: { spec: RequirementSpec }) {
  const items = specItems(spec);
  if (!items.length) return null;
  return (
    <ul className="spec-checklist" aria-label="Searching for">
      {items.map((t) => <li key={t}><Check aria-hidden="true" strokeWidth={2.5} /> {t}</li>)}
    </ul>
  );
}
