import { randomBytes } from "node:crypto";
import { db, tx } from "./index";
import type { ChatState } from "../chat/converse";
import type { RequirementSpec, ShellReport } from "../types";

export type StoredMsg = { role: "user" | "bot"; kind: "text" | "thinking" | "compare" | "design" | "results"; payload: unknown };
export type StoredRow = StoredMsg & { id: string; seq: number; createdAt: string };

const ID = /^c_[a-f0-9]{24}$/;
const now = () => new Date().toISOString();
// state_json holds the chat state plus the run whose results the chat last showed.
type Blob = { chat: ChatState; lastRunId: string | null };

export function createConversation(viewerId: string, chat: ChatState): string {
  const id = `c_${randomBytes(12).toString("hex")}`;
  const t = now();
  db().prepare("INSERT INTO conversations (id, viewer_id, created_at, updated_at, state_json) VALUES (?, ?, ?, ?, ?)")
    .run(id, viewerId, t, t, JSON.stringify({ chat, lastRunId: null } satisfies Blob));
  return id;
}

export function appendMessages(id: string, msgs: StoredMsg[]) {
  tx(() => {
    const d = db();
    const { m } = d.prepare("SELECT coalesce(max(seq), 0) AS m FROM messages WHERE conversation_id = ?").get(id) as { m: number };
    const ins = d.prepare("INSERT INTO messages (id, conversation_id, seq, role, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    msgs.forEach((msg, i) => ins.run(randomBytes(8).toString("hex"), id, m + i + 1, msg.role, msg.kind, JSON.stringify(msg.payload), now()));
    d.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), id);
  });
}

export function saveState(id: string, chat: ChatState, lastRunId?: string | null) {
  const cur = loadConversation(id);
  if (!cur) return;
  db().prepare("UPDATE conversations SET state_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify({ chat, lastRunId: lastRunId === undefined ? cur.lastRunId : lastRunId } satisfies Blob), now(), id);
}

export function loadConversation(id: string) {
  if (!ID.test(id)) return null;
  const c = db().prepare("SELECT viewer_id, state_json FROM conversations WHERE id = ?").get(id) as { viewer_id: string; state_json: string } | undefined;
  if (!c) return null;
  const blob = JSON.parse(c.state_json) as Blob;
  const rows = db().prepare("SELECT id, seq, role, kind, payload_json, created_at FROM messages WHERE conversation_id = ? ORDER BY seq").all(id) as
    { id: string; seq: number; role: StoredMsg["role"]; kind: StoredMsg["kind"]; payload_json: string; created_at: string }[];
  return {
    id, viewerId: c.viewer_id, state: blob.chat, lastRunId: blob.lastRunId,
    messages: rows.map((r): StoredRow => ({ id: r.id, seq: r.seq, role: r.role, kind: r.kind, payload: JSON.parse(r.payload_json), createdAt: r.created_at })),
  };
}

export function saveSpace(viewerId: string, report: ShellReport, spec: RequirementSpec) {
  db().prepare("INSERT OR REPLACE INTO saved (viewer_id, shell_id, report_json, spec_json, saved_at) VALUES (?, ?, ?, ?, ?)")
    .run(viewerId, report.shellId, JSON.stringify(report), JSON.stringify(spec), now());
}

export function unsaveSpace(viewerId: string, shellId: string) {
  db().prepare("DELETE FROM saved WHERE viewer_id = ? AND shell_id = ?").run(viewerId, shellId);
}

export function listSaved(viewerId: string): { report: ShellReport; spec: RequirementSpec; savedAt: string }[] {
  const rows = db().prepare("SELECT report_json, spec_json, saved_at FROM saved WHERE viewer_id = ? ORDER BY saved_at DESC").all(viewerId) as
    { report_json: string; spec_json: string; saved_at: string }[];
  return rows.map((r) => ({ report: JSON.parse(r.report_json), spec: JSON.parse(r.spec_json), savedAt: r.saved_at }));
}
