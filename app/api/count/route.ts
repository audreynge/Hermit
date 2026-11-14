import { NextResponse } from "next/server";
import { z } from "zod";
import { asSpec } from "@/lib/interview/turn";
import { loadShells } from "@/lib/query/load";
import { funnel } from "@/lib/query/shells";
import { City, RequirementSpec } from "@/lib/types";

export const runtime = "nodejs";
const Draft = RequirementSpec.omit({ city: true }).extend({ city: City.optional(), useType: z.string() });

// Live funnel counts for the counter: how many real scans survive each requirement so far.
export async function POST(req: Request) {
  const parsed = Draft.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  return NextResponse.json({ stages: funnel(asSpec(parsed.data), loadShells()).stages });
}
