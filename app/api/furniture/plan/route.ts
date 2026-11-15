import { NextResponse } from "next/server";
import { z } from "zod";
import { planFurnish } from "@/lib/furnish/plan";

export const runtime = "nodejs";
export const maxDuration = 30;

// Labels and names go back into a prompt, so they are held to plain words; geometry is bounded.
const Plain = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 '&/-]*$/);
const N = z.number().finite();
const P = z.object({ x: N, y: N });
const Size = z.object({ w: N.positive(), d: N.positive(), h: N.positive() });
const In = z.object({
  text: z.string().trim().min(1).max(500),
  use: z.string().trim().max(80).default(""),
  rooms: z.array(z.object({
    id: z.string().max(60), label: Plain, polygon: z.array(P).min(3).max(200), ceiling: N.positive().max(20).optional(),
    doors: z.array(z.object({ at: P, width: N.positive().max(5) })).max(20), objects: z.array(Plain).max(30),
  })).min(1).max(12),
  placed: z.array(z.object({ name: Plain, pos: z.object({ x: N, z: N }), size: Size, rotY: N })).max(60),
  access: z.object({ chairWidthIn: N.min(16).max(40) }).optional(), // same plausible range as Needs.chairWidthIn
});

export async function POST(req: Request) {
  const input = In.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "bad furnishing plan request" }, { status: 400 });
  return NextResponse.json(await planFurnish(input.data));
}
