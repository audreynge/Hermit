"use client";
import { ExternalLink } from "lucide-react";
import { CREW, CrabBadge } from "../studio/CrewTrace";
import { Score, Triangulation } from "../studio/ShellReportView";
import type { ReportCtx } from "./ShellReportPage";

export function RulesTab({ report, plan, challenge }: ReportCtx) {
  return (
    <div className="rules-tab">
      <section className="card pad" aria-labelledby="plan-title">
        <h2 id="plan-title">How fast can I open? About {plan.total[0]}–{plan.total[1]} weeks</h2>
        <ol className="timeline">
          {plan.steps.map((s, i) => (
            <li key={i} data-unknown={s.unknown}>
              {!s.unknown && <span className="tl-weeks num">Weeks {s.weeks[0]}–{s.weeks[1]}</span>}
              <div><strong>{s.title}</strong><p>{s.detail}</p>{s.who && <p className="small">Who to call: <a href={s.who.url} target="_blank" rel="noreferrer">{s.who.who} <ExternalLink aria-hidden="true" className="inline-icon" /></a></p>}</div>
            </li>
          ))}
        </ol>
        <p className="muted small">Screening timeline from local permit times and the work list. Your contractor and the city set the real schedule.</p>
      </section>

      {challenge && (
        <section className="card pad skeptic" aria-labelledby="sk-title">
          <h2 id="sk-title"><CrabBadge agent="skeptic" size={30} /> The Skeptic&apos;s case against this pick</h2>
          <ul>{challenge.concerns.map((c) => <li key={c}>{c}</li>)}</ul>
          <p><strong>{challenge.outcome === "survived" ? "Verdict: it survives." : "Verdict: the crew changed its top pick."}</strong> {challenge.detail}</p>
        </section>
      )}

      <section className="card pad" aria-labelledby="rules-title">
        <h2 id="rules-title">Can I legally open here?</h2>
        <ul className="rules">
          {report.rules.map((r, i) => (
            <li key={i} data-status={r.status}><span className="rule-status">{r.status}</span><span><strong>{r.rule.replace(/_/g, " ")}</strong>: {r.detail}</span><a href={r.citation} target="_blank" rel="noreferrer" className="cite">source <ExternalLink aria-hidden="true" /></a></li>
          ))}
        </ul>
      </section>

      <section className="card pad"><Triangulation rows={report.triangulation ?? []} /></section>

      <section className="card pad" aria-labelledby="crew-f">
        <h2 id="crew-f">What each specialist found</h2>
        <div className="verdicts">
          {(report.crew ?? []).filter((v) => v.agent !== "advocate").map((v) => (
            <article key={v.agent} className="verdict" data-status={v.status}>
              <header><CrabBadge agent={v.agent} size={30} /><strong>{CREW[v.agent]?.name ?? v.agent}</strong><span className="verdict-status">{v.status}</span></header>
              <p>{v.headline}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card pad"><Score report={report} /></section>
    </div>
  );
}
