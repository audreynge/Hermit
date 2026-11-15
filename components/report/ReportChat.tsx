"use client";
import { useEffect, useRef, useState } from "react";
import { isSaved, toggleSaved } from "@/lib/client/persist";
import type { RequirementSpec, ShellReport } from "@/lib/types";

type Msg = { role: "user" | "hermit"; text: string };
type Action = { type: "tab"; tab: string } | { type: "save" };
const TABS = ["overview", "inside", "furnish", "neighborhood", "lease", "broker"];

export function ReportChat({ report, runId, tab }: { report: ShellReport; spec: RequirementSpec; runId: string; tab: string }) {
  const key = `hermit:reportchat:${report.shellId}`;
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { setMsgs(JSON.parse(sessionStorage.getItem(key) ?? "[]")); } catch { /* storage blocked */ }
  }, [key]);
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(msgs.slice(-40))); } catch { /* storage blocked */ }
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, key, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: q }];
    setMsgs(next); setText(""); setBusy(true);
    let reply = "I couldn't answer just now. Try again in a moment.";
    let action: Action | undefined;
    try {
      const res = await fetch("/api/report-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, shellId: report.shellId, tab, messages: next }) });
      const j = await res.json();
      if (j.reply) reply = j.reply;
      action = j.action;
    } catch { /* keep the generic reply */ }
    if (action?.type === "save") {
      if (isSaved(report.shellId)) reply = "This space is already saved.";
      else toggleSaved(report, runId);
    }
    const done = [...next, { role: "hermit" as const, text: reply }];
    setMsgs(done); setBusy(false);
    if (action?.type === "tab" && TABS.includes(action.tab) && action.tab !== tab) {
      try { sessionStorage.setItem(key, JSON.stringify(done.slice(-40))); } catch { /* storage blocked */ }
      window.location.assign(`?run=${runId}&tab=${action.tab}`);
    }
  }

  if (!open) return <button type="button" className="rchat-pill" onClick={() => setOpen(true)}>Ask Hermit about this space</button>;
  return (
    <section className="rchat" role="dialog" aria-label="Ask Hermit about this space" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <header className="rchat-head">
        <img src="/hermit-logo.svg" alt="" width={32} height={30} />
        <strong>Hermit</strong>
        <button type="button" className="icon-btn" aria-label="Minimize chat" onClick={() => setOpen(false)}>–</button>
      </header>
      <div className="rchat-list" aria-live="polite">
        {!msgs.length && <p className="muted">Ask me about the price, the total cost, how long it takes, or say &quot;show me the lease coach&quot;.</p>}
        {msgs.map((m, i) => <p key={i} className="rchat-msg" data-role={m.role}>{m.text}</p>)}
        {busy && <p className="rchat-msg" data-role="hermit">Thinking…</p>}
        <div ref={endRef} />
      </div>
      <form className="rchat-form" onSubmit={send}>
        <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label="Your question" placeholder="Type a question" maxLength={800} />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </section>
  );
}
