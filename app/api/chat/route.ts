import { NextResponse } from "next/server";
import { z } from "zod";
import { chatTurn } from "@/lib/chat/claude";
import { openChat, type Turn } from "@/lib/chat/converse";
import { appendMessages, createConversation, loadConversation, saveState, type StoredMsg } from "@/lib/db/conversations";
import { describeOutcome, resolveEdit, type EditContext } from "@/lib/design/edit";
import { fitoutContext, FitoutIn, LayoutIn } from "@/lib/design/server";
import { Draft } from "@/lib/server/schemas";
import { viewerId } from "@/lib/server/viewer";
import { isLoopback, openaiClient } from "@/lib/llm/openai";
import { geminiClient } from "@/lib/llm/gemini";

const Body = z.union([
  z.object({ open: z.literal(true), spec: Draft, userText: z.string().max(2000).optional() }),
  z.object({
    conversationId: z.string(),
    // Long pastes are trimmed rather than rejected, so the user gets an answer instead of an error.
    text: z.string().min(1).max(20_000).transform((s) => s.slice(0, 2000)),
    // Design edits: the drawn layout and/or the selected scanned space the message may refer to.
    layout: LayoutIn.nullish(),
    fitout: FitoutIn.nullish(),
  }),
]);

const EDIT_WORDS = /\b(turn|convert|merge|combine|split|divide|knock|wall|add an? \w+ (to|in)|use the)\b/i;
const botMsg = (t: Turn, design?: unknown): StoredMsg => ({ role: "bot", kind: "text", payload: { paragraphs: [t.reply], quick: t.quickReplies, card: t.card, fallback: t.fallback, fallbackWhy: t.fallbackWhy, ...(design ? { design } : {}) } });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  const vid = await viewerId();

  if ("open" in b) {
    const turn = openChat(b.spec);
    const id = createConversation(vid, turn.state);
    appendMessages(id, [...(b.userText ? [{ role: "user", kind: "text", payload: { text: b.userText } } as StoredMsg] : []), botMsg(turn)]);
    return NextResponse.json({ conversationId: id, turn });
  }

  const conv = loadConversation(b.conversationId);
  if (!conv) return NextResponse.json({ error: "unknown conversation" }, { status: 404 });
  if (conv.viewerId !== vid) return NextResponse.json({ error: "not your conversation" }, { status: 403 });
  appendMessages(conv.id, [{ role: "user", kind: "text", payload: { text: b.text } }]);

  const ctx: EditContext = { layout: b.layout ?? null };
  let fitoutNote = "";
  if (b.fitout) {
    const f = fitoutContext(b.fitout.shellId, b.fitout.ops, conv.state.spec);
    if ("error" in f) fitoutNote = f.error;
    else ctx.fitout = f;
  }
  const gemini = process.env.ANTHROPIC_API_KEY ? null : await geminiClient().catch((e) => (console.warn(`[hermit] Gemini unavailable (${e instanceof Error ? e.message : e})`), null));
  const openai = process.env.ANTHROPIC_API_KEY || gemini ? null : await openaiClient(isLoopback(req)).catch(() => null);
  let turn = await chatTurn(conv.state, b.text, undefined, { openai, gemini, ctx });
  let design: unknown;

  if (!turn.edit) {
    if (fitoutNote && EDIT_WORDS.test(b.text)) turn = { ...turn, reply: `I can't change this space: ${fitoutNote}.`, quickReplies: [] };
  } else {
    const outcome = resolveEdit(turn.edit.target, turn.edit.ops, ctx, turn.state.spec);
    if (!outcome) {
      const why = turn.edit.target === "fitout" ? (fitoutNote ? `I can't change this space: ${fitoutNote}.` : "Pick a space from the results first, then tell me what to change.") : "There's no layout to edit yet. Draw one with the + button first.";
      turn = { ...turn, edit: undefined, reply: why };
    } else {
      design = outcome.kind === "layout"
        ? { kind: "layout" as const, blocks: outcome.blocks, applied: outcome.applied.length, rejected: outcome.rejected }
        : { kind: "fitout" as const, shellId: outcome.shellId, ops: outcome.ops, report: outcome.evaluation.after, diff: outcome.evaluation.diff, rejected: outcome.rejected };
      turn = {
        ...turn, edit: undefined,
        reply: [turn.reply, describeOutcome(outcome, ctx.fitout?.ops.length ?? 0)].filter(Boolean).join(" "),
        state: outcome.kind === "layout" ? { ...turn.state, spec: outcome.spec } : turn.state,
        quickReplies: outcome.kind === "layout" ? ["Search with this", "Undo", "Open the layout"] : ["Keep these changes", "Undo"],
      };
    }
  }
  appendMessages(conv.id, [botMsg(turn, design)]);
  saveState(conv.id, turn.state);
  return NextResponse.json({ conversationId: conv.id, turn, ...(design ? { design } : {}) });
}
