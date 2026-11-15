"use client";
import { Check, Minus, X } from "lucide-react";
import type { Evidence, ShellReport, TriRow } from "@/lib/types";
import { PropertyViewer } from "../PropertyViewer";

export function SourceChip({ e }: { e: Evidence | string }) {
  const ev = typeof e === "string" ? { source: e.split(" ")[0], ref: e, confidence: 0.5 } : e;
  return <span className="source-chip" title={`${ev.ref}${typeof e === "string" ? "" : ` (confidence ${ev.confidence.toFixed(2)})`}`} tabIndex={0}>{ev.source}<span className="sr-only">: {ev.ref}</span></span>;
}

const LAYER_LABEL = { costar: "Record / listing", matterport: "Matterport scan", aerial: "Aerial" } as const;
const CELL_ICON = { agree: Check, disagree: X, absent: Minus };

export function Triangulation({ rows }: { rows: TriRow[] }) {
  return (
    <table className="tri">
      <caption>Inside and out: a claim is confirmed only when two layers agree</caption>
      <thead><tr><th scope="col">Claim</th>{(Object.keys(LAYER_LABEL) as (keyof typeof LAYER_LABEL)[]).map((k) => <th key={k} scope="col">{LAYER_LABEL[k]}</th>)}<th scope="col">Verdict</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.claim}>
            <th scope="row">{r.claim}<p className="tri-detail">{r.detail}</p></th>
            {(Object.keys(LAYER_LABEL) as (keyof typeof LAYER_LABEL)[]).map((k) => {
              const c = r.cells[k];
              const Icon = CELL_ICON[c.state];
              return <td key={k} data-state={c.state}><Icon aria-hidden="true" /><span className="sr-only">{c.state}: </span>{c.note}</td>;
            })}
            <td><span className="tri-verdict" data-v={r.verdict}>{r.verdict.replace("-", " ")}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Score({ report }: { report: ShellReport }) {
  const sum = (report.score ?? []).reduce((s, l) => s + l.earned, 0);
  return (
    <table className="score">
      <caption>Why {report.matchScore}%: every point accounted for</caption>
      <thead><tr><th scope="col">Factor</th><th scope="col">Points</th><th scope="col">Why</th><th scope="col">Source</th></tr></thead>
      <tbody>
        {(report.score ?? []).map((l, i) => (
          <tr key={i} data-loss={l.earned < l.max || l.earned < 0}>
            <th scope="row">{l.factor}</th>
            <td className="num">{l.max ? `${l.earned} / ${l.max}` : l.earned}</td>
            <td>{l.note}{l.max > 0 && l.earned < l.max ? <span className="loss"> (−{l.max - l.earned})</span> : null}</td>
            <td><SourceChip e={l.source} /></td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><th scope="row">Total</th><td className="num">{Math.max(0, Math.min(100, sum))}</td><td colSpan={2} /></tr></tfoot>
    </table>
  );
}

// Kept for old callers: the step-inside experience now lives in PropertyViewer; long report sections live on /shell.
export function ShellReportView({ report, onClose, furniture }: { report: ShellReport; onClose: () => void; packetHref?: string; furniture?: Record<string, string[]> }) {
  return <PropertyViewer report={report} onClose={onClose} furniture={furniture} initial={report.inside ? "inside" : "fit"} />;
}
