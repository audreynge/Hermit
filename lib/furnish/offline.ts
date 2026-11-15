// Deterministic furnishing parser, used when Gemini is unavailable or out of quota.
// shortcut: regex intents only (add, remove, move, rotate, recolor, swap); anything else asks the user to rephrase.
import { COLORS, MATERIAL_NAMES, normName } from "./catalog";
import type { Anchor, FurnishOp, Placed } from "./ops";

export type Parsed = { ops: FurnishOp[] } | { ask: string };

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, another: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, pair: 2 };
const COLOR_RE = new RegExp(`\\b(${Object.keys(COLORS).sort((a, b) => b.length - a.length).join("|")}|#[0-9a-f]{6})\\b`, "i");
const MATERIAL_RE = new RegExp(`\\b(${[...MATERIAL_NAMES, "stainless", "steel"].sort((a, b) => b.length - a.length).join("|")})\\b`, "i");
const IT = /\b(it|this|that|this one|that one|the selected one)\b/;
const UNIT: Record<string, number> = { in: 0.0254, inch: 0.0254, inches: 0.0254, '"': 0.0254, "″": 0.0254, ft: 0.3048, foot: 0.3048, feet: 0.3048, "'": 0.3048, "′": 0.3048, cm: 0.01, centimeter: 0.01, centimeters: 0.01, m: 1, meter: 1, meters: 1 };
const LEN = String.raw`(\d+(?:\.\d+)?)\s*(inches|inch|in|feet|foot|ft|centimeters|centimeter|cm|meters|meter|m|["″'′])(?:\s*(\d+(?:\.\d+)?)\s*(?:inches|inch|in|["″]))?`;
/** "30 inches", "3 ft 6 in", "3' 6\"", "75 cm" → meters. */
export function toMeters(n: string, unit: string, extraInches?: string): number {
  return Math.round((Number(n) * (UNIT[unit] ?? 1) + (extraInches ? Number(extraInches) * 0.0254 : 0)) * 1e4) / 1e4;
}
const DIM: Record<string, "w" | "d" | "h"> = { wide: "w", width: "w", long: "w", length: "w", deep: "d", depth: "d", tall: "h", high: "h", height: "h" };

function anchorOf(t: string): Anchor | undefined {
  if (/\b(wall|against|along)\b/.test(t)) return "wall";
  if (/\b(middle|center|centre)\b/.test(t)) return "center";
  if (/\bin front of me\b/.test(t)) return "front";
  if (/\b(here|there|this spot|that spot|where i(?:'m| am) (?:pointing|looking))\b/.test(t)) return "point";
  return undefined;
}

/** The placed item a phrase refers to: "it" → the selection; a name → the selected match, else the newest match. */
function refer(t: string, items: Placed[], selected?: string): string | "none" | "ambiguous" {
  const named = items.filter((p) => new RegExp(`\\b${p.name}s?\\b`).test(t) || new RegExp(`\\b${p.name.split(" ").at(-1)}s?\\b`).test(t));
  if (named.length) return named.find((p) => p.id === selected)?.id ?? named.at(-1)!.id;
  if (IT.test(t) || !items.length) return selected ?? (items.length === 1 ? items[0].id : items.length ? "ambiguous" : "none");
  return selected ?? "ambiguous";
}

const paint = (t: string) => {
  const m = t.match(MATERIAL_RE)?.[1];
  return { color: t.match(COLOR_RE)?.[1], material: m && /^(stainless|steel)$/.test(m) ? "stainless steel" : m };
};

/** The item name in an add request: words after the count, minus colors, materials and placement words. */
function itemName(rest: string): string {
  const cut = rest.split(/\b(?:here|there|against|along|by|next|on|in|into|to|at|near|with|for|please|so|that|which)\b|[,.!?]/)[0];
  return normName(cut.replace(COLOR_RE, " ").replace(MATERIAL_RE, " ").replace(/\b(the|some|new|big|small|large|little)\b/g, " ")).slice(0, 40);
}

export function parseFurnish(text: string, items: Placed[], selected?: string): Parsed {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const target = () => refer(t, items, selected);
  const needTarget = (fn: (id: string) => FurnishOp): Parsed => {
    const id = target();
    if (id === "none") return { ask: "There's nothing placed yet. Try \"add a sofa here\"." };
    if (id === "ambiguous") return { ask: "Which item do you mean? Click it in the tour or name it." };
    return { ops: [fn(id)] };
  };

  if (/\b(remove|delete|get rid of|take away|take out)\b/.test(t)) return needTarget((id) => ({ op: "remove", id }));

  const swap = t.match(/\b(?:swap|replace|switch|exchange)\b.*?\b(?:with|for|to)\s+(?:a|an|the)?\s*([a-z0-9 '-]+)/);
  if (swap) { const name = itemName(swap[1]); if (name) return needTarget((id) => ({ op: "swap", id, name })); }

  // Resizing is proportional: one dimension or a factor sets the scale.
  const sized = t.match(new RegExp(`${LEN}\\s*(wide|long|deep|tall|high)\\b`)) ?? t.match(new RegExp(`\\b(width|length|depth|height)\\b.*?\\bto\\s+${LEN}`));
  if (sized) {
    const [dim, n, unit, inches] = /^\d/.test(sized[1]) ? [sized[4], sized[1], sized[2], sized[3]] : [sized[1], sized[2], sized[3], sized[4]];
    return needTarget((id) => ({ op: "resize", id, [DIM[dim]]: toMeters(n, unit, inches) }));
  }
  const pct = t.match(/(\d+)\s*%\s*(bigger|larger|smaller)/);
  const factor = pct ? 1 + (pct[2] === "smaller" ? -1 : 1) * Number(pct[1]) / 100
    : /\btwice as (big|large)|\bdouble (the size|it)\b/.test(t) ? 2 : /\bhalf (the|its|as) (size|big)/.test(t) ? 0.5
    : /\b(make|a bit|slightly|little)\b.*\b(bigger|larger)\b/.test(t) ? 1.2 : /\b(make|a bit|slightly|little)\b.*\bsmaller\b/.test(t) ? 0.8 : null;
  if (factor && factor > 0) return needTarget((id) => ({ op: "resize", id, scale: factor }));

  // A model that loaded upside down or on its side: tip it over instead of spinning it.
  if (/\bupside[- ]down\b|\bupright\b|\bflip (it |this |the \w+ )?over\b|\bright side up\b/.test(t)) return needTarget((id) => ({ op: "tip", id, axis: "x", degrees: 180 }));
  if (/\b(on|onto) (its|it's|the) side\b|\blying (down|flat)\b|\bstand (it )?up\b/.test(t)) return needTarget((id) => ({ op: "tip", id, axis: "z", degrees: 90 }));
  if (/\b(rotate|turn|spin|flip)\b/.test(t)) {
    const deg = Number(t.match(/(-?\d{1,3})\s*(?:°|deg|degrees?)?/)?.[1] ?? NaN);
    const degrees = /\baround\b|\bflip\b/.test(t) ? 180 : Number.isFinite(deg) ? (/\bleft\b|counter/.test(t) ? -Math.abs(deg) : deg) : /\bleft\b|counter/.test(t) ? -90 : /\bslightly|a bit|a little\b/.test(t) ? 45 : 90;
    return needTarget((id) => ({ op: "rotate", id, degrees }));
  }

  // "put a stove here" adds; "put the stove here" / "move it" moves an existing item.
  if (/\b(move|shift|drag|slide)\b/.test(t) || /\b(put|bring)\s+(it|this|that|the)\b/.test(t)) {
    const at = anchorOf(t);
    if (at) return needTarget((id) => ({ op: "move", id, at }));
  }

  const { color, material } = paint(t);
  if ((color || material) && /\b(make|paint|color|colour|change|turn|recolor|switch|use|finish|in)\b/.test(t) && !/\b(add|place|put|want|need|give)\b/.test(t)) {
    return needTarget((id) => ({ op: "recolor", id, ...(color && { color }), ...(material && { material }) }));
  }

  const add = t.match(/\b(?:add|place|put|i want|i'd like|i need|give me|let's have|drop|set up|install)\s+(?:in\s+)?(a|an|one|two|three|four|five|six|another|some|a couple of|a pair of|\d)?\s*(.+)/);
  if (add) {
    const name = itemName(add[2]);
    if (!name) return { ask: "What would you like to add? For example \"a sofa against the wall\"." };
    const w = add[1]?.split(" ").at(-2) === "of" ? add[1].split(" ")[1] : add[1];
    const count = Math.min(6, Number(w) || NUM[w ?? "a"] || 1);
    return { ops: [{ op: "add", name, at: anchorOf(t) ?? "front", ...(count > 1 && { count }), ...(color && { color }), ...(material && { material }) }] };
  }
  return { ask: "I didn't catch that. Try \"add a stove here\", \"move it against the wall\", \"make it navy\" or \"remove the sofa\"." };
}
