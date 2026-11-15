"use client";
import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, XCircle } from "lucide-react";
import { competitors, customers, errands, gettingAround, neighbors } from "@/lib/neighborhood/summarize";
import type { RuleHit, RuleStatus } from "@/lib/types";
import { FootHeatmap } from "../FootHeatmap";
import { showsFootTraffic } from "@/lib/neighborhood/relevance";
import type { ReportCtx } from "./ShellReportPage";

const ICON: Record<RuleStatus, { Icon: typeof CheckCircle2; word: string }> = {
  pass: { Icon: CheckCircle2, word: "Looks fine" }, warn: { Icon: AlertTriangle, word: "Check this" },
  fail: { Icon: XCircle, word: "Problem" }, unknown: { Icon: HelpCircle, word: "Not known yet" },
};
const LABEL: Record<string, string> = {
  zoning: "Zoning", zoning_records: "Zoning records", accessibility: "Wheelchair access", door_width: "Door width", door_hinges: "Door hinges",
  front_door: "Front door", other_floor: "Rooms on another floor", turning_space: "Turning space", wheelchair_route: "Wheelchair route",
  ground_floor: "Ground floor", parking: "Parking", onsite_parking: "Parking on site", transit: "Bus and rail", drive_in_bays: "Drive-in bays",
  fire: "Fire safety", electrical: "Power", hvac: "Heating and cooling", measured_size: "Size", availability: "Availability", bathrooms: "Bathrooms", bedrooms: "Bedrooms",
};
const GROUPS: { title: string; rules: string[] }[] = [
  { title: "Zoning", rules: ["zoning", "zoning_records"] },
  { title: "Wheelchair access", rules: ["accessibility", "front_door", "door_width", "door_hinges", "other_floor", "turning_space", "wheelchair_route", "ground_floor"] },
  { title: "Parking and getting here", rules: ["parking", "onsite_parking", "transit", "drive_in_bays"] },
  { title: "Safety and building systems", rules: ["fire", "electrical", "hvac"] },
];
const label = (r: string) => LABEL[r] ?? r.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function headline(rules: RuleHit[], extra: RuleStatus[] = []) {
  const st = [...rules.map((r) => r.status), ...extra];
  const fail = st.filter((x) => x === "fail").length, check = st.filter((x) => x === "warn" || x === "unknown").length;
  if (fail) return `${plural(fail, "problem")}${check ? `, ${check} to check` : ""}.`;
  return check ? `${plural(check, "thing")} to check.` : "All clear.";
}

function RuleRow({ r }: { r: RuleHit }) {
  const { Icon, word } = ICON[r.status];
  return (
    <li className="ov-rule" data-status={r.status}>
      <Icon aria-hidden="true" className="ov-rule-icon" /><span className="sr-only">{word}: </span>
      <span><strong>{label(r.rule)}.</strong> {r.detail}</span>
      {r.citation && <a href={r.citation} target="_blank" rel="noreferrer" className="ov-src">Source<span className="sr-only"> for {label(r.rule)}</span> <ExternalLink aria-hidden="true" className="inline-icon" /></a>}
    </li>
  );
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <section className="ov-sec" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {lead && <p className="ov-lead">{lead}</p>}
      {children}
    </section>
  );
}

export function Overview({ report, spec, site, use, challenge, plan, go }: ReportCtx) {
  const home = spec.mode === "home";
  const built = report.fit.assignment.filter((a) => a.roomId), toBuild = report.fit.assignment.filter((a) => !a.roomId);
  const total = report.fit.assignment.length;
  const known = new Set(GROUPS.flatMap((g) => g.rules));
  const other = report.rules.filter((r) => !known.has(r.rule));
  const steps = plan.steps.filter((s) => !s.unknown);
  const licenses = plan.steps.filter((s) => s.who && !s.unknown);
  const a = report.access;
  const chairWords = a && (a.entry.status === "fits" ? `A ${a.chairIn[0]} inch wheelchair fits through the front door`
    : a.entry.status === "blocked" ? `The front door is too narrow for a ${a.chairIn[0]} inch wheelchair (about ${a.entry.clearIn?.toFixed(0)} inches clear)`
    : "The scan didn't measure the front door");
  const reach = a ? a.asScanned.filter((r) => r.status === "reachable").length : 0;
  // Route verdicts from the scan, so the heading can't say "All clear" above a blocked door or room.
  const accessExtra: RuleStatus[] = a ? [a.entry.status === "blocked" ? "fail" : a.entry.status === "unknown" ? "unknown" : "pass", ...(a.asScanned.some((r) => r.status === "blocked") ? ["fail" as const] : []), ...(a.asScanned.some((r) => r.status === "unknown") ? ["unknown" as const] : [])] : [];
  const price = report.listing?.price;
  const budget = report.listing?.kind === "sale" ? spec.budgetTotal : report.listing?.kind === "lease" ? spec.budgetMonthly : undefined;
  const nb = home
    ? [{ q: "What's it like?", a: neighbors(site) }, { q: "Getting around", a: gettingAround(site) }, { q: "Errands nearby", a: errands(site) }]
    : [{ q: "Customers", a: customers(site) }, { q: "Who's nearby", a: neighbors(site) }, { q: "Competitors", a: competitors(site, use) }];

  return (
    <div className="ov">
      <section className="ov-sec ov-verdict" aria-labelledby="ov-verdict">
        <h2 id="ov-verdict">{report.verdict}</h2>
        <p className="ov-lead">{report.summary}</p>
        <ul className="ov-list">{report.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}</ul>
        {home && (price
          ? <p className="ov-lead">{budget ? (price <= budget ? `At $${price.toLocaleString()}, it's within your budget.` : `At $${price.toLocaleString()}, it's over your $${budget.toLocaleString()} budget.`) : `Listed at $${price.toLocaleString()}.`}</p>
          : <p className="muted">The price isn&apos;t in the listing data. Ask the landlord.</p>)}
        {challenge && <p className="muted">We argued against this pick: {challenge.outcome === "survived" ? "it held up." : "the crew changed its top pick."} {challenge.detail}</p>}
      </section>

      <Section id="ov-fit" title={home ? "Will my stuff fit?" : "Will it fit?"}
        lead={total ? `${built.length} of the ${total} rooms you want are already built.` : "This space has no scan to measure."}>
        {total > 0 && (
          <div className="ov-two">
            <div><h3>Already here</h3>{built.length ? <ul className="ov-list">{built.map((x, i) => <li key={i}>{x.req}</li>)}</ul> : <p className="muted">None yet.</p>}</div>
            <div><h3>To build</h3>{toBuild.length ? <ul className="ov-list">{toBuild.map((x, i) => <li key={i}>{x.req}</li>)}</ul> : <p className="muted">Nothing. Every room is here.</p>}</div>
          </div>
        )}
        {report.work.length > 0 && <>
          <h3>Work left: about {report.weeksToOpen[0]} to {report.weeksToOpen[1]} weeks</h3>
          <ul className="ov-list">{report.work.map((w, i) => <li key={i}>{w.item.replace(/\(.*?\)/g, "").trim()} <span className="muted">({w.weeksLow}–{w.weeksHigh} weeks)</span></li>)}</ul>
        </>}
        {report.buildout?.length ? <p className="muted">Things you need, as seen in the scan: {report.buildout.map((b) => `${b.item} (${b.status === "seen" ? "seen" : "not confirmed"})`).join(", ")}.</p> : null}
      </Section>

      <Section id="ov-rules" title={home ? "Can I live here?" : "Can I open here?"} lead={headline(report.rules, accessExtra)}>
        {!home && spec.city === "houston" && <p>Houston has no zoning, so the main check is the lot&apos;s deed restrictions.</p>}
        {GROUPS.filter((g) => !home || g.title !== "Zoning").map((g) => {
          const rows = report.rules.filter((r) => g.rules.includes(r.rule));
          if (!rows.length && !(g.title === "Wheelchair access" && a)) return null;
          return (
            <div key={g.title} className="ov-group">
              <h3>{g.title}: <span className="ov-group-sum">{headline(rows, g.title === "Wheelchair access" ? accessExtra : [])}</span></h3>
              {g.title === "Wheelchair access" && a && <p>{chairWords}, and it can reach {reach} of {a.asScanned.length} rooms.</p>}
              <ul className="ov-rules">{rows.map((r, i) => <RuleRow key={i} r={r} />)}</ul>
            </div>
          );
        })}
        {!home && licenses.length > 0 && (
          <div className="ov-group">
            <h3>Licenses and permits</h3>
            <ul className="ov-rules">{licenses.map((s, i) => (
              <li key={i} className="ov-rule" data-status="warn">
                <AlertTriangle aria-hidden="true" className="ov-rule-icon" /><span className="sr-only">To do: </span>
                <span><strong>{s.title}.</strong> Ask {s.who!.who}.</span>
                <a href={s.who!.url} target="_blank" rel="noreferrer" className="ov-src">Who to ask<span className="sr-only">: {s.who!.who}</span> <ExternalLink aria-hidden="true" className="inline-icon" /></a>
              </li>
            ))}</ul>
          </div>
        )}
        {other.length > 0 && (
          <div className="ov-group">
            <h3>The space itself: <span className="ov-group-sum">{headline(other)}</span></h3>
            <ul className="ov-rules">{other.map((r, i) => <RuleRow key={i} r={r} />)}</ul>
          </div>
        )}
      </Section>

      <Section id="ov-where" title="Where it is" lead={report.address || undefined}>
        <FootHeatmap report={report} site={site} heat={showsFootTraffic(spec.mode, use, spec.useType)} />
      </Section>

      <Section id="ov-nb" title="Neighborhood">
        <ul className="ov-facts">
          {nb.map(({ q, a: ans }) => <li key={q}><strong>{q}:</strong> {ans.headline}</li>)}
          {!home && report.conflicts?.[0] && <li><strong>Heads up:</strong> {report.conflicts[0].name} is {report.conflicts[0].where}. It may hold an exclusive, so ask before you tour.</li>}
        </ul>
      </Section>

      <Section id="ov-time" title={home ? "How soon can I move in?" : "How soon can I open?"} lead={`About ${plan.total[0]} to ${plan.total[1]} weeks.`}>
        <ol className="ov-steps">
          {steps.map((s, i) => (
            <li key={i}><span className="ov-weeks num">Weeks {s.weeks[0]}–{s.weeks[1]}</span><span><strong>{s.title}.</strong> {s.detail}</span></li>
          ))}
        </ol>
        {plan.steps.filter((s) => s.unknown).map((s) => (
          <p key={s.title} className="muted">{s.title}: {s.detail}{s.who && <> Ask <a href={s.who.url} target="_blank" rel="noreferrer">{s.who.who} <ExternalLink aria-hidden="true" className="inline-icon" /></a>.</>}</p>
        ))}
      </Section>

      <Section id="ov-unknown" title="What's still unknown" lead={report.unknowns.length || challenge?.concerns.length ? undefined : "Nothing big. You can still ask anything."}>
        {report.unknowns.length > 0 && <ol className="ov-list">{report.unknowns.slice(0, 3).map((u) => <li key={u.question}>{u.question}</li>)}</ol>}
        {challenge?.concerns.length ? <>
          <h3>What our double-check worried about</h3>
          <ul className="ov-list">{challenge.concerns.slice(0, 3).map((c) => <li key={c}>{c}</li>)}</ul>
        </> : null}
        <button type="button" className="btn primary ov-cta" onClick={() => go("broker")}>{home ? "Talk to the landlord" : "Talk to your broker"}</button>
      </Section>

      <p className="muted small">Screening only: Hermit doesn&apos;t inspect, certify code status or promise availability. Neighborhood numbers are public data and proxies.</p>
    </div>
  );
}
