"use client";
import { Copy, Heart, Mail, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getJSON, removeThread, saveThread, savedShells, setJSON, threads, type SavedShell, type Thread } from "@/lib/client/persist";

const SAMPLE: Thread = {
  id: "sample", shellId: "", runId: "", name: "Sample: Suite 460, Houston", to: "broker@example.com", subject: "Question about Suite 460",
  body: "Hi,\n\nI'm looking for space for an office in Houston (2,500–5,000 sf) and Suite 460 looks promising: 6 of the 8 rooms I need already look built.\n\nCould you help with a few questions?\n- Is there a restroom in the suite or shared on the floor?\n- What cooling capacity serves the suite?\n- How many parking stalls come with it?\n\nThanks!",
  status: "sent-by-you", updatedAt: "2026-11-14T20:00:00.000Z", sample: true,
  reply: "Sample reply (illustration, not a real broker): Thanks for reaching out! The restroom is shared on the 4th floor, the suite has its own 5-ton unit, and it comes with 12 stalls. Want to tour Thursday?",
};

export function SavedList() {
  const [items, setItems] = useState<SavedShell[]>([]);
  useEffect(() => setItems(savedShells()), []);
  if (!items.length) return (
    <div className="card pad empty">
      <p><strong>No saved spaces yet.</strong> Tap the heart on any Shell Report to keep it here.</p>
      <div className="hero-chips"><Link className="chip" href="/studio?q=A nail salon near transit in Houston">Try: nail salon near transit in Houston</Link><Link className="chip" href="/studio?replay=demo">Watch a recorded run</Link></div>
    </div>
  );
  return (
    <ul className="saved-grid">
      {items.map((s) => (
        <li key={s.shellId} className="card pad saved-card">
          <h2><Link href={`/shell/${s.shellId}?run=${s.runId}`}>{s.name}</Link></h2>
          <p className="muted">{s.address}</p>
          <p>{s.verdict} · {s.matchScore}% match</p>
          <button type="button" className="btn small" onClick={() => { const next = items.filter((x) => x.shellId !== s.shellId); setJSON("hermit:saved2", next); setItems(next); }}><Heart aria-hidden="true" fill="currentColor" /> Remove</button>
        </li>
      ))}
    </ul>
  );
}

export function MessagesInbox() {
  const [list, setList] = useState<Thread[]>([]);
  const [open, setOpen] = useState<string>("sample");
  const [status, setStatus] = useState("");
  useEffect(() => { const t = threads(); setList(t); if (t[0]) setOpen(t[0].id); if (!getJSON("hermit:inbox-seen", false)) setJSON("hermit:inbox-seen", true); }, []);
  const all = [...list, SAMPLE];
  const t = all.find((x) => x.id === open) ?? all[0];
  const update = (patch: Partial<Thread>) => { if (t.sample) return; const next = { ...t, ...patch, updatedAt: new Date().toISOString() }; saveThread(next); setList(threads()); };
  return (
    <div className="inbox">
      <aside className="card inbox-list" aria-label="Conversations">
        <ul>
          {all.map((x) => (
            <li key={x.id}><button type="button" aria-pressed={x.id === t.id} onClick={() => setOpen(x.id)}>
              <strong>{x.name}</strong><span className="muted small">{x.sample ? "Sample thread" : x.status === "draft" ? "Draft" : "You sent this"} · {new Date(x.updatedAt).toLocaleDateString()}</span>
            </button></li>
          ))}
        </ul>
        {!list.length && <p className="muted small pad">Messages you send from a space&apos;s &quot;Talk to your broker&quot; tab show up here.</p>}
      </aside>
      <section className="card pad inbox-thread" aria-labelledby="thread-title">
        <h2 id="thread-title">{t.name}</h2>
        {t.sample && <p className="sample-badge">Sample thread, for illustration. Hermit never contacts anyone; you send messages yourself.</p>}
        <label className="small" htmlFor="th-to">To</label>
        <input id="th-to" value={t.to} readOnly={t.sample} onChange={(e) => update({ to: e.target.value })} placeholder="Broker's email (from the listing, when available)" />
        <label className="small" htmlFor="th-body">Message</label>
        <textarea id="th-body" rows={12} value={t.body} readOnly={t.sample} onChange={(e) => update({ body: e.target.value })} />
        {t.reply && <div className="reply"><p>{t.reply}</p></div>}
        {!t.sample && (
          <div className="actions">
            <a className="btn primary" href={`mailto:${t.to}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.body)}`} onClick={() => update({ status: "sent-by-you" })}><Mail aria-hidden="true" /> Open in my email app</a>
            <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(t.body); setStatus("Copied."); } catch { setStatus("Select the text to copy it."); } }}><Copy aria-hidden="true" /> Copy</button>
            <button type="button" className="btn danger" onClick={() => { removeThread(t.id); const n = threads(); setList(n); setOpen(n[0]?.id ?? "sample"); }}><Trash2 aria-hidden="true" /> Delete</button>
            {t.runId && <Link className="btn" href={`/shell/${t.shellId}?run=${t.runId}&tab=broker`}>Edit questions</Link>}
            <span role="status" className="muted small">{status}</span>
          </div>
        )}
      </section>
    </div>
  );
}
