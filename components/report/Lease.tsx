"use client";
import { Copy, FileSearch, FileText, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

type Coach = { keyPoints?: string[]; summary: string[]; terms: Record<string, string | null>; redFlags: { flag: string; why: string; ask: string }[]; text?: string; llm?: boolean };
type Loi = { years: number; rentPsf: number; freeMonths: number; tiPsf: number; startMonths: number; guaranteeCap: boolean };
type Turn = { role: "user" | "assistant"; text: string };
const MAX_PDF = 15 * 1024 * 1024;

const toBase64 = (f: File) => new Promise<string>((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] ?? "");
  r.onerror = () => no(r.error);
  r.readAsDataURL(f);
});

export function Lease({ report, spec }: ReportCtx) {
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<{ name: string; data: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [coach, setCoach] = useState<Coach | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loi, setLoi] = usePersisted<Loi>(`hermit:loi:${report.shellId}`, { years: 5, rentPsf: report.listing?.askingRate ?? 0, freeMonths: 2, tiPsf: 0, startMonths: 2, guaranteeCap: true });
  const [copied, setCopied] = useState("");
  const sqft = Math.round(report.sqft ?? report.floorplan?.totalAreaSqft ?? 0);

  const pick = async (f?: File) => {
    if (!f) return;
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) return setErr("That isn't a PDF. Upload a PDF or paste the text.");
    if (f.size > MAX_PDF) return setErr("That PDF is over 15 MB. Paste the parts you're unsure about instead.");
    try { setPdf({ name: f.name, data: await toBase64(f) }); setErr(""); } catch { setErr("Couldn't open that file."); }
  };

  const source = () => (pdf && (!coach || coach.llm || !coach.text) ? { pdf: pdf.data, filename: pdf.name } : { text: coach?.text || text });

  const post = async (body: object) => {
    const r = await fetch("/api/lease", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error ?? "Couldn't read that.");
    return out;
  };

  const read = async () => {
    setBusy(true); setErr(""); setChat([]);
    try { setCoach(await post(pdf ? { pdf: pdf.data, filename: pdf.name } : { text })); }
    catch (e) { setErr(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't reach the server."); }
    finally { setBusy(false); }
  };

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = q.trim();
    if (question.length < 2 || asking) return;
    setAsking(true); setQ(""); setErr("");
    const history = chat;
    setChat([...history, { role: "user", text: question }]);
    try {
      const { answer } = await post({ ...source(), question, history });
      setChat((c) => [...c, { role: "assistant", text: answer }]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't reach the server."); } finally { setAsking(false); }
  };

  const letter = `Letter of intent (non-binding)\n\nProperty: ${report.name}${report.address ? `, ${report.address}` : ""}\nPremises: about ${sqft.toLocaleString()} sf\nUse: ${spec.useType}\nTerm: ${loi.years} years, starting about ${loi.startMonths} months after signing\nBase rent: ${loi.rentPsf ? `$${loi.rentPsf.toFixed(2)} per sf per year` : "[to be agreed]"}, with fixed 3% yearly increases\nFree rent: ${loi.freeMonths} month${loi.freeMonths === 1 ? "" : "s"}\nTenant improvement allowance: ${loi.tiPsf ? `$${loi.tiPsf} per sf` : "none requested"}\nPersonal guarantee: ${loi.guaranteeCap ? "capped at 12 months of base rent, released after 24 months of on-time payments" : "[to be discussed]"}\nCAM / operating expenses: tenant requests last year's actuals and a 5% yearly cap on controllable expenses\nContingencies: city approval for ${spec.useType} use and permits for the build-out\n\nThis letter is non-binding and for discussion only.`;

  return (
    <div className="lease">
      <section className="card pad" aria-labelledby="coach-title">
        <h2 id="coach-title"><FileSearch aria-hidden="true" className="inline-icon" /> Lease coach</h2>
        <p className="muted">Upload the lease or paste it. Hermit lists what matters, flags what to push back on, and answers your questions.</p>
        <div className={`lease-drop${drag ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files[0]); }}>
          {pdf ? <p><FileText aria-hidden="true" className="inline-icon" /> <strong>{pdf.name}</strong> <button type="button" className="btn" onClick={() => { setPdf(null); if (fileRef.current) fileRef.current.value = ""; }}>Remove</button></p> : <p>Drop a lease PDF here</p>}
          <input ref={fileRef} id="lease-pdf" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Upload aria-hidden="true" /> {pdf ? "Choose a different PDF" : "Upload a PDF"}</button>
          <span className="muted small">PDF, up to 15 MB</span>
        </div>
        {!pdf && <>
          <label className="muted" htmlFor="lease-text">Or paste the lease text</label>
          <textarea id="lease-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste lease text here…" />
        </>}
        <button type="button" className="btn primary" onClick={read} disabled={busy || (!pdf && text.trim().length < 40)}>{busy ? "Reading…" : "Explain this lease"}</button>
        {err && <p role="alert">{err}</p>}
        {coach && (
          <div className="coach">
            {!!coach.keyPoints?.length && <>
              <h3>What matters most</h3>
              <ul className="key-points">{coach.keyPoints.map((s) => <li key={s}>{s}</li>)}</ul>
            </>}
            <h3>Red flags and what to ask for</h3>
            {coach.redFlags.length ? <ul className="flags">{coach.redFlags.map((f) => <li key={f.flag}><strong>{f.flag}.</strong> {f.why} <em>Ask:</em> {f.ask}</li>)}</ul> : <p>No common red flags spotted.</p>}
            {Object.values(coach.terms).some(Boolean) && <>
              <h3>The terms</h3>
              <dl className="terms">{Object.entries(coach.terms).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt><dd>{v}</dd></div>)}</dl>
            </>}
            {!coach.keyPoints?.length && <ul>{coach.summary.map((s) => <li key={s}>{s}</li>)}</ul>}

            <h3>Ask about this lease</h3>
            <div className="lease-chat" role="log" aria-live="polite">
              {chat.map((t, i) => <p key={i} className={`lease-msg ${t.role}`}>{t.text}</p>)}
              {asking && <p className="lease-msg assistant muted">Looking…</p>}
            </div>
            <form className="lease-ask" onSubmit={ask}>
              <label className="sr-only" htmlFor="lease-q">Your question</label>
              <input id="lease-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Can I sublet?" maxLength={500} />
              <button type="submit" className="btn primary" disabled={asking || q.trim().length < 2}>Ask</button>
            </form>
            <p className="muted small">Hermit explains; it isn&apos;t legal advice. Have a lawyer review before you sign.</p>
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
