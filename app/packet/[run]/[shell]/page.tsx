import Link from "next/link";
import { loadRun } from "@/lib/agent/replay";
import type { TraceEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Broker packet · Hermit" };

// One link a broker can open: the requirement, what the layers confirm, what's still open, and the drafted inquiry.
export default async function Packet({ params }: { params: Promise<{ run: string; shell: string }> }) {
  const { run: runId, shell } = await params;
  const run = await loadRun(runId);
  const report = run?.events.flatMap((e) => (e.type === "report" ? e.reports : [])).find((r) => r.shellId === shell);
  if (!run || !report) return <p className="card pad">Packet not found. It may come from a run on another server. <Link href="/">Start with Hermit</Link>.</p>;
  const s = run.spec;
  const funnel = run.events.find((e): e is Extract<TraceEvent, { type: "funnel" }> => e.type === "funnel");
  const vetoes = run.events.filter((e) => e.type === "veto").length;
  const rooms = s.rooms.map((r) => `${r.count} × ${r.label}${r.minSqft ? ` (≥${r.minSqft} sf)` : ""}${r.fixtures?.length ? ` with ${r.fixtures.join(", ")}` : ""}`);
  const needs = Object.entries(s.needs).filter(([, v]) => v).map(([k, v]) => (v === true ? k : `${k}: ${v}`));
  return (
    <article className="packet">
      <header>
        <p className="eyebrow">Hermit broker packet · qualified lead · {new Date(run.createdAt).toLocaleDateString()}</p>
        <h1>{report.name}</h1>
        <p className="muted">{report.address}</p>
      </header>
      <section className="lead-metrics" aria-label="Lead summary">
        <div><strong className="num">{funnel?.stages[0]?.count.toLocaleString() ?? "—"}</strong><span>scans screened</span></div>
        <div><strong className="num">{(funnel?.stages.at(-1)?.count ?? 0).toLocaleString()}</strong><span>fit the brief</span></div>
        <div><strong className="num">{vetoes}</strong><span>vetoed by specialists</span></div>
        <div><strong className="num">{report.unknowns.length}</strong><span>open questions</span></div>
      </section>
      <section><h2>What the client needs</h2>
        <p>A {s.useType} in {s.city === "houston" ? "Houston" : "Los Angeles"}{s.sizeSqft ? `, ${s.sizeSqft[0].toLocaleString()}–${s.sizeSqft[1].toLocaleString()} sf` : ""}{s.moveInBy ? `, moving in ${s.moveInBy}` : ""}.</p>
        <ul>{rooms.map((r) => <li key={r}>{r}</li>)}{needs.map((n) => <li key={n}>{n}</li>)}</ul>
      </section>
      <section><h2>What the evidence shows ({report.badge})</h2>
        <p>{report.summary}</p>
        <ul>{(report.triangulation ?? []).map((t) => <li key={t.claim}><strong>{t.claim}:</strong> {t.verdict.replace("-", " ")}. {t.detail}</li>)}</ul>
      </section>
      <section><h2>Open questions</h2><ol>{report.unknowns.slice(0, 10).map((u, i) => <li key={i}>{u.question}</li>)}</ol></section>
      <section><h2>Drafted inquiry</h2><pre className="draft">{report.draftMessage}</pre></section>
      <p className="muted small">Screening only. Hermit doesn&apos;t inspect, certify code status or confirm availability. Nothing was sent on the client&apos;s behalf.</p>
    </article>
  );
}
