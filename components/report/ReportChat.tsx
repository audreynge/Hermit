"use client";
import { MessageCircle, Minus, Plus, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isSaved, toggleSaved } from "@/lib/client/persist";
import { KEYS, load, save } from "@/lib/client/store";
import type { FitoutDiff, FitoutOp } from "@/lib/design/fitout";
import { intent, screenText, TABS } from "@/lib/report-chat";
import { hermitContext, msgId, saveThread, thread, type HermitNote, type Msg } from "@/lib/client/session";
import type { Turn } from "@/lib/chat/converse";
import type { ShellReport } from "@/lib/types";
import { usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

type Action = { type: "tab"; tab: string } | { type: "save" };
type Pos = { x: number; y: number };
const W = 380, H = 520, M = 12;
// The chat routes take plain role/text pairs of at most 2,000 characters.
const asHistory = (msgs: Msg[], n: number) => msgs.filter((m) => m.text).slice(-n).map(({ role, text }) => ({ role, text: text.slice(0, 2000) }));
const post = async <T,>(url: string, body: unknown): Promise<T> => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
};
const clamp = (p: Pos): Pos => ({
  x: Math.max(M, Math.min(p.x, window.innerWidth - Math.min(W, window.innerWidth - 2 * M) - M)),
  y: Math.max(M, Math.min(p.y, window.innerHeight - Math.min(H, window.innerHeight - 2 * M) - M)),
});
const waitFor = async <T,>(get: () => T | null | undefined, ms = 30_000): Promise<T | null> => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 300))) { const v = get(); if (v) return v; }
  return null;
};

// One Hermit for the whole report: answers, opens tabs, saves, furnishes the 3D tour and proposes fit-out changes.
// Closed it's a speech bubble in the corner; open it's a panel you can drag around by its header. It's the same
// conversation as Find a space: it shows and continues the studio thread, and sends it as history.
export function ReportChat({ report, spec, runId, tab, go, furnish, fit, setFit }: ReportCtx & { tab: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const place = report.name.split(" · ")[0];
  const [extra, setExtra] = usePersisted<string[]>(`hermit:extraq:${report.shellId}`, []);
  const [pos, setPos] = useState<Pos | null>(null); // null = docked bottom-right
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => { try { const p = JSON.parse(sessionStorage.getItem("hermit:chat-pos") ?? "null"); if (p) setPos(clamp(p)); } catch { /* storage blocked */ } }, []);
  useEffect(() => { setMsgs(thread()); setLoaded(true); }, []);
  useEffect(() => { if (loaded) saveThread(msgs); }, [msgs, loaded]);
  // Notes from the 3D tour's own buttons ("Furnish this room") join the conversation while this chat is mounted.
  useEffect(() => {
    const onNote = (e: Event) => {
      const n = (e as CustomEvent<HermitNote>).detail;
      n.handled = true;
      setMsgs((m) => [...m, { id: msgId(), role: n.role, text: n.text, ...(n.agent && { agent: n.agent }) }]);
    };
    window.addEventListener("hermit:note", onNote);
    return () => window.removeEventListener("hermit:note", onNote);
  }, []);
  useEffect(() => { if (loaded) endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, open, loaded, busy]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!pos) return;
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos]);

  const startDrag = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent) => { if (drag.current) setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy })); };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    try { sessionStorage.setItem("hermit:chat-pos", JSON.stringify(pos)); } catch { /* storage blocked */ }
  };
  const nudge = (e: React.KeyboardEvent) => {
    const d = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key];
    if (!d) return;
    e.preventDefault();
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    setPos(clamp({ x: box.left + d[0], y: box.top + d[1] }));
  };

  // Furniture: the 3D tour on the Inside tab does it; open that tab and wait for the tour to load.
  async function doFurnish(q: string): Promise<string> {
    if (!report.inside?.sid) return "This space has no 3D scan, so there's nothing to furnish.";
    if (tab !== "inside") go("inside");
    const api = await waitFor(() => (furnish.current?.ready || furnish.current?.failed ? furnish.current : null));
    if (api?.failed) return "The 3D furnishing tour couldn't start here, so only the basic tour is showing and I can't place furniture in it.";
    return api ? api.send(q) : "The 3D tour didn't load, so I couldn't place that. Try again in a moment.";
  }

  // Walls, rooms and fixtures: the same chat brain as Find a space, with this space's proposal as the starting point.
  async function doEdit(q: string): Promise<string> {
    const saved = load<{ conv?: string | null } & Record<string, unknown>>(KEYS.chat);
    let conv = saved?.conv;
    if (!conv) {
      conv = (await post<{ conversationId: string }>("/api/chat", { open: true, spec })).conversationId;
      if (saved) save(KEYS.chat, { ...saved, conv });
    }
    const r = await post<{ turn: Turn; design?: { kind: string; shellId: string; ops: FitoutOp[]; report: ShellReport; diff: FitoutDiff } }>("/api/chat", {
      conversationId: conv, text: q, layout: null, fitout: { shellId: report.shellId, ops: fit?.ops ?? [] },
    });
    const d = r.design;
    if (d?.kind === "fitout") { setFit({ ops: d.ops, report: d.report, diff: d.diff, kept: false }); if (tab !== "inside") go("inside"); }
    return r.turn.reply;
  }

  // What's on screen and what the user has done here, so the answer can refer to it.
  const screen = () => screenText({
    tab, tour: furnish.current?.describe(), told: hermitContext(),
    fit: fit && { kept: fit.kept, changes: fit.ops.length, nowMatched: fit.diff.nowMatched, stillMissing: fit.diff.stillMissing },
  });

  async function doAsk(next: Msg[]): Promise<Msg> {
    const q = next[next.length - 1].text;
    if (tab === "inside") {
      const out = await post<{ answer?: string; followUp?: string | null }>("/api/ask", { runId, shellId: report.shellId, question: q, room: null, screen: screen(), history: asHistory(next, 8) });
      return { id: msgId(), role: "hermit", text: out.answer ?? "Sorry, I couldn't answer that.", followUp: out.followUp };
    }
    const j = await post<{ reply?: string; action?: Action }>("/api/report-chat", { runId, shellId: report.shellId, tab, screen: screen(), messages: asHistory(next, 40) });
    let reply = j.reply ?? "I couldn't answer just now. Try again in a moment.";
    if (j.action?.type === "save") {
      if (isSaved(report.shellId)) reply = "This space is already saved.";
      else { toggleSaved(report, runId); window.dispatchEvent(new Event("hermit:saved")); }
    }
    if (j.action?.type === "tab" && (TABS as readonly string[]).includes(j.action.tab) && j.action.tab !== tab) go(j.action.tab);
    return { id: msgId(), role: "hermit", text: reply };
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    // The first message about this space says which space it is, so the shared thread reads right back in Find a space.
    const marker = `Looking at ${place}.`;
    const lastMarker = [...msgs].reverse().find((m) => m.agent === "report")?.text;
    const added: Msg[] = [...(lastMarker === marker ? [] : [{ id: msgId(), role: "hermit" as const, agent: "report", text: marker }]), { id: msgId(), role: "user", text: q }];
    const next = [...msgs, ...added];
    setMsgs((m) => [...m, ...added]); setText(""); setBusy(true);
    let reply: Msg;
    try {
      const kind = intent(q);
      reply = kind === "furnish" ? { id: msgId(), role: "hermit", text: await doFurnish(q) }
        : kind === "edit" ? { id: msgId(), role: "hermit", text: await doEdit(q) }
        : await doAsk(next);
    } catch { reply = { id: msgId(), role: "hermit", text: "I couldn't reach the server. Try again?" }; }
    setMsgs((m) => [...m, reply]); setBusy(false); // functional: a tour note may have landed while this was in flight
  }

  const style = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;
  if (!open) {
    return (
      <button type="button" className="rchat-bubble" onClick={() => setOpen(true)} aria-label="Chat with Hermit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hermit-logo.svg" alt="" /><MessageCircle aria-hidden="true" className="rchat-bubble-icon" />
      </button>
    );
  }
  return (
    <section className="rchat" role="dialog" aria-label="Chat with Hermit" style={style} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <header className="rchat-head" onPointerDown={startDrag} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        tabIndex={0} onKeyDown={nudge} aria-label="Hermit chat. Drag, or use the arrow keys, to move it." title="Drag to move">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hermit-logo.svg" alt="" width={32} height={30} />
        <strong>Hermit</strong>
        <button type="button" className="icon-btn" aria-label="Minimize chat" onClick={() => setOpen(false)}><Minus aria-hidden="true" /></button>
      </header>
      <div className="rchat-list" aria-live="polite">
        {!msgs.length && <p className="muted">Ask me anything about this space, or tell me what to change: “put a sofa by the window”, “merge the two offices”, “furnish the whole space”, “show me the lease coach”.</p>}
        {msgs.filter((m) => m.text).map((m) => (
          <div key={m.id} className="rchat-item" data-role={m.role}>
            <p className="rchat-msg" data-role={m.role}>{m.text}</p>
            {m.followUp && !extra.includes(m.followUp) && <button type="button" className="btn small" onClick={() => setExtra([...extra, m.followUp!])}><Plus aria-hidden="true" /> Add “{m.followUp}” to my broker questions</button>}
          </div>
        ))}
        {busy && <p className="rchat-msg" data-role="hermit">Thinking…</p>}
        <div ref={endRef} />
      </div>
      <form className="rchat-form" onSubmit={send}>
        <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label="Message Hermit" placeholder="Ask or tell Hermit…" maxLength={800} />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()} aria-label="Send"><Send aria-hidden="true" /></button>
      </form>
    </section>
  );
}
