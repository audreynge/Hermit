import Link from "next/link";
import type { RuleStatus, ShellReport } from "@/lib/types";
import { RegulationList } from "./Regulations";

const ICON: Record<RuleStatus, string> = { pass: "✓", fail: "✕", warn: "!", unknown: "?" };
const money = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000).toLocaleString()}k` : `$${n}`);

export function ReportPanel({ report, runId, printable = false, onParcel }: { report: ShellReport; runId?: string | null; printable?: boolean; onParcel?: () => void }) {
  return (
    <div className="report">
      <p className="muted">#{report.rank} · {report.address} · <span className={`badge-src ${report.badge === "scan-verified" ? "verified" : "record"}`}>{report.badge === "scan-verified" ? "measured from 3D scan" : "record only"}</span></p>
      <p style={{ marginTop: 10, fontSize: 17 }}><strong>{report.verdict}.</strong> {report.summary}</p>
      {report.verification && (
        <p className={report.verification.status === "verified" ? "status-pass" : report.verification.status === "demoted" ? "status-fail" : "status-warn"} style={{ fontSize: 14 }}>
          <strong>{report.verification.status === "verified" ? "✓ Checked against your must-haves and sources" : report.verification.status === "demoted" ? "✕ Demoted by verifier" : "! Flagged by verifier"}</strong>
          {" "}<span className="muted">({report.verification.by.join(" + ")}){report.verification.issues.length ? `: ${report.verification.issues.join("; ")}` : ""}</span>
        </p>
      )}

      <div className="stats">
        <div><div className="big num">{report.matchScore}%</div><div className="muted">match</div></div>
        <div><div className="big num">{report.badge === "record-only" ? "—" : report.fit.score}</div><div className="muted">{report.badge === "record-only" ? "room fit not measured" : "room fit"}</div></div>
        <div><div className="big num">{report.weeksToOpen[0]}–{report.weeksToOpen[1]}</div><div className="muted">weeks to open</div></div>
        {report.costRange && report.costRange[1] > 0 && <div><div className="big num">{money(report.costRange[0])}–{money(report.costRange[1])}</div><div className="muted">known work</div></div>}
        {report.listing?.askingRate ? <div><div className="big num">${report.listing.askingRate}</div><div className="muted">asking $/sf/yr</div></div> : null}
        {report.listing?.price ? <div><div className="big num">${report.listing.price.toLocaleString()}</div><div className="muted">listed</div></div> : null}
      </div>

      {report.fit.assignment.length > 0 && (
        <>
          <h3>Your rooms</h3>
          <ul>{report.fit.assignment.map((a) => <li key={a.req}>{a.req}: {a.roomId ? <span className="status-pass">already built</span> : <span className="status-warn">needs building or confirming</span>}</li>)}</ul>
          {report.fit.edits.length > 0 && <p className="muted">Changes: {report.fit.edits.join("; ")}.</p>}
        </>
      )}

      <h3>What Hermit checked</h3>
      <table>
        <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Evidence</th></tr></thead>
        <tbody>
          {report.rules.filter((r) => !r.rule.startsWith("reg_")).map((r) => (
            <tr key={r.rule}>
              <th scope="row" style={{ fontWeight: 600 }}>{r.rule.replace(/_/g, " ")}</th>
              <td className={`status-${r.status}`}><span aria-hidden="true">{ICON[r.status]} </span><strong>{r.status}</strong><br /><span style={{ color: "var(--ink)" }}>{r.detail}</span></td>
              <td>{r.evidence.map((e) => <div key={e.ref} className="muted">{e.source}: {e.ref}</div>)}<a href={r.citation} target="_blank" rel="noreferrer">source</a></td>
            </tr>
          ))}
        </tbody>
      </table>

      {report.rules.some((r) => r.rule.startsWith("reg_")) && (
        <>
          <h3>Rules that may apply</h3>
          <RegulationList findings={report.rules.flatMap((r) => (r.reg ? [{ ...r.reg, url: r.citation }] : []))} />
        </>
      )}

      {report.work.length > 0 && (
        <>
          <h3>Work still to do</h3>
          <table>
            <thead><tr><th scope="col">Item</th><th scope="col">Cost</th><th scope="col">Weeks</th></tr></thead>
            <tbody>{report.work.map((w, i) => <tr key={i}><td>{w.item}</td><td className="num">{money(w.low)}–{money(w.high)}</td><td className="num">{w.weeksLow}–{w.weeksHigh}</td></tr>)}</tbody>
          </table>
          <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>Screening ranges, not bids. Weeks include permit review.{report.tiAllowance ? ` Your TI allowance input (${money(report.tiAllowance)}) is not netted out; it depends on lease terms.` : ""}</p>
        </>
      )}

      {report.unknowns.length > 0 && (
        <>
          <h3>Ask before you commit</h3>
          <ul>{report.unknowns.map((u, i) => <li key={i}><strong>{u.topic}:</strong> {u.question}</li>)}</ul>
        </>
      )}

      {printable && (
        <>
          <h3>Inquiry draft</h3>
          <pre style={{ whiteSpace: "pre-wrap", font: "inherit", background: "var(--sand-1)", padding: 14, borderRadius: 12 }}>{report.draftMessage}</pre>
        </>
      )}

      <details style={{ marginTop: 16 }}>
        <summary>Sources ({report.sources.length})</summary>
        <ul>{report.sources.map((s) => <li key={s.ref}>{s.source}: {s.ref} <span className="muted">(confidence {s.confidence})</span></li>)}</ul>
      </details>
      {!printable && onParcel && <p style={{ marginTop: 14 }}><button type="button" className="btn small parcel-map" onClick={onParcel}>Parcel info</button></p>}
      {!printable && runId && <p style={{ marginTop: 14 }}><Link href={`/shell/${report.shellId}?run=${runId}`}>Open printable report</Link></p>}
      <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Hermit is a screening tool. It doesn&apos;t inspect, certify code compliance or guarantee availability.</p>
    </div>
  );
}
