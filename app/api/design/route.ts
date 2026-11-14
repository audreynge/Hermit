import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { type Turn } from "@/lib/chat/converse";
import { db } from "@/lib/db";
import { appendMessages, loadConversation, saveState, type StoredMsg } from "@/lib/db/conversations";
import { applyDesign, extractFloorPlan, layoutSummary, validateUpload, type UploadFile } from "@/lib/design/extract";
import { viewerId } from "@/lib/server/viewer";

export const runtime = "nodejs";
export const maxDuration = 60;

const BlockSchema = z.object({ id: z.string().max(40), label: z.string().min(1).max(40), kind: z.enum(["room", "object"]).optional(), x: z.number(), y: z.number(), w: z.number().positive().max(500), h: z.number().positive().max(500) });
const Json = z.object({ conversationId: z.string(), blocks: z.array(BlockSchema).min(1).max(120) });

const saveDesign = (conversationId: string, kind: "layout" | "upload", json: unknown) =>
  db().prepare("INSERT INTO designs (id, conversation_id, kind, json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(`d_${randomBytes(8).toString("hex")}`, conversationId, kind, JSON.stringify(json), new Date().toISOString());
const botMsg = (t: Turn): StoredMsg => ({ role: "bot", kind: "text", payload: { paragraphs: [t.reply], quick: t.quickReplies, card: t.card } });

async function ownedConversation(id: string) {
  const conv = loadConversation(id);
  if (!conv) return { error: NextResponse.json({ error: "unknown conversation" }, { status: 404 }) };
  if (conv.viewerId !== (await viewerId())) return { error: NextResponse.json({ error: "not your conversation" }, { status: 403 }) };
  return { conv };
}

export async function POST(req: Request) {
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return NextResponse.json({ error: "attach a file" }, { status: 400 });
    const { conv, error } = await ownedConversation(String(form.get("conversationId") ?? ""));
    if (error) return error;
    const bad = validateUpload(file.size, file.type);
    if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });

    let turn: Turn;
    try {
      const x = await extractFloorPlan({ mediaType: file.type as UploadFile["mediaType"], base64: Buffer.from(await file.arrayBuffer()).toString("base64") });
      saveDesign(conv.id, "upload", { name: file.name, extraction: x });
      turn = applyDesign(conv.state, x);
    } catch (e) {
      console.warn(`[hermit] floor-plan upload failed (${e instanceof Error ? e.message : e})`);
      const noKey = /key/i.test(String(e));
      turn = {
        reply: noKey ? "Reading uploaded plans needs an AI provider key (Claude or Gemini), which isn't set up here yet. You can draw the layout instead." : "I couldn't read that file. Try a clearer image or a one-page PDF, or draw the layout instead.",
        state: conv.state, ready: false, quickReplies: ["Draw a layout"],
      };
    }
    appendMessages(conv.id, [{ role: "user", kind: "design", payload: { kind: "upload", name: file.name } }, botMsg(turn)]);
    saveState(conv.id, turn.state);
    return NextResponse.json({ conversationId: conv.id, turn });
  }

  const parsed = Json.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const { conv, error } = await ownedConversation(parsed.data.conversationId);
  if (error) return error;
  const blocks = parsed.data.blocks;
  saveDesign(conv.id, "layout", { blocks });
  const turn = applyDesign(conv.state, blocks);
  appendMessages(conv.id, [{ role: "user", kind: "design", payload: { kind: "layout", blocks, summary: layoutSummary(blocks) } }, botMsg(turn)]);
  saveState(conv.id, turn.state);
  return NextResponse.json({ conversationId: conv.id, turn });
}
