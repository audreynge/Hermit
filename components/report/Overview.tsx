"use client";
import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, XCircle } from "lucide-react";
import type { RuleHit, RuleStatus } from "@/lib/types";
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

export function Overview({ report, spec, plan, go }: ReportCtx) {
  const home = spec.mode === "home";
  const total = report.fit.assignment.length;
  const toBuild = report.fit.assignment.filter((a) => !a.roomId);
  const licenses = home ? [] : plan.steps.filter((s) => s.who && !s.unknown);
  const a = report.access;
  // Route verdicts from the scan, so the heading can't say "All clear" above a blocked door or room.
  const accessExtra: RuleStatus[] = a ? [a.entry.status === "blocked" ? "fail" : a.entry.status === "unknown" ? "unknown" : "pass", ...(a.asScanned.some((r) => r.status === "blocked") ? ["fail" as const] : []), ...(a.asScanned.some((r) => r.status === "unknown") ? ["unknown" as const] : [])] : [];
  const chair = a && (a.entry.status === "blocked" ? `The front door is too narrow for a ${a.chairIn[0]} inch wheelchair (about ${a.entry.clearIn?.toFixed(0)} inches clear).`
    : a.asScanned.some((r) => r.status === "blocked") ? `A wheelchair can reach ${a.asScanned.filter((r) => r.status === "reachable").length} of ${a.asScanned.length} rooms.` : null);
  const rules = report.rules.filter((r) => !(home && GROUPS[0].rules.includes(r.rule)));
  const issues = rules.filter((r) => r.status !== "pass");
  const passed = rules.length - issues.length;
  const price = report.listing?.price;
  const budget = report.listing?.kind === "sale" ? spec.budgetTotal : report.listing?.kind === "lease" ? spec.budgetMonthly : undefined;

  return (
    <div className="ov">
      <section className="ov-sec ov-verdict" aria-labelledby="ov-verdict">
        <h2 id="ov-verdict">{report.verdict}</h2>
        <p className="ov-lead">{report.summary}</p>
        {price ? <p>{budget ? (price <= budget ? `$${price.toLocaleString()}, within your budget.` : `$${price.toLocaleString()}, over your $${budget.toLocaleString()} budget.`) : `Listed at $${price.toLocaleString()}.`}</p> : null}
      </section>

      <Section id="ov-fit" title={home ? "Will my stuff fit?" : "Will it fit?"}
        lead={!total ? "This space has no scan to measure." : toBuild.length ? `${total - toBuild.length} of ${total} rooms are already built. To build: ${toBuild.map((x) => x.req).join(", ")}.` : `All ${total} rooms you want are already built.`} />

      <Section id="ov-rules" title={home ? "Can I live here?" : "Compliance"} lead={headline(rules, accessExtra)}>
        {!home && spec.city === "houston" && <p>Houston has no zoning, so the main check is the lot&apos;s deed restrictions.</p>}
        {chair && <p>{chair}</p>}
        {issues.length > 0 && <ul className="ov-rules">{issues.map((r, i) => <RuleRow key={i} r={r} />)}</ul>}
        {passed > 0 && <p className="muted">{plural(passed, "other check")} look fine.</p>}
        {licenses.length > 0 && <>
          <h3>Licenses and permits</h3>
          <ul className="ov-rules">{licenses.map((s, i) => (
            <li key={i} className="ov-rule" data-status="warn">
              <AlertTriangle aria-hidden="true" className="ov-rule-icon" /><span className="sr-only">To do: </span>
              <span><strong>{s.title}.</strong> Ask {s.who!.who}.</span>
              <a href={s.who!.url} target="_blank" rel="noreferrer" className="ov-src">Who to ask<span className="sr-only">: {s.who!.who}</span> <ExternalLink aria-hidden="true" className="inline-icon" /></a>
            </li>
          ))}</ul>
        </>}
      </Section>

      <Section id="ov-time" title={home ? "How soon can I move in?" : "How soon can I open?"} lead={`About ${plan.total[0]} to ${plan.total[1]} weeks.`}>
        <button type="button" className="btn primary ov-cta" onClick={() => go("broker")}>{home ? "Talk to the landlord" : "Talk to your broker"}</button>
      </Section>

      <p className="muted small">Screening only: Hermit doesn&apos;t inspect, certify code status or promise availability.</p>
    </div>
  );
}
