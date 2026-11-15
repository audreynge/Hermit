"use client";
import { Copy, ExternalLink, Mail, Plus, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { saveThread } from "@/lib/client/persist";
import { usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

// Anything no specialist could verify becomes a question for the broker; Hermit offers the next one unprompted.
export function Questions({ report, runId, spec }: ReportCtx) {
  const [extra, setExtra] = usePersisted<string[]>(`hermit:extraq:${report.shellId}`, []);
  const all = useMemo(() => [...new Set([...report.unknowns.map((u) => u.question), ...extra])], [report, extra]);
  const [picked, setPicked] = usePersisted<string[]>(`hermit:picked:${report.shellId}`, all.slice(0, 5));
  const [mine, setMine] = useState("");
  const [status, setStatus] = useState("");
  const hidden = report.unknowns.find((u) => u.topic === "behind the walls" && !picked.includes(u.question));
  const contact = report.listing?.contact;
  const body = useMemo(() => {
    const first = report.draftMessage.split("\n\nCould you help")[0];
    return `${first}\n\nCould you help with a few questions?\n${picked.map((q) => `- ${q}`).join("\n") || "- Is the space available, and what are the terms?"}\n\nThanks!`;
  }, [report, picked]);
  const [draft, setDraft] = useState(body);
  useEffect(() => setDraft(body), [body]);
  const subject = `Question about ${report.name}${report.address ? ` (${report.address.split(",")[0]})` : ""}`;

  return (
    <div className="questions-tab">
      {hidden && (
        <div className="follow card pad" role="status">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hermit-logo.svg" alt="" width={44} />
          <p>I couldn&apos;t confirm this from the scan: <strong>{hidden.question.replace(/: what's in place today\?$/, "")}</strong>. Add it to your broker questions?</p>
          <button type="button" className="btn small primary" onClick={() => setPicked([...picked, hidden.question])}><Plus aria-hidden="true" /> Add it</button>
        </div>
      )}
      <section className="card pad" aria-labelledby="q-title">
        <h2 id="q-title">Questions no specialist could answer ({all.length})</h2>
        <p className="muted small">Pick the ones to send. Scans show what&apos;s built, never what&apos;s behind the walls, so those always need a human answer.</p>
        <ul className="pick-list">
          {all.map((q) => (
            <li key={q}><label><input type="checkbox" checked={picked.includes(q)} onChange={(e) => setPicked(e.target.checked ? [...picked, q] : picked.filter((x) => x !== q))} /> {q}</label></li>
          ))}
        </ul>
        <form className="add-q" onSubmit={(e) => { e.preventDefault(); if (mine.trim()) { setExtra([...extra, mine.trim()]); setPicked([...picked, mine.trim()]); setMine(""); } }}>
          <label htmlFor="mine-q" className="sr-only">Add your own question</label>
          <input id="mine-q" value={mine} onChange={(e) => setMine(e.target.value)} placeholder="Add your own question…" />
          <button type="submit" className="btn small"><Plus aria-hidden="true" /> Add</button>
        </form>
      </section>

      <section className="card pad" aria-labelledby="draft-title">
        <h2 id="draft-title">Draft message to {contact?.name ? contact.name : "the broker"}</h2>
        <label htmlFor="q-draft" className="sr-only">Draft message</label>
        <textarea id="q-draft" rows={12} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => { saveThread({ id: `${runId}:${report.shellId}`, shellId: report.shellId, runId, name: report.name, to: contact?.email ?? "", subject, body: draft, status: "draft", updatedAt: new Date().toISOString() }); setStatus("Saved to Messages."); }}><Save aria-hidden="true" /> Save to Messages</button>
          <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(draft); setStatus("Copied. Paste it into your email."); } catch { setStatus("Select the text to copy it."); } }}><Copy aria-hidden="true" /> Copy</button>
          <a className="btn" href={`mailto:${contact?.email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(draft)}`}><Mail aria-hidden="true" /> Open in my email app</a>
          <Link className="btn" href={`/packet/${runId}/${report.shellId}`} target="_blank"><ExternalLink aria-hidden="true" /> Broker packet</Link>
          <span role="status" className="muted small">{status}</span>
        </div>
        <p className="muted small">Hermit never sends anything for you. A {spec.useType} lead with a full brief and questions is what brokers want.</p>
      </section>
    </div>
  );
}
