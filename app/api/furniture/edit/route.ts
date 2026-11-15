import { NextResponse } from "next/server";
import { z } from "zod";
import { furnishEdit } from "@/lib/furnish/edit";

export const runtime = "nodejs";
export const maxDuration = 30;

// Item names and suggestions are user/LLM text that goes back into a prompt, so they are held to plain words.
const Plain = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 '&/-]*$/);
const Id = z.string().regex(/^f\d{1,4}$/);
const In = z.object({
  text: z.string().trim().min(1).max(500),
  items: z.array(z.object({ id: Id, name: Plain })).max(60),
  selected: Id.optional(),
  room: Plain.optional(),
  suggestions: z.array(z.object({ name: Plain, terms: z.array(Plain).max(3), size: z.object({ w: z.number(), d: z.number(), h: z.number() }) })).max(12).optional(),
});

export async function POST(req: Request) {
  const input = In.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "bad furnishing request" }, { status: 400 });
  return NextResponse.json(await furnishEdit(input.data));
}
