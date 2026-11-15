"use client";
import { Check, Copy, ExternalLink, HelpCircle, Minus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Evidence, ShellReport, TriRow } from "@/lib/types";
import { Aerial } from "../Aerial";
import { FitView } from "../FitView";
import { CREW, CrabBadge } from "./CrewTrace";
import { ScoreRing } from "./Postcard";

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

type Step = { text: string; sweep?: string; room?: string };

// The guided walkthrough: Hermit narrates where each of your rooms lands, like an agent on a showing.
function tourSteps(report: ShellReport, furniture: Record<string, string[]>): Step[] {
  const g = report.floorplan;
  const steps: Step[] = [{ text: `Welcome to ${report.name}! Let me show you where everything you need would go.`, sweep: g?.panos?.find((p) => p.id === report.inside?.sweepId)?.label }];
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  for (const a of report.fit.assignment) {
    const base = a.req.replace(/ #\d+$/, "");
    if (!a.roomId) { steps.push({ text: `Your ${a.req} isn't built here yet. My Estimator priced it under “Work left” below.` }); continue; }
    const room = g?.rooms.find((r) => r.id === a.roomId);
    const sweep = g?.panos?.find((p) => p.id === room?.panoId)?.label;
    const items = [...new Set(furniture[base] ?? [])];
    const area = room ? ` It's about ${Math.round(room.areaSqft).toLocaleString()} sf.` : "";
    steps.push({ text: `This is where your ${a.req} would go.${area}${items.length ? ` Picture your ${list(items)} right here.` : ""}`, sweep, room: a.req });
  }
  steps.push({ text: report.unknowns.length ? `That's the tour! I couldn't see ${report.unknowns.length} things from the scan, so I turned them into questions for the broker below.` : "That's the tour!" });
  return steps;
}

export function ShellReportView({ report, onClose, packetHref, furniture = {} }: { report: ShellReport; onClose: () => void; packetHref?: string; furniture?: Record<string, string[]> }) {
  const sid = report.inside?.sid;
  const [tab, setTab] = useState<"inside" | "plan" | "above">(sid ? "inside" : report.floorplan ? "plan" : "above");
  const [draft, setDraft] = useState(report.draftMessage);
  const [copied, setCopied] = useState("");
  const [step, setStep] = useState(0);
  const [guide, setGuide] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const steps = useMemo(() => tourSteps(report, furniture), [report, furniture]);
  // The tour only reloads when the step points at a different sweep.
  const sweep = useMemo(() => { for (let i = step; i >= 0; i--) if (steps[i].sweep) return steps[i].sweep; return undefined; }, [step, steps]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("h2")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);

  const weeks = `${report.weeksToOpen[0]}–${report.weeksToOpen[1]} weeks`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(draft); setCopied("Copied. Paste it into your email; Hermit never sends it."); }
    catch { setCopied("Copy didn't work here. Select the text and copy it instead."); }
  };

  return (
    <div className="report-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="report" role="dialog" aria-modal="true" aria-labelledby="report-title">
        <header className="report-head">
          <div>
            <p className="eyebrow">Shell Report #{report.rank} · <span className={`stamp-inline ${report.badge === "scan-verified" ? "ok" : "rec"}`}>{report.badge}</span></p>
            <h2 id="report-title" tabIndex={-1}>{report.name}</h2>
            <p className="muted">{report.address || "Address not in the index"}{report.sqft ? ` · ${report.sqft.toLocaleString()} sf` : ""}</p>
          </div>
          <ScoreRing value={report.matchScore} size={64} />
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close report"><X aria-hidden="true" /></button>
        </header>

        <div className="stage">
          <div className="seg" role="tablist" aria-label="See the space">
            {sid && <button role="tab" type="button" aria-selected={tab === "inside"} onClick={() => setTab("inside")}>Step inside (3D)</button>}
            <button role="tab" type="button" aria-selected={tab === "plan"} onClick={() => setTab("plan")}>Your layout on the floor plan</button>
            {report.above && <button role="tab" type="button" aria-selected={tab === "above"} onClick={() => setTab("above")}>From above</button>}
          </div>
          <div className="stage-media" role="tabpanel" aria-label={tab}>
            {tab === "inside" && sid && (
              <>
                <iframe key={sweep ?? "start"} title={`Matterport 3D tour of ${report.name}`} src={`https://my.matterport.com/show/?m=${sid}&play=1&qs=1&brand=0&help=0${sweep && /^\d+$/.test(sweep) ? `&ss=${sweep}` : ""}`} allow="xr-spatial-tracking; fullscreen" allowFullScreen />
                {guide ? (
                  <div className="guide" role="region" aria-label="Hermit's guided tour" aria-live="polite">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/hermit-logo.svg" alt="" className="guide-crab" />
                    <div className="guide-bubble">
                      <p>{steps[step].text}</p>
                      <div className="guide-nav">
                        <button type="button" className="btn small" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0}>Back</button>
                        <span className="muted small num">{step + 1} / {steps.length}</span>
                        {step < steps.length - 1
                          ? <button type="button" className="btn small primary" onClick={() => setStep((x) => x + 1)}>Next room</button>
                          : <button type="button" className="btn small" onClick={() => { setGuide(false); setStep(0); }}>Explore on my own</button>}
                        <button type="button" className="icon-btn small-x" aria-label="Hide the tour guide" onClick={() => setGuide(false)}><X aria-hidden="true" /></button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="guide-reopen" onClick={() => setGuide(true)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/hermit-logo.svg" alt="" /> Show me around
                  </button>
                )}
              </>
            )}
            {tab === "plan" && (
              <div className="plan-pair">
                <FitView report={report} />
                {sid && report.floorplan?.floorplan && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="floorplan-img" src={`/api/asset/${sid}?kind=floorplan`} alt={`Matterport floor plan render of ${report.name}`} />
                )}
              </div>
            )}
            {tab === "above" && report.above && <Aerial report={report} />}
          </div>
          <p className="stage-cap">
            {tab === "inside" ? `Matterport scan ${sid}. As Hermit walks you through, the tour jumps to the spot nearest each room. If it can't load offline, use the floor plan tab.`
              : tab === "plan" ? "Your rooms mapped onto the measured rooms. Dashed blocks are rooms to build."
              : "Esri World Imagery at the recorded coordinates (Vexcel access pending). Garages can't be counted from the air."}
          </p>
        </div>

        <section className="report-sec" aria-labelledby="sum">
          <h3 id="sum">{report.verdict}</h3>
          <p className="lede">{report.summary}</p>
          <div className="headline-row">
            <div className="headline"><span className="num">{weeks}</span><span>to open (screening)</span></div>
            <div className="headline"><span className="num">{report.fit.assignment.filter((a) => a.roomId).length} / {report.fit.assignment.length}</span><span>rooms already built</span></div>
            <div className="headline"><span className="num">{report.unknowns.length}</span><span>questions for the broker</span></div>
          </div>
        </section>

        <section className="report-sec"><Triangulation rows={report.triangulation ?? []} /></section>
        <section className="report-sec"><Score report={report} /></section>

        <section className="report-sec" aria-labelledby="work">
          <h3 id="work">Work left</h3>
          {report.work.length ? (
            <ul className="work">
              {report.work.map((w, i) => (
                <li key={i}><span>{w.item}</span><span className="num">{w.weeksLow}–{w.weeksHigh} wk</span><span className="num muted" title="Screening estimate, not a bid">${Math.round(w.low / 1000)}k–${Math.round(w.high / 1000)}k</span><SourceChip e={{ source: "cost table", ref: w.source, confidence: 0.4 }} /></li>
              ))}
            </ul>
          ) : <p>No build-out found in the scan. Permits and move-in still take time.</p>}
          <p className="muted small">Required because you&apos;re altering: under the ADA, alterations trigger path-of-travel upgrades up to 20% of the alteration cost. Dollar figures are screening ranges from a sourced table{report.tiAllowance ? `; your TI allowance of $${Math.round(report.tiAllowance / 1000)}k offsets part of it` : ""}.</p>
        </section>

        <section className="report-sec" aria-labelledby="crewsec">
          <h3 id="crewsec">What each specialist found</h3>
          <div className="verdicts">
            {(report.crew ?? []).filter((v) => v.agent !== "advocate").map((v) => (
              <article key={v.agent} className="verdict" data-status={v.status}>
                <header><CrabBadge agent={v.agent} size={32} /><strong>{CREW[v.agent]?.name ?? v.agent}</strong><span className="verdict-status">{v.status}</span></header>
                <p>{v.headline}</p>
                {v.claims.length > 0 && <ul>{v.claims.slice(0, 4).map((c, i) => <li key={i}>{c.text} {c.evidence.slice(0, 2).map((e, j) => <SourceChip key={j} e={e} />)}</li>)}</ul>}
              </article>
            ))}
          </div>
        </section>

        <section className="report-sec" aria-labelledby="rules">
          <h3 id="rules">Rule and local-law screens</h3>
          <ul className="rules">
            {report.rules.map((r, i) => (
              <li key={i} data-status={r.status}><span className="rule-status">{r.status}</span><span><strong>{r.rule.replace(/_/g, " ")}</strong>: {r.detail}</span><a href={r.citation} target="_blank" rel="noreferrer" className="cite">source <ExternalLink aria-hidden="true" /></a></li>
            ))}
          </ul>
        </section>

        <section className="report-sec" aria-labelledby="qs">
          <h3 id="qs"><HelpCircle aria-hidden="true" /> Questions no specialist could answer</h3>
          <ol className="questions">{report.unknowns.slice(0, 10).map((u, i) => <li key={i}><span className="q-topic">{u.topic}</span> {u.question}</li>)}</ol>
        </section>

        <section className="report-sec" aria-labelledby="msg">
          <h3 id="msg">Draft message to broker</h3>
          <label className="sr-only" htmlFor="draft">Draft message</label>
          <textarea id="draft" value={draft} onChange={(e) => setDraft(e.target.value)} rows={9} />
          <div className="actions">
            <button type="button" className="btn primary" onClick={copy}><Copy aria-hidden="true" /> Copy message</button>
            {packetHref && <a className="btn" href={packetHref} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Open broker packet</a>}
            <span role="status" className="muted">{copied}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
