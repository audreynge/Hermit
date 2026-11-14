import { NextResponse } from "next/server";
import { z } from "zod";
import { evaluateFitout } from "@/lib/design/fitout";
import { fitoutContext, FitoutIn } from "@/lib/design/server";
import { RequirementSpec } from "@/lib/types";

// Rescores a candidate with proposed fit-out changes (kept + new). No model call: ops come from chat or the UI.
const Body = z.object({ spec: RequirementSpec, shellId: FitoutIn.shape.shellId, kept: FitoutIn.shape.ops.default([]), ops: z.array(z.unknown()).max(50) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const { spec, shellId, kept, ops } = parsed.data;
  const ctx = fitoutContext(shellId, kept, spec);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.error === "not found" ? 404 : 400 });
  const ev = evaluateFitout(spec, ctx.shell, ctx.graph, ops, ctx.search, kept);
  return NextResponse.json({ shellId, ops: ev.ops, report: ev.after, before: ev.before, diff: ev.diff, rejected: ev.rejected, notes: ev.notes });
}
