"use client";
import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, XCircle } from "lucide-react";
import type { PanoCheck, RequirementSpec, RuleHit, RuleStatus, ShellReport } from "@/lib/types";
import { fitLead, fitRows, fitShort, roomList, summaryLine } from "@/lib/uses/rooms";
import { costarStalls, parkingFinding } from "../Aerial";
import { Evidence, SeenPhoto, checkSource, listWords } from "../Evidence";
import type { ReportCtx } from "./ShellReportPage";

const ICON: Record<RuleStatus, { Icon: typeof CheckCircle2; word: string }> = {
  pass: { Icon: CheckCircle2, word: "Looks fine" }, warn: { Icon: AlertTriangle, word: "Check this" },
  fail: { Icon: XCircle, word: "Problem" }, unknown: { Icon: HelpCircle, word: "Not known yet" },
};
const LABEL: Record<string, string> = {
  zoning: "Zoning", zoning_records: "Zoning records", accessibility: "Wheelchair access", door_width: "Door width", door_hinges: "Door hinges",
  front_door: "Front door", other_floor: "Rooms on another floor", turning_space: "Turning space", wheelchair_route: "Wheelchair route",
  ground_floor: "Ground floor", parking: "Parking", onsite_parking: "Parking on site", transit: "Bus and rail", drive_in_bays: "Drive-in bays",
  reg_zoning: "Zoning", reg_parking: "Parking rules", reg_occupancy: "Occupancy permit", reg_accessibility: "Accessibility (ADA)",
  fire: "Fire safety", electrical: "Power", hvac: "Heating and cooling", measured_size: "Size", availability: "Availability", bathrooms: "Bathrooms", bedrooms: "Bedrooms",
};
const GROUPS: { title: string; rules: string[] }[] = [
  { title: "Zoning", rules: ["zoning", "zoning_records"] },
  { title: "Wheelchair access", rules: ["accessibility", "front_door", "door_width", "door_hinges", "other_floor", "turning_space", "wheelchair_route", "ground_floor"] },
  { title: "Parking and getting here", rules: ["parking", "onsite_parking", "transit", "drive_in_bays"] },
  { title: "Safety and building systems", rules: ["fire", "electrical", "hvac"] },
];
// reg_* rules can repeat with a number suffix ("reg_zoning_2"): same label.
const label = (r: string) => LABEL[r] ?? LABEL[r.replace(/_\d+$/, "")] ?? r.replace(/^reg_/, "").replace(/_\d+$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function headline(rules: RuleHit[], extra: RuleStatus[] = []) {
  const st = [...rules.map((r) => r.status), ...extra];
  const fail = st.filter((x) => x === "fail").length, check = st.filter((x) => x === "warn" || x === "unknown").length;
  if (fail) return `${plural(fail, "problem")}${check ? `, ${check} to check` : ""}.`;
  return check ? `${plural(check, "thing")} to check.` : "All clear.";
}

function RuleRow({ r, text, how }: { r: RuleHit; text?: string; how?: string[] }) {
  const { Icon, word } = ICON[r.status];
  return (
    <li className="ov-rule" data-status={r.status}>
      <Icon aria-hidden="true" className="ov-rule-icon" /><span className="sr-only">{word}: </span>
      <span><strong>{label(r.rule)}{text ? ":" : "."}</strong> {text ?? r.detail}{how && <> <Evidence lines={how} /></>}</span>
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

const RANK: Record<RuleStatus, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural1 = (w: string) => (/(s|sh|ch|x)$/.test(w) ? `${w}es` : `${w}s`);

// "Parking" and "Parking on site" usually say the same thing: keep one row (the worse status), labeled "Parking".
function mergeParking(rules: RuleHit[]): { rules: RuleHit[]; other?: RuleHit } {
  const p = rules.find((r) => r.rule === "parking"), o = rules.find((r) => r.rule === "onsite_parking");
  if (!p || !o) return { rules };
  const [keep, other] = RANK[o.status] < RANK[p.status] ? [o, p] : [p, o];
  return { rules: rules.filter((r) => r !== other).map((r) => (r === keep ? { ...keep, rule: "parking" } : r)), other };
}

// The city's zoning rule row repeats the zoning check (both read "Zoning"): keep the check, the rule goes in its "How we know".
function mergeZoning(rules: RuleHit[]): { rules: RuleHit[]; note?: string } {
  const z = rules.find((r) => r.rule === "zoning"), reg = rules.find((r) => r.rule === "reg_zoning");
  if (!z || !reg) return { rules };
  return { rules: rules.filter((r) => r !== reg), note: `City rule: ${reg.detail}` };
}

// The fixtures you asked for that the scan photos show in your matched rooms, one sentence per fixture:
// "Sinks are already in exam rooms #1 and #2, seen in the scan photos." Only what was seen; nothing invented.
function seenFixtures(report: ShellReport, spec: RequirementSpec): { text: string; checks: PanoCheck[]; rooms: string[]; feature: string }[] {
  const by = new Map<string, { rooms: string[]; checks: PanoCheck[] }>();
  for (const a of report.fit.assignment) {
    if (!a.roomId) continue;
    const asked = spec.rooms.find((r) => r.label.toLowerCase() === a.req.replace(/\s*#\d+$/, "").toLowerCase())?.fixtures ?? [];
    for (const f of asked.map((x) => x.toLowerCase())) {
      const c = (report.checks ?? []).filter((x) => x.roomId === a.roomId && x.result === "seen" && x.feature.toLowerCase() === f).sort((x, y) => y.confidence - x.confidence)[0];
      if (!c) continue;
      const g = by.get(f) ?? { rooms: [], checks: [] };
      g.rooms.push(a.req); g.checks.push(c); by.set(f, g);
    }
  }
  return [...by].map(([f, g]) => ({
    feature: f, rooms: g.rooms, checks: g.checks,
    text: g.rooms.length === 1 ? `${/^[aeiou]/.test(f) ? "An" : "A"} ${f} is already in ${roomList(g.rooms)}, seen in the scan photos.`
      : `${cap(plural1(f))} are already in ${roomList(g.rooms)}, seen in the scan photos.`,
  }));
}

// One parking sentence when the CoStar record and the aerial count disagree; null when they agree or either is missing.
function parkingClash(report: ShellReport, spec: RequirementSpec): { text: string; lines: string[] } | null {
  const rec = costarStalls(report), a = report.aerial, f = parkingFinding(report);
  if (!rec || !a || a.stalls.n == null || a.stalls.confidence < 0.5 || !f) return null;
  const n = a.stalls.n;
  const who = spec.mode === "home" ? "you'd park" : /medical|dental|clinic|doctor|therap|vet/i.test(spec.useType) ? "patients park" : spec.mode === "enterprise" ? "staff and trucks park" : "customers park";
  if (n === 0) return { text: `CoStar lists ${rec.toLocaleString()} spaces, but the aerial photo shows no surface lot. Ask where ${who}.`, lines: f.lines };
  // A count clipped to the lot that's well under the record (around-the-building counts can't be compared).
  if (a.scope === "lot" && n < rec * 0.5) return { text: `CoStar lists ${rec.toLocaleString()} spaces, but the aerial photo shows about ${n.toLocaleString()} on the lot. Ask where ${who}.`, lines: f.lines };
  return null;
}

export function Overview({ report, spec, plan, challenge, go }: ReportCtx) {
  const home = spec.mode === "home";
  const licenses = home ? [] : plan.steps.filter((s) => s.who && !s.unknown);
  const a = report.access;
  // Route verdicts from the scan, so the heading can't say "All clear" above a blocked door or room.
  const accessExtra: RuleStatus[] = a ? [a.entry.status === "blocked" ? "fail" : a.entry.status === "unknown" ? "unknown" : "pass", ...(a.asScanned.some((r) => r.status === "blocked") ? ["fail" as const] : []), ...(a.asScanned.some((r) => r.status === "unknown") ? ["unknown" as const] : [])] : [];
  const chair = a && (a.entry.status === "blocked" ? `The front door is too narrow for a ${a.chairIn[0]} inch wheelchair (about ${a.entry.clearIn?.toFixed(0)} inches clear).`
    : a.asScanned.some((r) => r.status === "blocked") ? `A wheelchair can reach ${a.asScanned.filter((r) => r.status === "reachable").length} of ${a.asScanned.length} rooms.` : null);
  const zoning = mergeZoning(report.rules.filter((r) => !(home && GROUPS[0].rules.includes(r.rule))));
  const merged = mergeParking(zoning.rules);
  const rules = merged.rules;
  const keptParking = rules.find((r) => r.rule === "parking");
  const clash = parkingClash(report, spec);
  const parkingHow = [...(clash?.lines ?? []), keptParking && `Parking check: ${keptParking.detail}`,
    merged.other && merged.other.detail !== keptParking?.detail && `On-site parking check: ${merged.other.detail}`].filter((x): x is string => !!x);
  const row = (r: RuleHit, k: string) => (r.rule === "parking" && clash ? <RuleRow key={k} r={r} text={clash.text} how={parkingHow} />
    : <RuleRow key={k} r={r} how={r.rule === "zoning" && zoning.note ? [zoning.note] : undefined} />);
  const rows = fitRows(report, spec);
  const short = fitShort(rows);
  // The summary under the verdict, from the same room rule the chat uses, with the longer room lead ("4 more could be made...").
  const summary = report.floorplan && short ? summaryLine(report, spec).replace(`${short}.`, fitLead(rows)) : summaryLine(report, spec);
  const seen = report.floorplan ? seenFixtures(report, spec).slice(0, 1) : [];
  const also = report.alsoFits ?? [];
  // Problems first, then things to check (permits with them), then unknowns.
  const issues = rules.filter((r) => r.status !== "pass").sort((x, y) => RANK[x.status] - RANK[y.status]);
  const fails = issues.filter((r) => r.status === "fail"), warns = issues.filter((r) => r.status === "warn"), unknowns = issues.filter((r) => r.status === "unknown");
  const passed = rules.length - issues.length;
  const price = report.listing?.price;
  const budget = report.listing?.kind === "sale" ? spec.budgetTotal : report.listing?.kind === "lease" ? spec.budgetMonthly : undefined;
  // The worrying questions: the skeptic's concerns, then unknowns tied to a problem or a check, then the rest.
  const flagged = issues.filter((r) => r.status !== "unknown").map((r) => r.rule.split("_")[0]);
  const concerns = challenge?.shellId === report.shellId ? challenge.concerns.map((c) => `Can you tell me more about this? ${c}`) : [];
  const unknownQs = [...report.unknowns].sort((x, y) => Number(!flagged.some((f) => x.topic.toLowerCase().includes(f))) - Number(!flagged.some((f) => y.topic.toLowerCase().includes(f)))).map((u) => u.question);
  const questions = [...new Set([...concerns, ...unknownQs])].slice(0, 5);
  const who = home ? "the landlord" : "your broker";

  return (
    <div className="ov">
      <div className="ov-main">
        <Section id="ov-rules" title={home ? "Can I live here?" : "Can I open here?"} lead={headline(rules, accessExtra)}>
          {!home && spec.city === "houston" && <p>Houston has no zoning, so the main check is the lot&apos;s deed restrictions.</p>}
          {chair && <p>{chair}</p>}
          {(issues.length > 0 || licenses.length > 0) && <ul className="ov-rules">
            {fails.map((r, i) => row(r, `f${i}`))}
            {warns.map((r, i) => row(r, `w${i}`))}
            {licenses.map((s, i) => (
              <li key={`l${i}`} className="ov-rule" data-status="warn">
                <AlertTriangle aria-hidden="true" className="ov-rule-icon" /><span className="sr-only">To do: </span>
                <span><strong>{s.title}.</strong> Ask {s.who!.who}.</span>
                <a href={s.who!.url} target="_blank" rel="noreferrer" className="ov-src">Who to ask<span className="sr-only">: {s.who!.who}</span> <ExternalLink aria-hidden="true" className="inline-icon" /></a>
              </li>
            ))}
            {unknowns.map((r, i) => row(r, `u${i}`))}
          </ul>}
          {passed > 0 && <p className="muted">{plural(passed, "other check")} {passed === 1 ? "looks" : "look"} fine.</p>}
        </Section>
      </div>

      <aside className="ov-side">
        <section className="ov-sec ov-verdict" aria-labelledby="ov-verdict">
          <h2 id="ov-verdict">{report.verdict}</h2>
          <p>{summary}</p>
          {seen.map((s) => (
            <div key={s.feature} className="ov-find">
              <SeenPhoto checks={s.checks} labels={s.rooms} title={`${cap(roomList(s.rooms))}: ${s.feature} seen`} alt={`${s.feature} in ${roomList(s.rooms)}`} />
              <p>{s.text} <Evidence lines={[...s.checks.map((c, i) => `${cap(s.rooms[i])}: ${c.note}`), checkSource(s.checks[0]), "A photo shows the fixture, not the plumbing behind the wall. Ask the landlord."]} /></p>
            </div>
          ))}
          {also.length > 0 && <p className="ov-also"><strong>Also fits:</strong> {listWords(also.map((x) => x.label))}. <Evidence lines={also.map((x) => `${x.label}: ${x.why.replace(/\.?$/, ".")}`)} /></p>}
          {price ? <p>{budget ? (price <= budget ? `$${price.toLocaleString()}, within your budget.` : `$${price.toLocaleString()}, over your $${budget.toLocaleString()} budget.`) : `Listed at $${price.toLocaleString()}.`}</p> : null}
        </section>
        <Section id="ov-qs" title="Questions to ask" lead={questions.length ? undefined : "Nothing worrying is open right now."}>
          {questions.length > 0 && <ul className="ov-qs">{questions.map((q) => <li key={q}><HelpCircle aria-hidden="true" className="ov-rule-icon" /> {q}</li>)}</ul>}
          <button type="button" className="btn primary ov-cta" onClick={() => go("broker")}>{home ? "Talk to the landlord" : "Talk to your broker"}</button>
          <p className="muted small">These go into your message to {who}.</p>
        </Section>
      </aside>
    </div>
  );
}
