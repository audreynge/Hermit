"use client";
import Link from "next/link";
import { useState } from "react";
import type { RuleStatus, ShellReport } from "@/lib/types";

const ICON: Record<RuleStatus, string> = { pass: "✓", fail: "✕", warn: "!", unknown: "?" };
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000).toLocaleString()}k` : `$${n}`);

export function ReportPanel({ report, runId, printable = false }: { report: ShellReport; runId?: string | null; printable?: boolean }) {
  const [copied, setCopied] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report.draftMessage);
      setCopied("Inquiry copied. Hermit never sends it for you.");
    } catch {
      setCopied("Copy failed; select the text above instead.");
    }
  };

  return (
    <article className="card stack" aria-labelledby={`r-${report.shellId}`}>
      <header>
        <p className="muted" style={{ margin: 0 }}>#{report.rank} · <span className={`badge ${report.badge === "scan-verified" ? "verified" : "record"}`}>{report.badge}</span></p>
        <h2 id={`r-${report.shellId}`} style={{ marginTop: 8 }}>{report.name.split(" · ")[0]}</h2>
        <p className="muted">{report.address}</p>
        <p><strong>{report.verdict}.</strong> {report.summary}</p>
      </header>

      <section aria-label="Scores" className="row">
        <div><div className="score num">{report.badge === "record-only" ? "—" : report.fit.score}</div><div className="muted">{report.badge === "record-only" ? "room fit not measured" : "room fit"}</div></div>
        <div><div className="score num">{report.weeksToOpen[0]}–{report.weeksToOpen[1]}</div><div className="muted">weeks to open</div></div>
        {report.costRange && report.costRange[1] > 0 && <div><div className="score num">{money(report.costRange[0])}–{money(report.costRange[1])}</div><div className="muted">known work</div></div>}
        {report.listing?.askingRate ? <div><div className="score num">${report.listing.askingRate}</div><div className="muted">asking $/sf/yr</div></div> : null}
        {report.listing?.price ? <div><div className="score num">${report.listing.price.toLocaleString()}</div><div className="muted">listed</div></div> : null}
      </section>

      {report.fit.assignment.length > 0 && (
        <section>
          <h3>Rooms</h3>
          <ul>
            {report.fit.assignment.map((a) => (
              <li key={a.req}>{a.req}: {a.roomId ? <span className="status-pass">matched to measured room</span> : <span className="status-warn">not in scan</span>}</li>
            ))}
          </ul>
          {report.fit.edits.length > 0 && <p className="muted">Changes: {report.fit.edits.join("; ")}.</p>}
        </section>
      )}

      <section>
        <h3>Screening checks</h3>
        <table>
          <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Evidence</th></tr></thead>
          <tbody>
            {report.rules.map((r) => (
              <tr key={r.rule}>
                <th scope="row" style={{ fontWeight: 400 }}>{r.rule.replace(/_/g, " ")}</th>
                <td className={`status-${r.status}`}><span aria-hidden="true">{ICON[r.status]} </span><strong>{r.status}</strong><br /><span style={{ color: "var(--ink)" }}>{r.detail}</span></td>
                <td>{r.evidence.map((e) => <div key={e.ref} className="muted">{e.source}: {e.ref}</div>)}<a href={r.citation} target="_blank" rel="noreferrer">source</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {report.work.length > 0 && (
        <section>
          <h3>Work still to do</h3>
          <table>
            <thead><tr><th scope="col">Item</th><th scope="col">Cost</th><th scope="col">Weeks</th></tr></thead>
            <tbody>
              {report.work.map((w, i) => (
                <tr key={i}><td>{w.item}<div className="muted">{w.reason === "code" ? "code/record gap" : "layout gap"}</div></td><td className="num">{money(w.low)}–{money(w.high)}</td><td className="num">{w.weeksLow}–{w.weeksHigh}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: "var(--t-sm)" }}>Screening ranges, not bids. Weeks include permit review.{report.tiAllowance ? ` Your TI allowance input (${money(report.tiAllowance)}) is not netted out; it depends on lease terms.` : ""}</p>
        </section>
      )}

      {report.unknowns.length > 0 && (
        <section>
          <h3>Ask before you commit</h3>
          <ul>{report.unknowns.map((u, i) => <li key={i}><strong>{u.topic}:</strong> {u.question}</li>)}</ul>
        </section>
      )}

      <section>
        <h3>Inquiry draft</h3>
        <pre className="draft">{report.draftMessage}</pre>
        <div className="row no-print" style={{ marginTop: 8 }}>
          <button type="button" className="btn small" onClick={copy}>Copy inquiry</button>
          {report.listing?.url && <a className="btn ghost small" href={report.listing.url} target="_blank" rel="noreferrer">Open listing</a>}
          {!printable && runId && <Link className="btn ghost small" href={`/shell/${report.shellId}?run=${runId}`}>Printable report</Link>}
          <span role="status" className="muted">{copied}</span>
        </div>
      </section>

      <details>
        <summary>Sources ({report.sources.length})</summary>
        <ul>{report.sources.map((s) => <li key={s.ref}>{s.source}: {s.ref} <span className="muted">(confidence {s.confidence})</span></li>)}</ul>
      </details>
    </article>
  );
}
