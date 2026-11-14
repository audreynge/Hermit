import { NextResponse } from "next/server";
import { z } from "zod";
import { researchRegulations } from "@/lib/regs/research";
import { City } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const Q = z.object({ city: City, useType: z.string().min(2).max(60) });

export async function GET(req: Request) {
  const p = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) return NextResponse.json({ error: p.error.issues }, { status: 400 });
  return NextResponse.json(await researchRegulations(p.data));
}
