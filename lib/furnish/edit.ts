// Chat text → furnishing ops. Gemini picks typed ops; the browser applies them (it knows the camera and clicked point).
// Without Gemini, or when it fails, the offline parser runs and the reply says so.
import { z } from "zod";
import { unflatten } from "../design/edit";
import { geminiClient, geminiJson, type GeminiClient } from "../llm/gemini";
import { MATERIAL_NAMES, normName, type FurnishItem } from "./catalog";
import { parseFurnish } from "./offline";

const FlatOp = z.object({
  op: z.enum(["add", "move", "rotate", "remove", "recolor", "swap", "resize"]),
  id: z.string().nullish(), name: z.string().nullish(), terms: z.array(z.string()).nullish(), count: z.number().nullish(),
  at: z.enum(["point", "front", "center", "wall"]).nullish(), color: z.string().nullish(), material: z.string().nullish(), degrees: z.number().nullish(),
  w: z.number().nullish(), d: z.number().nullish(), h: z.number().nullish(),
  dim: z.enum(["w", "d", "h"]).nullish(), value: z.number().nullish(), unit: z.enum(["in", "ft", "cm", "m"]).nullish(), scale: z.number().nullish(),
});
const Out = z.object({ reply: z.string(), ops: z.array(FlatOp) });
const SCHEMA = z.toJSONSchema(Out);

const PROMPT = `You place and edit 3D furniture inside a virtual tour of a real space. Turn the user's message into ops; code applies them.
Ops:
- add {name, terms, count?, at, color?, material?, w?, d?, h?}: name = 1-3 plain words; terms = 2-3 search words from specific to generic that would match a low-poly 3D model title; w/d/h = typical size in meters when it is unusual.
- resize {id, dim, value, unit} or resize {id, scale}: always proportional; dim = w (width), d (depth) or h (height), value and unit exactly as the user said them (in, ft, cm, m; "3 ft 6 in" = value 42, unit in); scale for "20% bigger" (1.2), "half the size" (0.5).
- move {id, at}, rotate {id, degrees} (positive = clockwise from above, "around" = 180), remove {id}, recolor {id, color?, material?}, swap {id, name, terms} (a different kind or model of item in the same spot).
at: "point" = the spot the user clicked or is pointing at ("here", "there", "this spot"); "front" = in front of them (default for add); "center" = middle of the room; "wall" = against the nearest wall.
color: a plain color name or #rrggbb. material: one of ${MATERIAL_NAMES.join(", ")}.
Use only listed item ids. "it"/"this" means the selected item. If the message is unclear, or names an item that isn't placed, return no ops and ask one short question in reply.
Never use vague search terms like "furniture", "equipment" or "appliance".
reply: one short friendly sentence saying what you did.`;

export type EditIn = { text: string; items: { id: string; name: string }[]; selected?: string; room?: string; suggestions?: FurnishItem[] };
export type EditOut = { ops: object[]; reply: string; source: "gemini" | "offline" };

/** Fills missing terms/size on adds from the room's suggestions ("add a noodle cooker" gets its search words and size). */
function enrich(ops: object[], suggestions: FurnishItem[] = []): object[] {
  return ops.map((o) => {
    const op = o as { op: string; name?: string; terms?: string[]; size?: object };
    if (op.op !== "add" || !op.name) return o;
    const s = suggestions.find((x) => x.name === normName(op.name!));
    return s ? { ...op, terms: op.terms?.length ? op.terms : s.terms, size: op.size ?? s.size } : o;
  });
}

const UNIT_M = { in: 0.0254, ft: 0.3048, cm: 0.01, m: 1 } as const;
const toOps = (flat: z.infer<typeof FlatOp>[]) => unflatten(flat).map(({ w, d, h, dim, value, unit, ...o }) => {
  if (o.op === "resize") return dim && value ? { ...o, [dim]: Math.round(value * UNIT_M[(unit as keyof typeof UNIT_M | undefined) ?? "in"] * 1e4) / 1e4 } : o; // code converts units
  return w && d && h ? { ...o, size: { w, d, h } } : o;
});

function offline(input: EditIn, why?: string): EditOut {
  const items = input.items.map((i) => ({ ...i, terms: [i.name], size: { w: 1, d: 1, h: 1 }, approxSize: false, pos: { x: 0, y: 0, z: 0 }, rotY: 0 }));
  const p = parseFurnish(input.text, items, input.selected);
  const note = why ? " (simple mode: the AI assistant isn't available right now)" : "";
  if ("ask" in p) return { ops: [], reply: p.ask + note, source: "offline" };
  return { ops: enrich(p.ops, input.suggestions), reply: `Done${note}.`, source: "offline" };
}

export async function furnishEdit(input: EditIn, gemini?: GeminiClient | null): Promise<EditOut> {
  const g = gemini !== undefined ? gemini : await geminiClient().catch(() => null);
  if (!g) return offline(input);
  const lines = [
    `Room: ${input.room ?? "unknown"}`,
    `Placed items: ${input.items.length ? input.items.map((i) => `${i.id} ${i.name}${i.id === input.selected ? " (selected)" : ""}`).join("; ") : "none"}`,
    input.suggestions?.length ? `Suggested items for this room: ${input.suggestions.map((s) => s.name).join(", ")}` : "",
    `User: ${input.text.slice(0, 500)}`,
  ].filter(Boolean);
  try {
    const out = Out.safeParse(await geminiJson(g, PROMPT, [{ text: lines.join("\n") }], SCHEMA));
    if (!out.success) return offline(input, "bad output");
    return { ops: enrich(toOps(out.data.ops), input.suggestions), reply: out.data.reply.slice(0, 300), source: "gemini" };
  } catch (e) {
    console.warn(`[hermit] furnish edit fell back (${e instanceof Error ? e.message : e})`);
    return offline(input, "error");
  }
}
