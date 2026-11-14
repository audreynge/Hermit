"use client";
import { Bookmark, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { EmailDraft } from "./EmailDraft";
import { Modal } from "./Modal";
import { ReportPanel } from "./ReportPanel";
import { SpaceCard } from "./SpaceCard";

type Saved = Record<string, { report: ShellReport; spec: RequirementSpec; savedAt: string }>;

export function SavedList() {
  const [saved, setSaved] = useState<Saved>({});
  const [ready, setReady] = useState(false);
  const [emailFor, setEmailFor] = useState<ShellReport | null>(null);
  const [detailsFor, setDetailsFor] = useState<ShellReport | null>(null);
  useEffect(() => {
    fetch("/api/saved").then((r) => (r.ok ? r.json() : [])).then((rows: Saved[string][]) => setSaved(Object.fromEntries(rows.map((x) => [x.report.shellId, x])))).catch(() => {}).finally(() => setReady(true));
  }, []);
  const remove = (id: string) => {
    const next = { ...saved };
    delete next[id];
    setSaved(next);
    void fetch(`/api/saved?shellId=${encodeURIComponent(id)}`, { method: "DELETE" });
  };
  const list = Object.values(saved).sort((a, b) => b.savedAt.localeCompare(a.savedAt));

  if (ready && !list.length) return (
    <div className="card panel" style={{ textAlign: "center" }}>
      <Bookmark aria-hidden="true" style={{ width: 40, height: 40, color: "var(--coral)" }} />
      <p style={{ fontSize: 19, marginTop: 10 }}>No saved spaces yet.</p>
      <p className="muted" style={{ marginTop: 6 }}>Tap Save on any match and it will wait for you here, on this device.</p>
      <p style={{ marginTop: 18 }}><Link className="btn primary" href="/">Find spaces</Link></p>
    </div>
  );
  return (
    <section className="card results-card" aria-label="Saved spaces" style={{ minHeight: 0 }}>
      <div className="results-list">
        {list.map(({ report, spec }) => (
          <div key={report.shellId} style={{ display: "grid", gap: 6 }}>
            <SpaceCard report={report} spec={spec} selected={false} saved onSelect={() => setDetailsFor(report)} onEmail={() => setEmailFor(report)} onDetails={() => setDetailsFor(report)} onSave={() => remove(report.shellId)} />
            <button type="button" className="btn small" style={{ justifySelf: "end" }} onClick={() => remove(report.shellId)}><Trash2 aria-hidden="true" /> Remove</button>
          </div>
        ))}
      </div>
      {emailFor && <EmailDraft report={emailFor} onClose={() => setEmailFor(null)} />}
      {detailsFor && <Modal title={detailsFor.name.split(" · ")[0]} onClose={() => setDetailsFor(null)}><ReportPanel report={detailsFor} /></Modal>}
    </section>
  );
}
