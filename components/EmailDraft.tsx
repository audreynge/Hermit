"use client";
import { Copy, Mail } from "lucide-react";
import { useState } from "react";
import { draftEmail } from "@/lib/chat/present";
import { landlordQuestions } from "@/lib/packet";
import type { ShellReport } from "@/lib/types";
import { Modal } from "./Modal";
import { contactOf, mailtoHref } from "./report/Broker";
import { cleanQuestions } from "./report/Questions";

// The run's draft, with its questions cleaned the same way as the broker tab (none the scan already answered, no repeats).
export function draftBody(r: Pick<ShellReport, "draftMessage" | "unknowns" | "buildout" | "checks" | "fit">) {
  const [intro] = r.draftMessage.split("\n\nCould you help");
  const qs = cleanQuestions(r, landlordQuestions(r));
  const asks = qs.length ? `A few questions before I come see it:\n${qs.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\n` : "";
  return `${intro}\n\n${asks}Is it still available, and could we set up a time for me to see it?\n\nThanks!`;
}

export function EmailDraft({ report, onClose }: { report: ShellReport; onClose: () => void }) {
  const d = draftEmail(report);
  const who = contactOf(report).label;
  const [to, setTo] = useState(d.to);
  const [subject, setSubject] = useState(d.subject);
  const [body, setBody] = useState(() => draftBody(report));
  const [status, setStatus] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`To: ${to}\nSubject: ${subject}\n\n${body}`);
      setStatus("Copied. Paste it into your email.");
    } catch {
      setStatus("Copy didn't work here. Select the text and copy it instead.");
    }
  };
  return (
    <Modal title={`Email ${who}`} onClose={onClose}>
      <p className="muted" style={{ marginBottom: 14 }}>
        Drafted from this space&apos;s report. Edit anything. Hermit never sends anything. You send it yourself.
      </p>
      <label>To<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="The listing broker's email (it's on the listing)" /></label>
      <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label>Message<textarea value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="actions">
        <a className="btn primary" href={mailtoHref(to, subject, body)}><Mail aria-hidden="true" /> Open in email</a>
        <button type="button" className="btn" onClick={copy}><Copy aria-hidden="true" /> Copy message</button>
        <span role="status" className="muted">{status}</span>
      </div>
    </Modal>
  );
}
