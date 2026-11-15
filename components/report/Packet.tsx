"use client";
import { Copy, ExternalLink, Mail, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { saveThread } from "@/lib/client/persist";
import { emptyProfile, gradePacket, type Profile } from "@/lib/packet";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { CrabBadge } from "../studio/CrewTrace";
import { FloorPlan } from "./FloorPlan";
import { useFurnished, useMoney, usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;

// The packet itself, used in the tab preview and on the printable page. Reads the owner's profile and furnished
// layout from this browser.
export function PacketDoc({ report, spec, runId, profile }: { report: ShellReport; spec: RequirementSpec; runId: string; profile?: Profile }) {
  const [stored] = usePersisted<Profile>("hermit:profile", emptyProfile(spec));
  const p = profile ?? stored;
  const [items] = useFurnished(report.shellId);
  const [picked] = usePersisted<string[]>(`hermit:picked:${report.shellId}`, report.unknowns.slice(0, 6).map((u) => u.question));
  const [m] = useMoney(spec, report);
  const names = useMemo(() => new Map(report.fit.assignment.filter((a) => a.roomId).map((a) => [a.roomId!, a.req])), [report]);
  const rooms = spec.rooms.map((r) => `${r.count} × ${r.label}${r.minSqft ? ` (≥${r.minSqft} sf)` : ""}${r.fixtures?.length ? `, with ${r.fixtures.join(", ")}` : ""}`);
  const unverified = (report.buildout ?? []).filter((b) => b.status !== "seen");
  const questions = [...new Set([...picked, ...unverified.map((b) => b.question)])];
  return (
    <article className="packet-doc" aria-label="Broker packet">
      <header>
        <p className="eyebrow">Tenant packet · prepared with Hermit · {runId}</p>
        <h2>{p.business || "Your business"} for {report.name}</h2>
        <p className="muted">{report.address}</p>
      </header>
      <section><h3>The concept</h3><p>{p.concept || <em className="muted">Add a one-line concept.</em>}</p>
        <p><strong>Proposed use clause:</strong> “{p.useClause}”</p></section>
      <section><h3>What the space needs</h3><p>{spec.useType} in {spec.city === "houston" ? "Houston" : "Los Angeles"}{spec.sizeSqft ? `, ${spec.sizeSqft[0].toLocaleString()}–${spec.sizeSqft[1].toLocaleString()} sf` : ""}{spec.moveInBy ? `, opening ${spec.moveInBy}` : ""}.</p>
        <ul>{rooms.map((r) => <li key={r}>{r}</li>)}</ul></section>
      <section><h3>Money and track record</h3>
        <ul>
          <li>Cash available: {p.cash ? $(p.cash) : <em className="muted">not listed</em>}</li>
          <li>Operating reserve: {p.reserveMonths ? `${p.reserveMonths} months${m.rent ? ` (${$(p.reserveMonths * (m.rent + m.utilities + m.other))})` : ""}` : <em className="muted">not listed</em>}</li>
          <li>Financing: {p.financing || <em className="muted">not listed</em>}</li>
          <li>Experience: {[p.years && `${p.years} in the trade`, p.trackRecord].filter(Boolean).join(". ") || <em className="muted">not listed</em>}</li>
          <li>Personal guarantee: {p.guarantee === "yes" ? "willing to provide" : p.guarantee === "capped" ? "willing to provide a capped guarantee" : p.guarantee === "no" ? "prefers none" : <em className="muted">not stated</em>}</li>
        </ul></section>
      <section><h3>How we&apos;ll use the space</h3>
        {report.floorplan && items.length ? <FloorPlan graph={report.floorplan} names={names} items={items} height={320} label={`Furnished layout of ${report.name}`} /> : <p className="muted">No furnished layout yet.</p>}
        <p className="small muted">{items.length} pieces placed in the measured scan. Standard layout; no specialty build-out beyond the items below.</p></section>
      <section><h3>What&apos;s left to build</h3>
        {report.work.length ? <ul>{report.work.map((w, i) => <li key={i}>{w.item} ({w.weeksLow}–{w.weeksHigh} weeks)</li>)}</ul> : <p>Nothing found in the scan.</p>}
        {unverified.length > 0 && <p className="chips-line">{unverified.map((b) => <span key={b.item} className="chip-unv">{b.item}: unverified</span>)}</p>}</section>
      <section><h3>Questions for the landlord</h3><ol>{questions.map((q) => <li key={q}>{q}</li>)}</ol></section>
      <p className="small muted">Screening summary from public data and the 3D scan. Not an inspection or a legal review.</p>
    </article>
  );
}

const FIELD: Record<string, string> = { business: "p-business", concept: "p-concept", useClause: "p-use", cash: "p-cash", reserveMonths: "p-reserve", trackRecord: "p-track", financing: "p-fin", guarantee: "p-guar" };

export function Packet({ report, spec, runId, go }: ReportCtx) {
  const [p, setP] = usePersisted<Profile>("hermit:profile", emptyProfile(spec));
  const [items] = useFurnished(report.shellId);
  const [picked] = usePersisted<string[]>(`hermit:picked:${report.shellId}`, report.unknowns.slice(0, 6).map((u) => u.question));
  const [m] = useMoney(spec, report);
  const [status, setStatus] = useState("");
  const g = gradePacket(p, report, { monthlyRent: m.rent, furnished: items.length, questions: new Set([...picked, ...(report.buildout ?? []).filter((b) => b.status !== "seen").map((b) => b.question)]).size });
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const subject = `Tenant packet: ${p.business || spec.useType} for ${report.name}`;
  const href = `/packet/${runId}/${report.shellId}`;
  const body = `Hi,\n\nI'd like to tour ${report.name}${report.address ? ` (${report.address.split(",")[0]})` : ""} for ${p.business || `my ${spec.useType}`}. My one-page packet (concept, use clause, finances, layout and questions) is here: ${typeof window !== "undefined" ? window.location.origin : ""}${href}\n\nThanks!`;
  const fix = (f?: string) => { if (f === "furnish") go("furnish"); else if (f === "questions") go("questions"); else if (f && FIELD[f]) document.getElementById(FIELD[f])?.focus(); };

  return (
    <div className="packet-tab">
      <section className="card pad" aria-labelledby="prof-title">
        <h2 id="prof-title">Your side of the deal</h2>
        <p className="muted small">Brokers skip first-time owners who look unready. Fill this once; it&apos;s reused for every space and saved in this browser.</p>
        <div className="profile-grid">
          <label>Business name<input id="p-business" value={p.business} onChange={(e) => set("business", e.target.value)} placeholder="e.g. Rise Bakery" /></label>
          <label>Years in the trade<input id="p-years" value={p.years} onChange={(e) => set("years", e.target.value)} placeholder="e.g. 6 years" /></label>
          <label className="wide">Concept (one sentence)<input id="p-concept" value={p.concept} onChange={(e) => set("concept", e.target.value)} placeholder="What you sell, to whom, and why here" /></label>
          <label className="wide">Exact use wording<textarea id="p-use" rows={2} value={p.useClause} onChange={(e) => set("useClause", e.target.value)} /></label>
          <label>Cash available ($)<input id="p-cash" inputMode="numeric" value={p.cash || ""} onChange={(e) => set("cash", Number(e.target.value.replace(/\D/g, "")) || 0)} /></label>
          <label>Reserve (months of costs)<input id="p-reserve" inputMode="numeric" value={p.reserveMonths || ""} onChange={(e) => set("reserveMonths", Number(e.target.value.replace(/\D/g, "")) || 0)} /></label>
          <label>Financing<input id="p-fin" value={p.financing} onChange={(e) => set("financing", e.target.value)} placeholder="Savings, SBA loan, partner…" /></label>
          <label>Personal guarantee<select id="p-guar" value={p.guarantee} onChange={(e) => set("guarantee", e.target.value as Profile["guarantee"])}><option value="">Not sure</option><option value="capped">Yes, capped</option><option value="yes">Yes</option><option value="no">Prefer not</option></select></label>
          <label className="wide">Track record<input id="p-track" value={p.trackRecord} onChange={(e) => set("trackRecord", e.target.value)} placeholder="e.g. Head baker at Common Bond for 4 years; 2 years of farmers-market sales" /></label>
        </div>
      </section>

      <div className="packet-row">
        <PacketDoc report={report} spec={spec} runId={runId} profile={p} />
        <aside className="card pad grade" aria-labelledby="grade-title" data-grade={g.grade}>
          <h2 id="grade-title"><CrabBadge agent="skeptic" size={32} /> The landlord&apos;s read</h2>
          <p className="grade-letter" aria-label={`Grade ${g.grade}`}>{g.grade}</p>
          <p className="small muted">The Skeptic reads your packet the way a landlord screens a new tenant.</p>
          {g.flags.length ? (
            <ul className="grade-flags">
              {g.flags.map((f) => <li key={f.text}><ShieldAlert aria-hidden="true" className="inline-icon" /> <strong>{f.text}</strong> {f.fix} {f.field && <button type="button" className="link-btn" onClick={() => fix(f.field)}>Fix it</button>}</li>)}
            </ul>
          ) : <p><ShieldCheck aria-hidden="true" className="inline-icon" /> Nothing a landlord would flag. This reads like a tenant ready to sign.</p>}
          <div className="actions col">
            <a className="btn primary" href={`mailto:${report.listing?.contact?.email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
              onClick={() => { saveThread({ id: `${runId}:${report.shellId}:packet`, shellId: report.shellId, runId, name: `Packet: ${report.name}`, to: report.listing?.contact?.email ?? "", subject, body, status: "sent-by-you", updatedAt: new Date().toISOString() }); setStatus("Saved to Messages. Your email app has the draft; you press send."); }}>
              <Mail aria-hidden="true" /> {g.grade === "A" ? "Send to the broker" : "Send anyway"}</a>
            <Link className="btn" href={href} target="_blank"><ExternalLink aria-hidden="true" /> Printable packet</Link>
            <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(body); setStatus("Copied."); } catch { setStatus("Select the text to copy it."); } }}><Copy aria-hidden="true" /> Copy message</button>
            <span role="status" className="muted small">{status}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
