"use client";
import { breakEven } from "@/lib/money";
import { competitors, customers, neighbors } from "@/lib/neighborhood/summarize";
import { Card, useFurnished, useMoney } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function Overview({ report, spec, site, use, challenge, plan, go }: ReportCtx) {
  const [m] = useMoney(spec, report);
  const [items] = useFurnished(report.shellId);
  const c = customers(site), n = neighbors(site), comp = competitors(site, use);
  const be = m.price && m.rent ? breakEven(m) : null;
  const built = report.fit.assignment.filter((a) => a.roomId).length, total = report.fit.assignment.length;
  const zoning = report.rules.find((r) => r.rule === "zoning");
  const lic = plan.steps.find((s) => /license|permit and/i.test(s.title));
  const catches = [...(challenge?.concerns ?? []), ...report.unknowns.slice(0, 3).map((u) => u.question)].slice(0, 3);

  return (
    <div className="overview">
      <section className="verdict-card">
        <h2>{report.verdict}</h2>
        <p className="lede">{report.summary}</p>
        <ul className="reasons">{report.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}</ul>
        <div className="next-step">
          <strong>Next step:</strong> send the broker your {report.unknowns.length} questions.
          <button type="button" className="btn primary small" onClick={() => go("questions")}>Draft the message</button>
          <button type="button" className="btn small" onClick={() => go("inside")}>Step inside first</button>
        </div>
      </section>

      <div className="q-grid">
        <Card title="Will customers come here?" answer={c.headline} onMore={() => go("neighborhood")} tone={c.missing ? "unknown" : undefined}>
          <ul>{c.lines.slice(0, 2).map((l) => <li key={l}>{l}</li>)}</ul>
        </Card>
        <Card title="Who lives and works nearby?" answer={n.headline} onMore={() => go("neighborhood")}>
          <ul>{n.lines.slice(0, 2).map((l) => <li key={l}>{l}</li>)}{n.missing && <li className="muted">{n.missing}.</li>}</ul>
        </Card>
        <Card title="Who am I competing with?" answer={report.conflicts?.length ? `${report.conflicts[0].name} is ${report.conflicts[0].where}.` : comp.headline} onMore={() => go("neighborhood")} tone={report.conflicts?.length ? "warn" : undefined}>
          {report.conflicts?.length ? <p className="small">Same kind of business on this block: it may hold an exclusive. Ask before you tour.</p> : null}
          <ul>{comp.lines.slice(0, 2).map((l) => <li key={l}>{l}</li>)}</ul>
        </Card>
        {report.buildout?.length ? (
          <Card title="Is the build-out really there?" answer={`${report.buildout.filter((b) => b.status === "seen").length} of ${report.buildout.length} things you need are visible in the scan.`} onMore={() => go("packet")} more="They're in your packet" tone={report.buildout.some((b) => b.status === "unverified") ? "warn" : "good"}>
            <p className="chips-line">{report.buildout.map((b) => <span key={b.item} className={b.status === "seen" ? "chip-seen" : "chip-unv"} title={b.evidence}>{b.item}: {b.status === "seen" ? "seen" : b.status === "mentioned" ? "mentioned, unverified" : "unverified"}</span>)}</p>
          </Card>
        ) : null}
        <Card title="Can I afford it?" answer={be ? `To cover rent and running costs, you need about ${be.perDayRounded} customer${be.perDayRounded === 1 ? "" : "s"} a day at your ${money(m.price)} average.` : m.price ? "Add the asking rent and I'll turn it into customers a day." : "Tell me your average sale and the rent, and I'll turn it into customers a day."} onMore={() => go("money")} more="Do the math" tone={be ? (be.perDayRounded <= 20 ? "good" : "warn") : "unknown"} />
        <Card title="Will my stuff fit?" answer={total ? `${built} of your ${total} rooms are already built here.${items.length ? ` You've placed ${items.length} piece${items.length > 1 ? "s" : ""} of furniture and they fit.` : ""}` : "This space has no scan to measure."} onMore={() => go("furnish")} more="Furnish it" tone={built === total ? "good" : "warn"}>
          {report.work.length > 0 && <p className="muted small">To build: {report.work.slice(0, 2).map((w) => w.item.replace(/\(.*?\)/g, "").trim()).join(", ")}.</p>}
        </Card>
        <Card title="Can I legally open here?" answer={zoning?.status === "fail" ? "Zoning looks like a problem for your use." : spec.city === "houston" ? "Houston has no zoning, so the main check is the lot's deed restrictions." : zoning?.status === "pass" ? "The zone generally allows your use (screening)." : "Zoning isn't on record yet; ask the city."} onMore={() => go("rules")}>
          {lic && <p className="small">You&apos;ll need: {lic.title.toLowerCase()}{lic.who ? <> from <a href={lic.who.url} target="_blank" rel="noreferrer">{lic.who.who}</a></> : ""}.</p>}
        </Card>
        <Card title="What's the catch?" answer={catches.length ? catches[0] : "Nothing obvious from the evidence."} onMore={() => go("questions")} more="See every question" tone="warn">
          {catches.length > 1 && <ul>{catches.slice(1).map((x) => <li key={x}>{x}</li>)}</ul>}
        </Card>
        <Card title="How fast can I open?" answer={`About ${plan.total[0]} to ${plan.total[1]} weeks from signing to opening.`} onMore={() => go("rules")} more="Week-by-week plan" tone="good">
          <p className="small muted">Permits and build-out alone: {report.weeksToOpen[0]}–{report.weeksToOpen[1]} weeks. {plan.steps.filter((s) => !s.unknown).map((s) => s.title).join(" → ")}</p>
        </Card>
      </div>
      <p className="muted small">Screening only: Hermit doesn&apos;t inspect, certify code status or promise availability. Neighborhood numbers are public data and proxies.</p>
    </div>
  );
}
