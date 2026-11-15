"use client";
import { Accessibility, ClipboardCheck, Handshake, HardHat, Map as MapIcon, MessageCircleWarning, Ruler, Satellite, Search, Sparkles, Zap } from "lucide-react";
import { useState } from "react";
import { useSettings } from "@/lib/client/settings";
import type { TraceEvent } from "@/lib/types";

export const CREW: Record<string, { name: string; role: string; Icon: typeof Search }> = {
  scout: { name: "Scout", role: "broker", Icon: Search },
  inspector: { name: "Inspector", role: "walks the scan", Icon: Ruler },
  surveyor: { name: "Surveyor", role: "reads from above", Icon: Satellite },
  code: { name: "Code", role: "city, state, federal rules", Icon: ClipboardCheck },
  access: { name: "Access", role: "accessibility", Icon: Accessibility },
  systems: { name: "Systems", role: "power and AC", Icon: Zap },
  estimator: { name: "Estimator", role: "contractor", Icon: HardHat },
  advocate: { name: "Advocate", role: "your negotiator", Icon: Handshake },
  skeptic: { name: "Skeptic", role: "devil's advocate", Icon: MessageCircleWarning },
  scout2: { name: "Neighborhood scout", role: "reads the area", Icon: MapIcon },
  hermit: { name: "Hermit", role: "crew captain", Icon: Sparkles },
};
const TOOL_AGENT: Record<string, string> = { search_shells: "scout", screen_sites: "code", evaluate_candidates: "inspector", inspect_view: "inspector", drop_candidate: "hermit", submit_reports: "advocate" };

export function CrabBadge({ agent, size = 40 }: { agent: string; size?: number }) {
  const a = CREW[agent] ?? CREW.hermit;
  return (
    <span className="crab" style={{ width: size, height: size }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hermit-logo.svg" alt="" />
      <span className="hat" data-agent={agent}><a.Icon /></span>
    </span>
  );
}

type Row = { id: string; agent: string; kind: "plan" | "work" | "veto" | "look" | "swap" | "skip" | "error"; text: string; detail?: string };
const num = (s: string, re: RegExp) => Number(s.match(re)?.[1] ?? 0);

function plain(reason: string): string {
  let m;
  if ((m = reason.match(/Measured area (\d+) sf is far below the (\d+) sf/))) return `it measured only ${Number(m[1]).toLocaleString()} sf inside, much smaller than you need.`;
  if ((m = reason.match(/spans (\d+) floors/))) return `it's split over ${m[1]} levels with no elevator in sight.`;
  if ((m = reason.match(/about (\d+) in clear/))) return `the hallway is only about ${m[1]} inches wide, too tight for a wheelchair.`;
  if (/bathroom not found/i.test(reason)) return "there's no restroom anywhere in the scan.";
  if (/zon/i.test(reason)) return "local zoning doesn't look friendly to your use.";
  return reason.charAt(0).toLowerCase() + reason.slice(1);
}

function friendlyRows(events: TraceEvent[], names: Map<string, string>, useLabel: string): Row[] {
  const out: Row[] = [];
  for (const e of events) {
    switch (e.type) {
      case "funnel": {
        const last = e.stages.at(-1)?.count ?? 0;
        const city = e.stages.find((s) => s.key === "city")?.label.replace(/^in /, "") ?? "town";
        out.push({ id: e.id, agent: "scout", kind: "work", text: `Found ${last.toLocaleString()} spaces in ${city} already set up for ${/^[aeiou]/i.test(useLabel) ? "an" : "a"} ${useLabel}.` });
        break;
      }
      case "tool": {
        const agent = e.tool === "consult_specialist" ? String((e.args as { agent?: string })?.agent ?? "hermit") : TOOL_AGENT[e.tool];
        if (e.tool === "screen_sites") { const bad = num(e.summary, /(\d+) with a recorded/); out.push({ id: e.id, agent: "code", kind: "work", text: bad ? `Checked the rules. ${bad} had red flags.` : "Checked the rules. No red flags." }); }
        else if (e.tool === "evaluate_candidates") out.push({ id: e.id, agent: "inspector", kind: "work", text: "Measured the rooms in each scan." });
        else if (e.tool === "submit_reports") out.push({ id: e.id, agent: "advocate", kind: "work", text: "Wrote your reports and a note for the broker. Nothing is sent without you." });
        else if (agent === "code") out.push({ id: e.id, agent, kind: "work", text: "Checked city, county, state and federal rules." });
        else if (agent === "access") out.push({ id: e.id, agent, kind: "work", text: "Checked hallways and doors for wheelchair access." });
        else if (agent === "systems") out.push({ id: e.id, agent, kind: "work", text: "Added power and AC questions for the landlord." });
        else if (agent === "surveyor") out.push({ id: e.id, agent, kind: "work", text: "Looked at the top picks from above." });
        break;
      }
      case "handoff":
        if (e.skipped) out.push({ id: e.id, agent: e.to, kind: "skip", text: e.to === "access" ? "Skipped the access check. You don't need step-free entry." : `Skipped: ${e.why}.` });
        else if (/^Hermit's rule/.test(e.why)) out.push({ id: e.id, agent: "hermit", kind: "work", text: `${CREW[e.to]?.name ?? e.to} double-checked every finalist.` });
        break;
      case "veto": out.push({ id: e.id, agent: e.agent, kind: "veto", text: `Ruled out ${e.name}: ${plain(e.reason)}` }); break;
      case "escalate": {
        const name = names.get(e.shellId) ?? "one space";
        const seen = e.outcome.startsWith("observed") ? "Found it." : e.outcome.startsWith("described") ? "Only the notes mention it. Ask the broker." : "Couldn't see one. Added to your questions.";
        out.push({ id: e.id, agent: "inspector", kind: "look", text: `Looked at ${name}: ${e.question.replace(/\?$/, "")}?`, detail: seen });
        break;
      }
      case "areas":
        out.push({ id: e.id, agent: "scout2", kind: "work", text: `Best areas for you: ${e.areas.map((a) => a.zip).join(", ")}.`, detail: e.areas[0]?.why });
        break;
      case "challenge":
        out.push({ id: e.id, agent: "skeptic", kind: e.outcome === "swapped" ? "swap" : "look", text: `Second look at ${e.name}: ${e.concerns.join(" ")}`, detail: e.outcome === "swapped" ? `Top pick changed. ${e.detail}` : `Top pick stayed. ${e.detail}` });
        break;
      case "rerank": {
        const top = e.reason.match(/\. (.+?) takes the top spot/)?.[1] ?? e.reason.match(/After walking the scans, (.+?) outscored/)?.[1];
        out.push({ id: e.id, agent: "hermit", kind: "swap", text: `${top ?? "A new space"} is now the top pick.` });
        break;
      }
    }
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
      case "escalate": out.push({ id: e.id, agent: "inspector", kind: "look", text: `inspect_view ${e.shellId}: ${e.question}`, detail: e.outcome }); break;
      case "rerank": out.push({ id: e.id, agent: "hermit", kind: "swap", text: "Top pick changed", detail: e.reason }); break;
      case "areas": out.push({ id: e.id, agent: "scout2", kind: "work", text: `Areas ranked: ${e.areas.map((a) => a.zip).join(", ")}`, detail: e.areas.map((a) => `${a.zip}: ${a.why}`).join(" | ") }); break;
      case "challenge": out.push({ id: e.id, agent: "skeptic", kind: "look", text: `Challenge ${e.shellId} → ${e.outcome}`, detail: `${e.concerns.join(" | ")} :: ${e.detail}` }); break;
      case "error": out.push({ id: e.id, agent: "hermit", kind: "error", text: e.message }); break;
    }
  }
  return out;
}

export function CrewTrace({ events, running, useLabel = "space" }: { events: TraceEvent[]; running: boolean; useLabel?: string }) {
  const { tech: techSetting } = useSettings();
  const [tools, setTools] = useState(false);
  const tech = techSetting || tools;
  const names = new Map<string, string>();
  for (const e of events) if (e.type === "veto") names.set(e.shellId, e.name);
  for (const e of events) if (e.type === "report") for (const r of e.reports) names.set(r.shellId, r.name);
  const list = tech ? techRows(events, names) : friendlyRows(events, names, useLabel);
  const done = events.find((e) => e.type === "done") as Extract<TraceEvent, { type: "done" }> | undefined;
  const vetoes = events.filter((e) => e.type === "veto").length;
  return (
    <section className="card crew" aria-labelledby="crew-title">
      <header className="crew-head">
        <h2 id="crew-title">The crew at work</h2>
        <button type="button" className="btn small crew-toggle" aria-pressed={tech} onClick={() => setTools((t) => !t)} disabled={techSetting}>{tech ? "Show the crew" : "Show tool calls"}</button>
        <p className="muted">{running ? "Working…" : done ? (tech ? `${done.toolCalls} tool calls · ${(done.ms / 1000).toFixed(1)} s · ${vetoes} vetoes · planner: ${done.planner}` : vetoes ? `${vetoes} ruled out` : "Done") : ""}</p>
      </header>
      <ol className="crew-list">
        {list.map((r) => {
          const a = CREW[r.agent] ?? CREW.hermit;
          return (
            <li key={r.id} className="crew-row" data-kind={r.kind}>
              <CrabBadge agent={r.agent} size={34} />
              <div>
                <p><strong>{a.name}</strong> <span className="muted">({a.role})</span> {r.text}</p>
                {r.detail && <p className="crew-detail">{r.detail}</p>}
              </div>
            </li>
          );
        })}
        {running && <li className="crew-row" data-kind="plan"><CrabBadge agent="hermit" size={34} /><p className="muted">Working…</p></li>}
      </ol>
    </section>
  );
}
