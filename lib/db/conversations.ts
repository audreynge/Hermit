import { randomBytes } from "node:crypto";
import { q } from "./index";
import type { ChatState } from "../chat/converse";
import type { RequirementSpec, ShellReport } from "../types";

export type StoredMsg = { role: "user" | "bot"; kind: "text" | "thinking" | "compare" | "design" | "results" | "regulations"; payload: unknown };
export type StoredRow = StoredMsg & { id: string; seq: number; createdAt: string };

const ID = /^c_[a-f0-9]{24}$/;
const now = () => new Date().toISOString();
// state_json holds the chat state plus the run whose results the chat last showed.
type Blob = { chat: ChatState; lastRunId: string | null };

export async function createConversation(viewerId: string, chat: ChatState): Promise<string> {
  const id = `c_${randomBytes(12).toString("hex")}`;
  const t = now();
  await q("INSERT INTO conversations (id, viewer_id, created_at, updated_at, state_json) VALUES (?, ?, ?, ?, ?)",
    [id, viewerId, t, t, JSON.stringify({ chat, lastRunId: null } satisfies Blob)]);
  return id;
}

// seq is computed in the INSERT itself; the unique (conversation_id, seq) index rejects a concurrent duplicate.
export async function appendMessages(id: string, msgs: StoredMsg[]) {
  for (const msg of msgs)
    await q("INSERT INTO messages (id, conversation_id, seq, role, kind, payload_json, created_at) VALUES (?, ?, (SELECT coalesce(max(seq), 0) + 1 FROM messages WHERE conversation_id = ?), ?, ?, ?, ?)",
      [randomBytes(8).toString("hex"), id, id, msg.role, msg.kind, JSON.stringify(msg.payload), now()]);
  await q("UPDATE conversations SET updated_at = ? WHERE id = ?", [now(), id]);
}

export async function saveState(id: string, chat: ChatState, lastRunId?: string | null) {
  const [cur] = await q<{ state_json: string }>("SELECT state_json FROM conversations WHERE id = ?", [id]);
  if (!cur) return;
  const keep = (JSON.parse(cur.state_json) as Blob).lastRunId;
  await q("UPDATE conversations SET state_json = ?, updated_at = ? WHERE id = ?",
    [JSON.stringify({ chat, lastRunId: lastRunId === undefined ? keep : lastRunId } satisfies Blob), now(), id]);
}

export async function loadConversation(id: string) {
  if (!ID.test(id)) return null;
  const [c] = await q<{ viewer_id: string; state_json: string }>("SELECT viewer_id, state_json FROM conversations WHERE id = ?", [id]);
  if (!c) return null;
  const blob = JSON.parse(c.state_json) as Blob;
  const rows = await q<{ id: string; seq: number; role: StoredMsg["role"]; kind: StoredMsg["kind"]; payload_json: string; created_at: string }>(
    "SELECT id, seq, role, kind, payload_json, created_at FROM messages WHERE conversation_id = ? ORDER BY seq", [id]);
  return {
    id, viewerId: c.viewer_id, state: blob.chat, lastRunId: blob.lastRunId,
    messages: rows.map((r): StoredRow => ({ id: r.id, seq: r.seq, role: r.role, kind: r.kind, payload: JSON.parse(r.payload_json), createdAt: r.created_at })),
  };
}

export async function saveSpace(viewerId: string, report: ShellReport, spec: RequirementSpec) {
  await q(`INSERT INTO saved (viewer_id, shell_id, report_json, spec_json, saved_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (viewer_id, shell_id) DO UPDATE SET report_json = excluded.report_json, spec_json = excluded.spec_json, saved_at = excluded.saved_at`,
    [viewerId, report.shellId, JSON.stringify(report), JSON.stringify(spec), now()]);
}

export async function unsaveSpace(viewerId: string, shellId: string) {
  await q("DELETE FROM saved WHERE viewer_id = ? AND shell_id = ?", [viewerId, shellId]);
}

export async function listSaved(viewerId: string): Promise<{ report: ShellReport; spec: RequirementSpec; savedAt: string }[]> {
  const rows = await q<{ report_json: string; spec_json: string; saved_at: string }>(
    "SELECT report_json, spec_json, saved_at FROM saved WHERE viewer_id = ? ORDER BY saved_at DESC", [viewerId]);
  return rows.map((r) => ({ report: JSON.parse(r.report_json), spec: JSON.parse(r.spec_json), savedAt: r.saved_at }));
}
