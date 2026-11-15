import { NextResponse } from "next/server";
import { z } from "zod";
import { planFurnishing } from "@/lib/furnish/plan";

export const runtime = "nodejs";
export const maxDuration = 60;

// Room labels and the brief go back into a prompt, so labels are held to plain words.
const Plain = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 '&/-]*$/);
const In = z.object({
  use: z.string().trim().max(80),
  brief: z.string().trim().max(500).optional(),
  rooms: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), label: Plain, areaSqm: z.number().positive().max(10_000).optional() })).min(1).max(24),
});

export async function POST(req: Request) {
  const input = In.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "give use, rooms and an optional brief" }, { status: 400 });
  return NextResponse.json(await planFurnishing(input.data));
}
