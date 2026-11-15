"use client";
import { Copy, FileSearch } from "lucide-react";
import { useState } from "react";
import { usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

type Coach = { summary: string[]; terms: Record<string, string | null>; redFlags: { flag: string; why: string; ask: string }[] };
type Loi = { years: number; rentPsf: number; freeMonths: number; tiPsf: number; startMonths: number; guaranteeCap: boolean };

export function Lease({ report, spec }: ReportCtx) {
  const [text, setText] = useState("");
  const [coach, setCoach] = useState<Coach | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = usePersisted<Loi>(`hermit:loi:${report.shellId}`, { years: 5, rentPsf: report.listing?.askingRate ?? 0, freeMonths: 2, tiPsf: 0, startMonths: 2, guaranteeCap: true });
  const [copied, setCopied] = useState("");
  const sqft = Math.round(report.sqft ?? report.floorplan?.totalAreaSqft ?? 0);

  const read = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/lease", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const out = await r.json();
      if (!r.ok) setErr(out.error ?? "Couldn't read that."); else setCoach(out);
    } catch { setErr("Couldn't reach the server."); } finally { setBusy(false); }
  };

  const letter = `Letter of intent (non-binding)\n\nProperty: ${report.name}${report.address ? `, ${report.address}` : ""}\nPremises: about ${sqft.toLocaleString()} sf\nUse: ${spec.useType}\nTerm: ${loi.years} years, starting about ${loi.startMonths} months after signing\nBase rent: ${loi.rentPsf ? `$${loi.rentPsf.toFixed(2)} per sf per year` : "[to be agreed]"}, with fixed 3% yearly increases\nFree rent: ${loi.freeMonths} month${loi.freeMonths === 1 ? "" : "s"}\nTenant improvement allowance: ${loi.tiPsf ? `$${loi.tiPsf} per sf` : "none requested"}\nPersonal guarantee: ${loi.guaranteeCap ? "capped at 12 months of base rent, released after 24 months of on-time payments" : "[to be discussed]"}\nCAM / operating expenses: tenant requests last year's actuals and a 5% yearly cap on controllable expenses\nContingencies: city approval for ${spec.useType} use and permits for the build-out\n\nThis letter is non-binding and for discussion only.`;

  return (
    <div className="lease">
      <section className="card pad" aria-labelledby="coach-title">
        <h2 id="coach-title"><FileSearch aria-hidden="true" className="inline-icon" /> Lease coach</h2>
        <p className="muted small">Paste the lease (or the parts you&apos;re unsure about). Hermit explains it in plain words and flags what to push back on. Not legal advice; have a lawyer review before you sign.</p>
        <label className="sr-only" htmlFor="lease-text">Lease text</label>
        <textarea id="lease-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste lease text here…" />
        <button type="button" className="btn primary" onClick={read} disabled={busy || text.trim().length < 40}>{busy ? "Reading…" : "Explain this lease"}</button>
        {err && <p role="alert" className="small">{err}</p>}
        {coach && (
          <div className="coach">
            <h3>In plain words</h3>
            <ul>{coach.summary.map((s) => <li key={s}>{s}</li>)}</ul>
            {Object.values(coach.terms).some(Boolean) && <dl className="terms">{Object.entries(coach.terms).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt><dd>{v}</dd></div>)}</dl>}
            <h3>Red flags and what to ask for</h3>
            {coach.redFlags.length ? <ul className="flags">{coach.redFlags.map((f) => <li key={f.flag}><strong>{f.flag}.</strong> {f.why} <em>Ask:</em> {f.ask}</li>)}</ul> : <p>No common red flags spotted in what you pasted.</p>}
          </div>
        )}
      </section>

      <section className="card pad" aria-labelledby="loi-title">
        <h2 id="loi-title">Build your offer (LOI)</h2>
        <p className="muted small">Change the terms and the letter updates. CoStar lease comps (what similar spaces nearby got for free rent) show here once the CoStar kit is loaded.</p>
        <div className="loi-grid">
          <label>Term <select value={loi.years} onChange={(e) => setLoi({ ...loi, years: Number(e.target.value) })}>{[3, 5, 7, 10].map((y) => <option key={y} value={y}>{y} years</option>)}</select></label>
          <label>Rent ($/sf/yr) <input inputMode="decimal" value={loi.rentPsf || ""} onChange={(e) => setLoi({ ...loi, rentPsf: Number(e.target.value) || 0 })} /></label>
          <label>Free rent <select value={loi.freeMonths} onChange={(e) => setLoi({ ...loi, freeMonths: Number(e.target.value) })}>{[0, 1, 2, 3, 4, 6].map((m) => <option key={m} value={m}>{m} months</option>)}</select></label>
          <label>Build-out allowance ($/sf) <input inputMode="decimal" value={loi.tiPsf || ""} onChange={(e) => setLoi({ ...loi, tiPsf: Number(e.target.value) || 0 })} /></label>
          <label>Start after signing <select value={loi.startMonths} onChange={(e) => setLoi({ ...loi, startMonths: Number(e.target.value) })}>{[0, 1, 2, 3, 4].map((m) => <option key={m} value={m}>{m} months</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={loi.guaranteeCap} onChange={(e) => setLoi({ ...loi, guaranteeCap: e.target.checked })} /> Cap the personal guarantee</label>
        </div>
        <pre className="draft">{letter}</pre>
        <button type="button" className="btn" onClick={async () => { try { await navigator.clipboard.writeText(letter); setCopied("Copied."); } catch { setCopied("Select the text to copy it."); } }}><Copy aria-hidden="true" /> Copy letter</button>
        <span role="status" className="muted small"> {copied}</span>
      </section>
    </div>
  );
}
