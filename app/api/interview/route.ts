import { NextResponse } from "next/server";
import { z } from "zod";
import { interviewTurn } from "@/lib/interview/turn";
import { loadShells } from "@/lib/query/load";
import { City, RequirementSpec } from "@/lib/types";

export const runtime = "nodejs";

const Draft = RequirementSpec.omit({ city: true }).extend({ city: City.optional(), useType: z.string() });
const Body = z.object({
  state: z.object({
    spec: Draft,
    asked: z.array(z.string().max(20)).max(30),
    history: z.array(z.object({ role: z.enum(["hermit", "user"]), text: z.string().max(4000) })).max(60),
    field: z.string().max(20).nullable().optional(),
    quick: z.array(z.string().max(80)).max(20).optional(),
    ready: z.boolean().optional(),
  }),
  text: z.string().max(2000).nullable(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const { state, text } = parsed.data;
  return NextResponse.json(await interviewTurn(state as never, text?.trim() || null, loadShells()));
}
