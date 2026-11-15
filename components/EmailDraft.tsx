"use client";
import { Copy, Mail } from "lucide-react";
import { useState } from "react";
import { draftEmail } from "@/lib/chat/present";
import type { ShellReport } from "@/lib/types";
import { openGmail } from "@/lib/text";
import { Modal } from "./Modal";

export function EmailDraft({ report, onClose }: { report: ShellReport; onClose: () => void }) {
  const d = draftEmail(report);
  const who = report.listing?.kind === "sale" ? "listing agent" : "property manager";
  const [to, setTo] = useState(d.to);
  const [subject, setSubject] = useState(d.subject);
  const [body, setBody] = useState(d.body);
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
    <Modal title={`Email the ${who}`} onClose={onClose}>
      <p className="muted" style={{ marginBottom: 14 }}>
        Drafted from this space&apos;s report{report.listing?.contact?.name ? ` for ${report.listing.contact.name}${report.listing.contact.company ? ` at ${report.listing.contact.company.replace(/\.$/, "")}` : ""}` : ""}. Edit anything; Hermit never sends it for you.
      </p>
      <label>To<input value={to} onChange={(e) => setTo(e.target.value)} placeholder={`${who[0].toUpperCase()}${who.slice(1)}'s email`} /></label>
      <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label>Message<textarea value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="actions">
        <button type="button" className="btn primary" onClick={() => openGmail(to, subject, body)}><Mail aria-hidden="true" /> Open in Gmail</button>
        <button type="button" className="btn" onClick={copy}><Copy aria-hidden="true" /> Copy email</button>
        <span role="status" className="muted">{status}</span>
      </div>
    </Modal>
  );
}
