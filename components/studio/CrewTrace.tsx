"use client";
import { Accessibility, ClipboardCheck, Handshake, HardHat, Map as MapIcon, MessageCircleWarning, Ruler, Satellite, Search, Sparkles, Zap } from "lucide-react";
import { useSettings } from "@/lib/client/settings";
import type { TraceEvent } from "@/lib/types";
import { plain } from "./Counter";

export const CREW: Record<string, { name: string; role: string; Icon: typeof Search }> = {
  scout: { name: "Scout", role: "broker", Icon: Search },
  inspector: { name: "Inspector", role: "walks the scan", Icon: Ruler },
  surveyor: { name: "Surveyor", role: "reads from above", Icon: Satellite },
  code: { name: "Code", role: "rules and zoning", Icon: ClipboardCheck },
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
const QUIP: Record<string, string> = {
  access: "If you can't roll in, it isn't your shell.",
  inspector: "Looked roomy online. Shells can be deceiving.",
  code: "Rules are rules, even for crabs.",
};

function friendlyRows(events: TraceEvent[], names: Map<string, string>, useLabel: string): Row[] {
  const out: Row[] = [];
  for (const e of events) {
    switch (e.type) {
      case "funnel": {
        const first = e.stages[0]?.count ?? 0, last = e.stages.at(-1)?.count ?? 0;
        const city = e.stages.find((s) => s.key === "city")?.label.replace(/^in /, "") ?? "town";
        out.push({ id: e.id, agent: "scout", kind: "work", text: `Scuttled across all ${first.toLocaleString()} shells on the beach and sniffed out ${last.toLocaleString()} in ${city} that already feel like ${/^[aeiou]/i.test(useLabel) ? "an" : "a"} ${useLabel}.` });
        break;
      }
      case "tool": {
        const agent = e.tool === "consult_specialist" ? String((e.args as { agent?: string })?.agent ?? "hermit") : TOOL_AGENT[e.tool];
        if (e.tool === "screen_sites") { const bad = num(e.summary, /(\d+) with a recorded/); out.push({ id: e.id, agent: "code", kind: "work", text: `Skimmed the paperwork on the top ${num(e.summary, /screened (\d+)/)}. ${bad ? `${bad} had red flags.` : "No red flags so far."}` }); }
        else if (e.tool === "evaluate_candidates") out.push({ id: e.id, agent: "inspector", kind: "work", text: `Crawled inside ${num(e.summary, /walked (\d+)/)} shells with a tiny tape measure and counted every room.` });
        else if (e.tool === "submit_reports") out.push({ id: e.id, agent: "advocate", kind: "work", text: `Wrote up ${num(e.summary, /(\d+) Shell/)} Shell Reports and drafted a note for the broker. Nothing gets sent without you.` });
        else if (agent === "code") out.push({ id: e.id, agent, kind: "work", text: "Read the local rulebook (zoning, parking, sprinklers) so you don't have to." });
        else if (agent === "access") out.push({ id: e.id, agent, kind: "work", text: "Measured every hallway for a 36-inch wheelchair path and looked for sneaky stairs." });
        else if (agent === "systems") out.push({ id: e.id, agent, kind: "work", text: "Knocked on the walls. Power and AC hide behind them, so I added questions for the landlord." });
        else if (agent === "surveyor") out.push({ id: e.id, agent, kind: "work", text: "Flew over the top picks for a bird's-eye (well, crab's-eye) view." });
        break;
      }
      case "handoff":
        if (e.skipped) out.push({ id: e.id, agent: e.to, kind: "skip", text: e.to === "access" ? "Stayed on the beach this time. You don't need step-free access, so no hallway measuring." : `Sat this one out: ${e.why}.` });
        else if (/^Hermit's rule/.test(e.why)) out.push({ id: e.id, agent: "hermit", kind: "work", text: `Made sure ${CREW[e.to]?.name ?? e.to} double-checked every finalist. No shell skips inspection.` });
        break;
      case "veto": out.push({ id: e.id, agent: e.agent, kind: "veto", text: `Nope! ${e.name}: ${plain(e.reason)}`, detail: QUIP[e.agent] }); break;
      case "escalate": {
        const name = names.get(e.shellId) ?? "one shell";
        const seen = e.outcome.startsWith("observed") ? "Spotted it!" : e.outcome.startsWith("described") ? "The scan's notes mention it, so I'll ask the broker to confirm." : "Couldn't see one, so it's on your question list.";
        out.push({ id: e.id, agent: "inspector", kind: "look", text: `Pressed my eye-stalks to the glass at ${name}: ${e.question.replace(/\?$/, "")}?`, detail: seen });
        break;
      }
      case "areas":
        out.push({ id: e.id, agent: "scout2", kind: "work", text: `Sniffed the tide around town. The best water for you: ${e.areas.map((a) => `${a.zip} (${a.spaces} shell${a.spaces > 1 ? "s" : ""})`).join(", ")}.`, detail: e.areas[0]?.why });
        break;
      case "challenge":
        out.push({ id: e.id, agent: "skeptic", kind: e.outcome === "swapped" ? "swap" : "look", text: `Wait a second! Before we fall for ${e.name}: ${e.concerns.join(" ")}`, detail: e.outcome === "swapped" ? `Convinced the crew. ${e.detail}` : `The crew heard me out. ${e.detail}` });
        break;
      case "rerank": {
        const top = e.reason.match(/\. (.+?) takes the top spot/)?.[1] ?? e.reason.match(/After walking the scans, (.+?) outscored/)?.[1];
        out.push({ id: e.id, agent: "hermit", kind: "swap", text: /vetoed|dropped|Skeptic flagged/.test(e.reason) ? `Plot twist! The Scout's favorite didn't make it, so ${top ?? "a new shell"} takes the crown.` : `After crawling inside, ${top ?? "a new shell"} edged out the Scout's first pick.` });
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
  const { tech } = useSettings();
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
        <p className="muted">{running ? "Scuttling…" : done ? (tech ? `${done.toolCalls} tool calls · ${(done.ms / 1000).toFixed(1)} s · ${vetoes} vetoes · planner: ${done.planner}` : `Done in ${(done.ms / 1000).toFixed(1)} seconds · ${vetoes} shell${vetoes === 1 ? "" : "s"} ruled out`) : ""}</p>
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
        {running && <li className="crew-row" data-kind="plan"><CrabBadge agent="hermit" size={34} /><p className="muted">The crew is scuttling…</p></li>}
      </ol>
    </section>
  );
}
