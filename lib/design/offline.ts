// Deterministic edit parser used when Claude is unavailable. Covers the common phrasings only.
// shortcut: regex intents (add/remove, convert, add fixture, merge, split); anything else asks the user to rephrase or use Layout Studio.
import { normalizeRoomLabel } from "../reason/labels";
import type { RoomGraph } from "../types";
import type { Block } from "../spec/parse";
import { fixtureName, applyFitout } from "./fitout";
import { blockName } from "./layout-ops";
import { roomType } from "./rooms";
import type { EditContext } from "./edit";

export type OfflineEdit = { target: "layout" | "fitout"; ops: object[] } | { target: "ask"; question: string; quickReplies: string[] };
type Ref = { id: string; label: string; name: string };

const NUM: Record<string, number> = { one: 1, a: 1, an: 1, another: 1, two: 2, three: 3, four: 4, five: 5, six: 6, second: 2, third: 3, fourth: 4, first: 1, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4 };
const num = (w: string) => NUM[w] ?? (Number.isInteger(Number(w)) ? Number(w) : null);

/** Finds which listed room a phrase refers to: by id, "label N", "Nth label", or a unique label. */
export function resolveRef(phrase: string, refs: Ref[]): string | "ambiguous" | null {
  const t = ` ${phrase.toLowerCase().replace(/[^a-z0-9.+ ]/g, " ").replace(/\s+/g, " ")} `;
  const byId = refs.find((r) => t.includes(` ${r.id.toLowerCase()} `));
  if (byId) return byId.id;
  const labels = [...new Set(refs.map((r) => r.label))].sort((a, b) => b.length - a.length);
  const label = labels.find((l) => new RegExp(`\\b${l}s?\\b`).test(t) || (roomType(l) && [...t.matchAll(/[a-z]+(?: [a-z]+)?/g)].some((m) => roomType(m[0]) === roomType(l))));
  if (!label) return null;
  const same = refs.filter((r) => r.label === label);
  const after = t.match(new RegExp(`\\b${label}s? #?(\\d+)\\b`))?.[1];
  const before = t.match(new RegExp(`\\b(first|second|third|fourth|1st|2nd|3rd|4th|\\d+)(?: one)? ${label}`))?.[1];
  const n = after ? Number(after) : before ? num(before) : null;
  if (n) return same[n - 1]?.id ?? null;
  return same.length === 1 ? same[0].id : "ambiguous";
}

const layoutRefs = (blocks: Block[]): Ref[] => blocks.filter((b) => b.kind !== "object").map((b) => ({ id: b.id, label: b.label, name: blockName(blocks, b) }));
const graphRefs = (g: RoomGraph): Ref[] => g.rooms.map((r) => ({ id: r.id, label: r.label, name: r.label }));
const ask = (what: string, refs: Ref[], label?: string): OfflineEdit => {
  const opts = refs.filter((r) => !label || r.label === label).slice(0, 4);
  return { target: "ask", question: `Which ${what} do you mean?`, quickReplies: opts.map((r) => r.name === r.label ? `${r.label} ${r.id}` : r.name) };
};

export function offlineEdit(text: string, ctx: EditContext): OfflineEdit | null {
  const t = text.toLowerCase().trim();
  if (ctx.fitout) {
    const g = ctx.fitout.ops.length ? applyFitout(ctx.fitout.graph, ctx.fitout.ops).graph : ctx.fitout.graph;
    const refs = graphRefs(g);
    const fx = t.match(/\badd (?:an? |a new )?([a-z]+(?: [a-z]+)?) (?:to|in|into) (?:the )?(.+)$/);
    if (fx && fixtureName(fx[1])) {
      const id = resolveRef(fx[2], refs);
      if (id === "ambiguous") return ask("room", refs);
      if (id) return { target: "fitout", ops: [{ op: "add_fixture", roomId: id, fixture: fixtureName(fx[1])! }] };
    }
    const conv = t.match(/\b(?:turn|convert|use|make|change)\s+(?:the\s+)?(.+?)\s+(?:into|as|to)\s+(?:an?\s+|another\s+|a second\s+)?(.+?)(?:\s+with\s+an?\s+([a-z]+))?[.!]?$/);
    if (conv) {
      const id = resolveRef(conv[1], refs);
      if (id === "ambiguous") return ask("room", refs, refs.find((r) => conv[1].includes(r.label))?.label);
      if (id) {
        const label = roomType(conv[2]) ?? conv[2].replace(/\s+\d+$/, "").trim();
        const ops: object[] = [{ op: "use_as", roomId: id, label }];
        if (conv[3] && fixtureName(conv[3])) ops.push({ op: "add_fixture", roomId: id, fixture: fixtureName(conv[3])! });
        return { target: "fitout", ops };
      }
    }
    const merge = t.match(/\b(?:merge|combine|join)\s+(?:the\s+)?(.+?)\s+(?:and|with)\s+(?:the\s+)?(.+?)(?:\s+into\s+(?:an?\s+)?(.+))?[.!]?$/);
    if (merge) {
      const a = resolveRef(merge[1], refs), b = resolveRef(merge[2], refs);
      if (a === "ambiguous" || b === "ambiguous") return ask("rooms", refs);
      if (a && b) return { target: "fitout", ops: [{ op: "merge", roomIds: [a, b], ...(merge[3] ? { label: roomType(merge[3]) ?? merge[3] } : {}) }] };
    }
    const split = t.match(/\b(?:split|divide)\s+(?:the\s+)?(.+?)\s+into\s+(\w+)(?:\s+(.+?))?[.!]?$/);
    if (split && num(split[2])) {
      const id = resolveRef(split[1], refs);
      if (id === "ambiguous") return ask("room", refs);
      const label = split[3] ? roomType(split[3]) ?? normalizeRoomLabel([split[3]]) : undefined;
      if (id) return { target: "fitout", ops: [{ op: "split", roomId: id, into: num(split[2])!, ...(label && label !== "other" ? { label } : {}) }] };
    }
  }
  if (ctx.layout) {
    const refs = layoutRefs(ctx.layout);
    const rm = t.match(/\b(?:remove|delete|get rid of|drop|nuke|take out)\s+(?:the\s+)?(.+?)[.!]?$/);
    if (rm) {
      const id = resolveRef(rm[1], refs);
      if (id === "ambiguous") return ask("room", refs, refs.find((r) => rm[1].includes(r.label))?.label);
      if (id) return { target: "layout", ops: [{ op: "remove", id }] };
      return null;
    }
    const add = t.match(/\b(?:add|put in|include|i need|we need)\s+(?:(\w+)\s+)?(?:more\s+|extra\s+|new\s+)?(.+?)(?:\s+next to\s+(?:the\s+)?(.+?))?[.!]?$/) ?? t.match(/\b(another|one more)\s+(.+?)(?:\s+next to\s+(?:the\s+)?(.+?))?[.!]?$/);
    if (add) {
      const type = roomType(add[2]);
      if (!type) return null;
      const n = Math.min(5, add[1] ? num(add[1]) ?? 1 : 1);
      let nextTo: string | undefined;
      if (add[3]) {
        const id = resolveRef(add[3], refs);
        if (id === "ambiguous") return ask("room", refs);
        nextTo = id ?? undefined;
      }
      return { target: "layout", ops: [{ op: "add", label: type, ...(n > 1 ? { count: n } : {}), ...(nextTo ? { nextTo } : {}) }] };
    }
  }
  return null;
}

export const offlineHelp = (ctx: EditContext) =>
  ctx.fitout
    ? "I can do simple changes here, like \"turn bedroom 2 into an exam room\", \"add a sink to the office\", \"merge the living room and kitchen\" or \"split the office into 2\"."
    : `I can add or remove rooms here (for example "add an exam room next to reception"). For anything else, open Layout Studio.`;
