import { NextResponse } from "next/server";
import { z } from "zod";
import { chatTurn } from "@/lib/chat/claude";
import { openChat } from "@/lib/chat/converse";
import { describeOutcome, resolveEdit, type EditContext } from "@/lib/design/edit";
import { fitoutContext, FitoutIn, LayoutIn } from "@/lib/design/server";
import { City, RequirementSpec } from "@/lib/types";

const Draft = RequirementSpec.omit({ city: true }).extend({ city: City.optional(), useType: z.string() });
const Body = z.union([
  z.object({ open: z.literal(true), spec: Draft }),
  z.object({
    state: z.object({ spec: Draft, asked: z.array(z.enum(["use", "city", "size", "rooms"])).max(10), phase: z.enum(["gathering", "results"]) }),
    text: z.string().min(1).max(2000),
    layout: LayoutIn.nullish(),
    fitout: FitoutIn.nullish(),
  }),
]);

const EDIT_WORDS = /\b(turn|convert|merge|combine|split|divide|knock|wall|add an? \w+ (to|in)|use the)\b/i;

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  if ("open" in b) return NextResponse.json(openChat(b.spec));

  const ctx: EditContext = { layout: b.layout ?? null };
  let fitoutNote = "";
  if (b.fitout) {
    const f = fitoutContext(b.fitout.shellId, b.fitout.ops, b.state.spec);
    if ("error" in f) fitoutNote = f.error;
    else ctx.fitout = f;
  }
  const turn = await chatTurn(b.state, b.text, undefined, ctx);
  if (!turn.edit) {
    if (fitoutNote && EDIT_WORDS.test(b.text)) return NextResponse.json({ ...turn, reply: `I can't change this space: ${fitoutNote}.`, quickReplies: [] });
    return NextResponse.json(turn);
  }

  const outcome = resolveEdit(turn.edit.target, turn.edit.ops, ctx, turn.state.spec);
  if (!outcome) {
    const why = turn.edit.target === "fitout" ? (fitoutNote ? `I can't change this space: ${fitoutNote}.` : "Pick a space from the results first, then tell me what to change.") : "There's no layout to edit yet. Draw one in Layout Studio first.";
    return NextResponse.json({ ...turn, edit: undefined, reply: why });
  }
  const reply = [turn.reply, describeOutcome(outcome, ctx.fitout?.ops.length ?? 0)].filter(Boolean).join(" ");
  const state = outcome.kind === "layout" ? { ...turn.state, spec: outcome.spec } : turn.state;
  const design = outcome.kind === "layout"
    ? { kind: "layout" as const, blocks: outcome.blocks, applied: outcome.applied.length, rejected: outcome.rejected }
    : { kind: "fitout" as const, shellId: outcome.shellId, ops: outcome.ops, report: outcome.evaluation.after, diff: outcome.evaluation.diff, rejected: outcome.rejected };
  const quickReplies = outcome.kind === "layout" ? ["Search with this", "Undo", "Open in Layout Studio"] : ["Keep these changes", "Undo"];
  return NextResponse.json({ ...turn, edit: undefined, reply, state, design, quickReplies });
}
