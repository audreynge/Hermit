import { NextResponse } from "next/server";
import { z } from "zod";
import { loadRun } from "@/lib/agent/replay";
import { appendMessages, loadConversation, saveState } from "@/lib/db/conversations";
import { ChatStateSchema, StoredMsgSchema } from "@/lib/server/schemas";
import { viewerId } from "@/lib/server/viewer";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const conv = loadConversation((await params).id);
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  const vid = await viewerId();
  const run = conv.lastRunId ? loadRun(conv.lastRunId) : null;
  return NextResponse.json({ id: conv.id, owner: conv.viewerId === vid, state: conv.state, messages: conv.messages, run });
}

const Patch = z.object({ messages: z.array(StoredMsgSchema).max(10).default([]), state: ChatStateSchema.optional(), lastRunId: z.string().max(60).nullable().optional() });

export async function POST(req: Request, { params }: Ctx) {
  const conv = loadConversation((await params).id);
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (conv.viewerId !== (await viewerId())) return NextResponse.json({ error: "not your conversation" }, { status: 403 });
  const b = Patch.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: b.error.issues }, { status: 400 });
  if (b.data.messages.length) appendMessages(conv.id, b.data.messages);
  if (b.data.state || b.data.lastRunId !== undefined) saveState(conv.id, (b.data.state ?? conv.state) as never, b.data.lastRunId);
  return NextResponse.json({ ok: true });
}
