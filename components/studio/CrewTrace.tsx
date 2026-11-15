"use client";
import { Accessibility, ClipboardCheck, Handshake, HardHat, Map as MapIcon, MessageCircleWarning, Ruler, Satellite, Search, Sparkles, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { displayName, searchCounts } from "@/lib/chat/present";
import { an } from "@/lib/text";
import type { Evidence as Ev, PanoCheck, ShellReport, TraceEvent } from "@/lib/types";
import { Evidence, panoUrl } from "../Evidence";

// Each crab badge is one of Hermit's checks, not a person: the label says what was checked.
export const CHECKS: Record<string, { label: string; Icon: typeof Search }> = {
  scout: { label: "Search", Icon: Search },
  inspector: { label: "Scan check", Icon: Ruler },
  surveyor: { label: "Aerial check", Icon: Satellite },
  code: { label: "Rules check", Icon: ClipboardCheck },
  access: { label: "Access check", Icon: Accessibility },
  systems: { label: "Power and AC check", Icon: Zap },
  estimator: { label: "Cost check", Icon: HardHat },
  advocate: { label: "Reports", Icon: Handshake },
  skeptic: { label: "Second opinion", Icon: MessageCircleWarning },
  scout2: { label: "Area check", Icon: MapIcon },
  hermit: { label: "Hermit", Icon: Sparkles },
};
const TOOL_AGENT: Record<string, string> = { search_shells: "scout", screen_sites: "code", evaluate_candidates: "inspector", inspect_view: "inspector", drop_candidate: "hermit", submit_reports: "advocate" };

export function CrabBadge({ agent, size = 40 }: { agent: string; size?: number }) {
  const a = CHECKS[agent] ?? CHECKS.hermit;
  return (
    <span className="crab" style={{ width: size, height: size }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hermit-logo.svg" alt="" />
      <span className="hat" data-agent={agent}><a.Icon /></span>
    </span>
  );
}

type Kind = "plan" | "work" | "veto" | "look" | "swap" | "skip" | "error";
type Row = { id: string; agent: string; kind: Kind; text: string; detail?: string; how?: string[]; photo?: { src: string; alt: string } };
const SOURCE: Record<string, string> = { matterport: "Matterport scan", costar: "CoStar record", aerial: "Vexcel aerial photo", vexcel: "Vexcel aerial photo", rule: "Rule", vision: "Scan photo check", gemini: "Scan photo check" };
const refLine = (e: Ev) => `${SOURCE[e.source] ?? e.source}: ${e.ref}`;
const agentFor = (ev: Ev[] | undefined) => (ev?.some((x) => /aerial|vexcel/i.test(x.source)) ? "surveyor" : ev?.some((x) => x.source === "rule") ? "code" : ev?.some((x) => /matterport/i.test(x.source)) ? "inspector" : ev?.some((x) => /costar/i.test(x.source)) ? "code" : "hermit");

// "Suite 375 - 1600SF · Denmark House" -> "Suite 375, Denmark House"
const shortName = (name: string) => {
  const [head, building] = name.split(" · ");
  const d = displayName(head);
  return building && building !== d ? `${d}, ${building}` : d;
};

function plain(reason: string): string {
  let m;
  if ((m = reason.match(/Measured area (\d+) sf is far below the (\d+) sf/))) return `it measured only ${Number(m[1]).toLocaleString()} sf inside, much smaller than you need.`;
  if ((m = reason.match(/spans (\d+) floors/))) return `it's split over ${m[1]} levels with no elevator in sight.`;
  if ((m = reason.match(/about (\d+) in clear/))) return `the hallway is only about ${m[1]} inches wide, too tight for a wheelchair.`;
  const needs = [...reason.matchAll(/Has no ([\w -]+?)(?: \(plus \d+ to convert\))?; you need (\d+)/gi)];
  if (needs.length) return `it has ${needs.map((x) => `no ${x[1]} (you need ${x[2]})`).join(" and ")}.`;
  if (/bathroom not found/i.test(reason)) return "there's no restroom anywhere in the scan.";
  if (/zon/i.test(reason)) return "local zoning doesn't look friendly to your use.";
  const s = reason.charAt(0).toLowerCase() + reason.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

// Plain wording for agent-written reasons: ids become names, internal role names go.
function tidy(text: string, names: Map<string, string>): string {
  let s = text;
  for (const [id, n] of names) s = s.split(id).join(n);
  return s.replace(/the Scout's (first )?pick/gi, "the first pick").replace(/After walking the scans/g, "After walking inside").replace(/^(The )?[Vv]erifier /, "The final check ");
}

// Newer runs start a drop or veto reason with the space's name ("Suite 375, Denmark House: has no exam rooms").
// Old ones don't (an old rule-key prefix like "zoning: " isn't a name).
function ownName(reason: string): { name: string; why: string } | null {
  const m = reason.match(/^([^:]{3,90}): (.+)$/);
  return m && !/^[a-z_]+$/.test(m[1]) ? { name: m[1], why: m[2] } : null;
}

const featureOf = (q: string) => q.match(/is there an? ([\w -]+?)(?: in| at|\?|$)/i)?.[1]?.toLowerCase();

// The 4-6 moments that decided the result, from the real events: the search, each space ruled out, each closer look
// (with the scan photo when there is one), a changed top pick and the reports written.
function friendlyRows(events: TraceEvent[], names: Map<string, string>, checks: (PanoCheck & { shellId: string })[]): Row[] {
  const out: Row[] = [];
  const name = (id: string) => names.get(id) ?? "one space";
  const search = events.find((e): e is Extract<TraceEvent, { type: "tool" }> => e.type === "tool" && e.tool === "search_shells");
  const funnel = events.find((e): e is Extract<TraceEvent, { type: "funnel" }> => e.type === "funnel");
  const walked = events.find((e): e is Extract<TraceEvent, { type: "tool" }> => e.type === "tool" && e.tool === "evaluate_candidates");
  if (search || funnel) {
    const city = funnel?.stages.find((s) => s.key === "city")?.label.replace(/^in /, "") ?? search?.summary.match(/in (Houston|Los Angeles)/)?.[1] ?? "town";
    const n = searchCounts(events).kept || (funnel?.stages.at(-1)?.count ?? 0);
    const m = ((walked?.args as { shellIds?: string[] } | undefined)?.shellIds ?? []).length;
    out.push({ id: search?.id ?? funnel!.id, agent: "scout", kind: "work", text: `Looked at ${n.toLocaleString()} spaces in ${city}${m ? `, walked inside the best ${m}` : ""}.`,
      how: [search?.summary.replace(/; (\d+) kept$/, ""), walked ? "Walking inside means reading each space's room layout from its Matterport scan." : null].filter((x): x is string => !!x) });
  }
  // Drops with the same reason read as one moment that names every space.
  const drops = new Map<string, { id: string; ids: string[]; how: string[]; agent: string }>();
  let top: string | undefined;
  for (const e of events) {
    switch (e.type) {
      case "drop": {
        const own = ownName(e.reason);
        if (own) names.set(e.shellId, own.name);
        const why = plain(tidy(own?.why ?? e.reason.replace(/^[a-z_]+: /, ""), names));
        const d = drops.get(why);
        if (d) { d.ids.push(e.shellId); d.how.push(...e.evidence.map(refLine)); break; }
        const row: Row = { id: e.id, agent: agentFor(e.evidence), kind: "veto", text: "", how: e.evidence.map(refLine) };
        drops.set(why, { id: e.id, ids: [e.shellId], how: row.how!, agent: row.agent });
        out.push(row);
        break;
      }
      case "veto": {
        const own = ownName(e.reason);
        out.push({ id: e.id, agent: e.agent, kind: "veto", text: `Ruled out ${own?.name ?? shortName(e.name)}: ${plain(tidy(own?.why ?? e.reason, names))}`, how: e.evidence.map(refLine) });
        break;
      }
      case "escalate": {
        const said = e.outcome.toLowerCase();
        const feature = featureOf(e.question) ?? checks.find((c) => c.shellId === e.shellId && said.includes(c.feature.toLowerCase()))?.feature.toLowerCase();
        const result = e.result ?? (/^observed/.test(e.outcome) ? "seen" : /^not observed/.test(e.outcome) ? "not_seen" : undefined);
        // The photo behind the answer: a seen photo when there is one (newer outcomes can mix seen and not seen rooms).
        const pool = checks.filter((c) => c.shellId === e.shellId && (!feature || c.feature.toLowerCase() === feature) && panoUrl(c));
        const shot = pool.find((c) => c.result === "seen" && (result === "seen" || /^Looked closer/.test(e.outcome))) ?? pool.find((c) => c.result === result);
        const who = name(e.shellId);
        // Newer runs write the outcome as a plain sentence ("Looked closer at Suite 1202, MEDPLACE: a sink is visible in ...").
        const text = /^Looked closer/.test(e.outcome) ? e.outcome
          : !feature ? `Looked closer at ${who}: ${tidy(e.question, names)}`
          : result === "seen" ? `Looked closer at ${who}: ${an(feature)} is in the scan photos.`
          : result === "not_seen" ? `Looked closer at ${who}: no ${feature} in the scan photos, so it's a question for the landlord.`
          : /^described/.test(e.outcome) ? `Looked closer at ${who}: only the listing notes mention ${an(feature)}, so it's a question for the broker.`
          : `Looked closer at ${who}: couldn't tell from the photos if there's ${an(feature)}, so it's a question for the landlord.`;
        const photos = (e.evidence ?? []).filter((x) => /pano:/.test(x.ref)).length;
        const how = shot ? [shot.note, `${photos > 1 ? `${photos} photos` : "Photo"} from the Matterport scan, checked by ${shot.model.startsWith("gemini") ? "Gemini" : shot.model}.`]
          : (e.evidence ?? []).map((x) => refLine(x).replace(/pano:\w+ face \S+/, "a panorama photo"));
        out.push({ id: e.id, agent: "inspector", kind: "look", text, how,
          photo: shot ? { src: panoUrl(shot)!, alt: `Scan photo: ${shot.note}` } : undefined });
        break;
      }
      case "challenge":
        out.push({ id: e.id, agent: "skeptic", kind: e.outcome === "swapped" ? "swap" : "look", text: e.outcome === "swapped" ? `Second opinion on ${shortName(e.name)} changed the top pick.` : `Second opinion on ${shortName(e.name)}: it stays the top pick.`,
          how: [...e.concerns, e.detail].map((x) => tidy(x, names)) });
        break;
      case "rerank": {
        // Newer runs: the reason is already the plain sentence, and the new top pick is order[0].
        const reason = tidy(e.reason, names);
        const stated = /^Changed the top pick/.test(reason);
        const topChange = stated || /outscored/i.test(e.reason) || (top !== undefined && e.order[0] !== top);
        const order = e.order.map((id) => names.get(id)).filter(Boolean);
        const how = e.evidence?.length ? e.evidence.map(refLine) : order.length ? [`New order: ${order.join("; ")}.`] : [];
        const moved = reason.match(/^(.*?moved .+? to the bottom): (.+)$/);
        out.push({ id: e.id, agent: topChange ? "hermit" : agentFor(e.evidence), kind: "swap", how,
          text: stated ? reason : topChange ? `Changed the top pick: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : moved ? `${moved[1]}: ${plain(moved[2])}` : reason });
        top = e.order[0];
        break;
      }
      case "report": {
        const verify = events.find((x): x is Extract<TraceEvent, { type: "tool" }> => x.type === "tool" && x.tool === "verify_reports");
        out.push({ id: e.id, agent: "advocate", kind: "work", text: `Wrote ${e.reports.length} report${e.reports.length === 1 ? "" : "s"} and a note for the broker. Nothing is sent without you.`,
          how: verify ? [verify.summary.replace(/ \(rules \+ Gemini\)/, " (rule checks, then a second read by Gemini)")] : [] });
        break;
      }
    }
  }
  for (const [why, d] of drops) {
    const row = out.find((r) => r.id === d.id)!;
    const list = d.ids.map((id) => names.get(id)).filter((x): x is string => !!x);
    const who = list.length ? (list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`) : d.ids.length === 1 ? "one space" : `${d.ids.length} spaces`;
    row.text = `Ruled out ${who}: ${why}`;
    row.how = [...new Set(d.how)];
  }
  return out;
}

function techRows(events: TraceEvent[], names: Map<string, string>): Row[] {
  const out: Row[] = [];
  for (const e of events) {
    switch (e.type) {
      case "plan": out.push({ id: e.id, agent: "hermit", kind: "plan", text: e.text }); break;
      case "handoff": out.push({ id: e.id, agent: e.to, kind: e.skipped ? "skip" : "work", text: `${e.skipped ? "Not consulted" : "Handoff"}: ${e.why}`, detail: e.shellIds.join(", ") }); break;
      case "tool": {
        const agent = e.tool === "consult_specialist" ? String((e.args as { agent?: string })?.agent ?? "hermit") : TOOL_AGENT[e.tool] ?? "hermit";
        out.push({ id: e.id, agent, kind: "work", text: e.summary, detail: `${e.tool} · ${e.resultId} · ${e.ms} ms` });
        break;
      }
      case "veto": out.push({ id: e.id, agent: e.agent, kind: "veto", text: `Vetoed ${e.name}`, detail: `${e.reason} [${e.evidence.map((x) => x.ref).join("; ")}]` }); break;
      case "drop": out.push({ id: e.id, agent: "hermit", kind: "veto", text: `Dropped ${names.get(e.shellId) ?? e.shellId}`, detail: e.reason }); break;
      case "escalate": out.push({ id: e.id, agent: "inspector", kind: "look", text: `inspect_view ${e.shellId}: ${e.question}`, detail: `${e.outcome}${e.result ? ` · ${e.result}` : ""}` }); break;
      case "rerank": out.push({ id: e.id, agent: "hermit", kind: "swap", text: "Top pick changed", detail: e.reason }); break;
      case "areas": out.push({ id: e.id, agent: "scout2", kind: "work", text: `Areas ranked: ${e.areas.map((a) => a.zip).join(", ")}`, detail: e.areas.map((a) => `${a.zip}: ${a.why}`).join(" | ") }); break;
      case "challenge": out.push({ id: e.id, agent: "skeptic", kind: "look", text: `Challenge ${e.shellId} → ${e.outcome}`, detail: `${e.concerns.join(" | ")} :: ${e.detail}` }); break;
      case "error": out.push({ id: e.id, agent: "hermit", kind: "error", text: e.message }); break;
    }
  }
  return out;
}

export function CrewTrace({ events, running }: { events: TraceEvent[]; running: boolean; useLabel?: string }) {
  const [tech, setTools] = useState(false);
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const names = new Map<string, string>(Object.entries(fetched));
  const reports: ShellReport[] = events.flatMap((e) => (e.type === "report" ? e.reports : []));
  for (const e of events) if (e.type === "funnel") for (const s of e.stages) for (const r of s.removed) names.set(r.id, shortName(r.name));
  for (const e of events) if (e.type === "veto") names.set(e.shellId, shortName(e.name));
  for (const r of reports) names.set(r.shellId, shortName(r.name));
  const checks = reports.flatMap((r) => (r.checks ?? []).map((c) => ({ ...c, shellId: r.shellId })));

  // Spaces ruled out or looked at before any report named them: look their names up once, so every line names the space.
  const missing = [...new Set(events.flatMap((e) => (e.type === "drop" || e.type === "escalate" ? [e.shellId] : e.type === "rerank" ? e.order : [])))].filter((id) => !names.has(id) && !asked.current.has(id));
  const key = missing.join(",");
  useEffect(() => {
    if (!key) return;
    for (const id of key.split(",")) {
      asked.current.add(id);
      fetch(`/api/shell/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null))
        .then((d: { shell?: { name?: string } } | null) => { const n = d?.shell?.name; if (n) setFetched((f) => ({ ...f, [id]: shortName(n) })); })
        .catch(() => {});
    }
  }, [key]);

  const list = tech ? techRows(events, names) : friendlyRows(events, names, checks);
  const done = events.find((e) => e.type === "done") as Extract<TraceEvent, { type: "done" }> | undefined;
  const ruledOut = events.filter((e) => e.type === "veto" || e.type === "drop").length;
  return (
    <section className="card crew" aria-labelledby="crew-title">
      <header className="crew-head">
        <h2 id="crew-title">How Hermit decided</h2>
        <button type="button" className="btn small crew-toggle" aria-pressed={tech} onClick={() => setTools((t) => !t)}>{tech ? "Hide tool calls" : "Show tool calls"}</button>
        <p className="muted">{running ? "Working…" : done ? (tech ? `${done.toolCalls} tool calls · ${(done.ms / 1000).toFixed(1)} s · ${ruledOut} ruled out · planner: ${done.planner}` : ruledOut ? `${ruledOut} ruled out` : "Done") : ""}</p>
      </header>
      <ol className="crew-list">
        {list.map((r) => {
          const a = CHECKS[r.agent] ?? CHECKS.hermit;
          return (
            <li key={r.id} className="crew-row" data-kind={r.kind}>
              <CrabBadge agent={r.agent} size={34} />
              <div className="dec-body">
                <p><span className="dec-tag">{a.label}</span> {r.text}</p>
                {r.detail && <p className="crew-detail">{r.detail}</p>}
                {r.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="dec-photo" src={r.photo.src} alt={r.photo.alt} width={96} height={72} loading="lazy" />
                )}
                {r.how && <Evidence lines={r.how.map((h) => tidy(h, names))} />}
              </div>
            </li>
          );
        })}
        {running && <li className="crew-row" data-kind="plan"><CrabBadge agent="hermit" size={34} /><p className="muted">Working…</p></li>}
      </ol>
    </section>
  );
}
