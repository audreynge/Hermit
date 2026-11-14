import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODEL } from "../agent/model";
import { ask, type ChatState, type Slot, type Turn } from "../chat/converse";
import { fromLayout, type Block } from "../spec/parse";
import type { Draft } from "../spec/survey";
import type { RoomReq } from "../types";

export const FloorPlanSchema = z.object({
  isFloorPlan: z.boolean(),
  rooms: z.array(z.object({ label: z.string(), count: z.number(), approxSqft: z.number().nullable(), fixtures: z.array(z.string()) })),
  totalSqft: z.number().nullable(),
  notes: z.string(),
});
export type FloorPlanExtraction = z.infer<typeof FloorPlanSchema>;
export type UploadFile = { mediaType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf"; base64: string };

const MAX_PDF = 10 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024; // Claude's per-image limit
const TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export function validateUpload(size: number, type: string): { status: 413 | 415; error: string } | null {
  if (!TYPES.includes(type)) return { status: 415, error: "Upload a PNG, JPEG, WebP or PDF floor plan." };
  if (type === "application/pdf" && size > MAX_PDF) return { status: 413, error: "That PDF is over 10 MB. Try a single-page PDF or an image." };
  if (type !== "application/pdf" && size > MAX_IMAGE) return { status: 413, error: "That image is over 5 MB. Try a smaller image or a PDF." };
  return null;
}

function inferUse(labels: string[], fallback: string): string {
  const t = labels.join(" ").toLowerCase();
  if (/exam|procedure|operator|treatment/.test(t)) return "medical clinic";
  if (/styling|shampoo|salon|nail/.test(t)) return "salon";
  if (/dining/.test(t) && /kitchen/.test(t)) return "restaurant";
  if (/warehouse|loading|dock/.test(t)) return "warehouse";
  return fallback || "office";
}

export function designToDraft(x: FloorPlanExtraction | Block[], base: Draft): Draft {
  if (Array.isArray(x)) {
    const useType = base.useType || inferUse(x.filter((b) => b.kind !== "object").map((b) => b.label), "");
    const s = fromLayout(x, { mode: base.mode, city: base.city ?? "houston", useType });
    return { ...base, useType, rooms: s.rooms, sizeSqft: s.sizeSqft, layout: s.layout, input: "layout" };
  }
  const rooms: RoomReq[] = x.rooms.filter((r) => r.label.trim()).map((r) => ({
    label: r.label.toLowerCase(), count: Math.max(1, Math.round(r.count)), hard: false,
    ...(r.approxSqft ? { minSqft: Math.round(r.approxSqft * 0.85) } : {}),
    ...(r.fixtures.length ? { fixtures: r.fixtures.map((f) => f.toLowerCase()) } : {}),
  }));
  const total = x.totalSqft ?? x.rooms.reduce((s, r) => s + (r.approxSqft ?? 0) * r.count, 0);
  return {
    ...base, rooms, input: "layout",
    useType: base.useType || inferUse(rooms.map((r) => r.label), ""),
    ...(total ? { sizeSqft: [Math.round(total), Math.round(total * 1.5)] as [number, number] } : {}),
  };
}

export function applyDesign(state: ChatState, x: FloorPlanExtraction | Block[]): Turn {
  if (!Array.isArray(x) && (!x.isFloorPlan || !x.rooms.length)) {
    return {
      reply: x.isFloorPlan
        ? "I couldn't make out any rooms in that plan. A clearer image or a PDF with room labels works best, or you can draw it instead."
        : "That doesn't look like a floor plan. Could you upload a plan drawing, a photo of a sketch, or a PDF? You can also draw it instead.",
      state, ready: false, quickReplies: ["Draw a layout"],
    };
  }
  const spec = designToDraft(x, state.spec);
  const rooms = spec.rooms.map((r) => (r.count > 1 ? `${r.count} ${r.label}s` : `a ${r.label}`)).join(", ");
  const lead = Array.isArray(x) ? "Got your layout. " : `I read your floor plan${rooms ? `: ${rooms}` : ""}. `;
  return ask({ ...state, spec, asked: [...new Set<Slot>([...state.asked, "size", "rooms"])] }, lead);
}

const ONE: Record<string, string> = { reception: "a reception area", storage: "storage", kitchen: "a kitchen", office: "an office" };

export function layoutSummary(blocks: Block[]): string {
  const s = fromLayout(blocks, { mode: "business", city: "houston", useType: "office" });
  const area = Math.round(blocks.filter((b) => b.kind !== "object").reduce((t, b) => t + b.w * b.h, 0));
  const parts = s.rooms.map((r) => {
    const name = r.count > 1 ? `${r.count} ${r.label}s` : ONE[r.label] ?? `a ${r.label}`;
    const fx = r.fixtures?.length ? ` with ${r.count > 1 ? r.fixtures.map((f) => `${f}s`).join(" and ") : `a ${r.fixtures.join(" and a ")}`}` : "";
    return name + fx;
  });
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "an open space";
  const hall = blocks.some((b) => b.kind !== "object" && b.label === "hallway") ? ", connected by a hallway" : "";
  return `Here's my layout: ${list}${hall} (about ${area.toLocaleString()} sq ft). Find the closest match.`;
}

const PROMPT = `This should be a floor plan of a commercial space or home. Set isFloorPlan false if it is not a floor plan, sketch or plan drawing.
List each kind of room with how many there are, the approximate area of one room in square feet (null if no scale or dimensions are shown), and plumbing fixtures shown (sink, toilet, shower, hood). Use short labels like "exam room", "office", "reception", "bathroom", "storage", "kitchen", "conference". Give the total area if it is written or can be read from dimensions, else null. Do not invent rooms that are not drawn.`;

export async function extractFloorPlan(file: UploadFile, client?: Pick<Anthropic, "messages"> | null): Promise<FloorPlanExtraction> {
  const c = client !== undefined ? client : process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  if (!c) throw new Error("Reading uploaded plans needs the Claude API key");
  const block = file.mediaType === "application/pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: file.base64 } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: file.mediaType, data: file.base64 } };
  const res = await c.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: "medium", format: zodOutputFormat(FloorPlanSchema) },
    messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
  });
  if (!res.parsed_output) throw new Error("Couldn't read that floor plan");
  return res.parsed_output;
}
