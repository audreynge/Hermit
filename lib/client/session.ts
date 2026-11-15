// One Hermit across the app: other surfaces (the 3D tour) read what the user told Hermit in the studio chat, and post
// what they did back into that chat. The studio listens while it's mounted; otherwise the note is saved for its restore.
import { KEYS, load, save } from "./store";

export type Msg = { id: string; role: "hermit" | "user"; text: string; agent?: string; followUp?: string | null };
type Saved = { iv?: { spec?: { useType?: string; headcount?: number; sizeSqft?: [number, number]; rooms?: { label: string; count: number }[] } }; messages?: Msg[] };

/** What Hermit knows about the user's plans, in one line for a prompt; "" when there's no studio session. */
export function hermitContext(): string {
  const s = load<Saved>(KEYS.chat)?.iv?.spec;
  if (!s?.useType) return "";
  const parts = [s.useType, s.headcount && `${s.headcount} people`, s.sizeSqft && `${s.sizeSqft[0]}–${s.sizeSqft[1]} sq ft`,
    s.rooms?.length && `rooms: ${s.rooms.map((r) => `${r.count} ${r.label}`).join(", ")}`].filter(Boolean);
  return parts.join("; ").slice(0, 300);
}

export type HermitNote = { role: "hermit" | "user"; text: string; agent?: string; followUp?: string | null; handled?: boolean };

export const msgId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The one Hermit conversation: the studio chat's thread, which the report chat reads and writes too. */
export const thread = (): Msg[] => load<Saved>(KEYS.chat)?.messages ?? [];
export function saveThread(messages: Msg[]) {
  save(KEYS.chat, { ...(load<Saved>(KEYS.chat) ?? {}), messages });
}

/** Adds a message to the conversation: a chat that's on screen takes it (and sets handled); otherwise it's saved. */
export function noteToHermit(note: Omit<HermitNote, "handled">) {
  const e = new CustomEvent<HermitNote>("hermit:note", { detail: { ...note } });
  window.dispatchEvent(e);
  if (e.detail.handled) return;
  const { handled: _, ...msg } = e.detail;
  saveThread([...thread(), { id: msgId(), ...msg }]);
}
