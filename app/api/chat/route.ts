import { NextResponse } from "next/server";
import { z } from "zod";
import { chatTurn } from "@/lib/chat/claude";
import { openChat } from "@/lib/chat/converse";
import { City, RequirementSpec } from "@/lib/types";

const Draft = RequirementSpec.omit({ city: true }).extend({ city: City.optional(), useType: z.string() });
const Body = z.union([
  z.object({ open: z.literal(true), spec: Draft }),
  z.object({
    state: z.object({ spec: Draft, asked: z.array(z.enum(["use", "city", "size", "rooms"])).max(10), phase: z.enum(["gathering", "results"]) }),
    text: z.string().min(1).max(2000),
  }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  return NextResponse.json("open" in b ? openChat(b.spec) : await chatTurn(b.state, b.text));
}
