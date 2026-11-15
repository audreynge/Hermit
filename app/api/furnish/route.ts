import { NextResponse } from "next/server";
import { z } from "zod";
import { generateJSON, hasGemini } from "@/lib/llm/gemini";
import { FURNITURE } from "@/lib/spec/furnish";
import { parseFurnish } from "@/lib/spec/place";

export const runtime = "nodejs";

const Body = z.object({ text: z.string().min(1).max(500), rooms: z.array(z.object({ id: z.string().max(60), name: z.string().max(60) })).max(80) });
const TYPES = FURNITURE.map((f) => f.type);
const Out = z.object({
  reply: z.string(),
  actions: z.array(z.object({ op: z.enum(["add", "remove"]), type: z.enum(TYPES as [string, ...string[]]), count: z.number(), roomId: z.string().nullable(), wall: z.enum(["north", "south", "east", "west"]).nullable() })),
});

// Turns "add 3 salon chairs along the north wall of Room 2" into placement actions. Placement itself is done
// deterministically on the client against the measured room outline, so the model never invents a position.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const { text, rooms } = parsed.data;
  if (hasGemini()) {
    try {
      const out = await generateJSON(
        `You turn furniture requests into actions for a floor plan. Furniture types (use exactly): ${TYPES.join(", ")} ("salon chair" = styling chair, "shampoo bowl" = shampoo sink, "exam bed" = exam table). Rooms (use the id): ${rooms.map((r) => `${r.id} = ${r.name}`).join("; ")}. If the user doesn't name a room, roomId is null. "reply": one short friendly sentence.`,
        [{ role: "user", parts: [{ text }] }], Out, 8000);
      if (out?.actions.length) return NextResponse.json({ ...out, llm: true });
    } catch { /* fall through to the rule-based parser */ }
  }
  const actions = parseFurnish(text, rooms);
  return NextResponse.json({ reply: actions.length ? "" : "I couldn't tell which furniture you meant. Try “add 3 chairs to reception”.", actions, llm: false });
}
