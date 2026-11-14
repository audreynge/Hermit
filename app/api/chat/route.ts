import { NextResponse } from "next/server";
import { z } from "zod";
import { chatTurn } from "@/lib/chat/claude";
import { openChat, type Turn } from "@/lib/chat/converse";
import { appendMessages, createConversation, loadConversation, saveState, type StoredMsg } from "@/lib/db/conversations";
import { Draft } from "@/lib/server/schemas";
import { viewerId } from "@/lib/server/viewer";

const Body = z.union([
  z.object({ open: z.literal(true), spec: Draft, userText: z.string().max(2000).optional() }),
  z.object({ conversationId: z.string(), text: z.string().min(1).max(2000) }),
]);

const botMsg = (t: Turn): StoredMsg => ({ role: "bot", kind: "text", payload: { paragraphs: [t.reply], quick: t.quickReplies, card: t.card } });

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
  const turn = await chatTurn(conv.state, b.text);
  appendMessages(conv.id, [botMsg(turn)]);
  saveState(conv.id, turn.state);
  return NextResponse.json({ conversationId: conv.id, turn });
}
