import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestItems } from "@/lib/furnish/suggest";

export const runtime = "nodejs";
export const maxDuration = 30;

const In = z.object({ use: z.string().trim().max(80), room: z.string().trim().min(1).max(40), areaSqm: z.number().positive().max(10_000).optional() });

export async function POST(req: Request) {
  const input = In.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "give use, room and optional areaSqm" }, { status: 400 });
  return NextResponse.json(await suggestItems(input.data));
}
