"use client";
import {
  Accessibility, ArrowUpDown, CircleCheck, CircleX, DollarSign, Eye, FileText, Flame, Gavel, Layers, LayoutGrid, Car,
  Ruler, Search, Send, SlidersHorizontal, Sofa, Sparkles, Tag, User, X, Zap,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card, ChatState, Turn } from "@/lib/chat/converse";
import { compareRows, searchCounts, summarizeResults, thinkingSteps, traceSummary } from "@/lib/chat/present";
import { KEYS, load, save } from "@/lib/client/store";
import type { Draft } from "@/lib/spec/survey";
import type { RequirementSpec, ShellReport, TraceEvent } from "@/lib/types";
import { Aerial } from "./Aerial";
import { EmailDraft } from "./EmailDraft";
import { FitView } from "./FitView";
import { Modal } from "./Modal";
import { ReportPanel } from "./ReportPanel";
import { SpaceCard } from "./SpaceCard";

type Msg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "bot"; kind: "text"; paragraphs: string[]; quick?: string[]; card?: Card }
  | { id: string; role: "bot"; kind: "thinking"; runKey: string }
  | { id: string; role: "bot"; kind: "compare"; reports: ShellReport[] };

type Saved = Record<string, { report: ShellReport; spec: RequirementSpec; savedAt: string }>;
type StoredRow = { role: "user" | "bot"; kind: string; payload: { text?: string; paragraphs?: string[]; quick?: string[]; card?: Card; reports?: ShellReport[] } };
type ConvResponse = { id: string; owner: boolean; state: ChatState; messages: StoredRow[]; run: { spec: RequirementSpec; events: TraceEvent[] } | null };
type ChatResponse = { conversationId: string; turn: Turn };

function fromStored(r: StoredRow): Msg | null {
  if (r.role === "user") return { id: uid(), role: "user", text: r.payload.text ?? "" };
  if (r.kind === "text") return { id: uid(), role: "bot", kind: "text", paragraphs: r.payload.paragraphs ?? [], quick: r.payload.quick?.length ? r.payload.quick : undefined, card: r.payload.card };
  if (r.kind === "compare" && r.payload.reports) return { id: uid(), role: "bot", kind: "compare", reports: r.payload.reports };
  return null;
}

const ICONS: Record<string, typeof Search> = { search: Search, gavel: Gavel, bolt: Zap, flame: Flame, car: Car, accessible: Accessibility, tag: Tag, ruler: Ruler, layout: LayoutGrid, dollar: DollarSign, x: CircleX, eye: Eye, sort: ArrowUpDown, doc: FileText };
const uid = () => Math.random().toString(36).slice(2, 10);
const EMPTY_DRAFT: Draft = { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" };
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} failed (${res.status})`);
  return res.json();
}

export function SearchChat() {
  const params = useSearchParams();
  const router = useRouter();
  const conv = useRef<string | null>(params.get("c"));
  const replay = params.get("replay");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chat, setChat] = useState<ChatState>({ spec: EMPTY_DRAFT, asked: [], phase: "gathering" });
  const [spec, setSpec] = useState<RequirementSpec | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [reports, setReports] = useState<ShellReport[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [shown, setShown] = useState(0);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<"inside" | "above" | "fit">("inside");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [tour, setTour] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<ShellReport | null>(null);
  const [detailsFor, setDetailsFor] = useState<ShellReport | null>(null);
  const [saved, setSaved] = useState<Saved>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [runKey, setRunKey] = useState("");
  const [resultsReady, setResultsReady] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const bot = (paragraphs: string[], quick?: string[], card?: Card): Msg => ({ id: uid(), role: "bot", kind: "text", paragraphs, quick, card });
  const push = (...m: Msg[]) => setMessages((x) => [...x, ...m]);
  const persist = (body: { messages?: unknown[]; state?: ChatState; lastRunId?: string | null }) =>
    conv.current ? fetch(`/api/conversations/${conv.current}`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}) : Promise.resolve();

  const steps = useMemo(() => (spec ? thinkingSteps(events, spec) : []), [events, spec]);

  const runSearch = useCallback(async (s: RequirementSpec, replayId?: string) => {
    const key = uid();
    setSpec(s); setEvents([]); setReports([]); setShown(0); setSelected(0); setRunning(true); setRunKey(key); setTour(null); setResultsReady(false);
    push({ id: uid(), role: "bot", kind: "thinking", runKey: key });
    try {
      const res = replayId
        ? await fetch(`/api/agent?replay=${encodeURIComponent(replayId)}`)
        : await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      if (!res.ok || !res.body) throw new Error(res.status === 404 ? "No recorded demo run is available yet." : `Search failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const e = JSON.parse(line.slice(6)) as TraceEvent;
          if (e.type === "run") { setRunId(e.runId); if (e.spec) setSpec(e.spec); }
          else setEvents((x) => [...x, e]);
          if (e.type === "report") setReports(e.reports);
        }
      }
    } catch (err) {
      setMessages((xs) => xs.filter((m) => !(m.role === "bot" && m.kind === "thinking" && m.runKey === key)));
      setRunKey("");
      push(bot([`${err instanceof Error ? err.message : String(err)}. Try again, or change what you're looking for.`]));
    } finally {
      setRunning(false);
    }
  }, []);

  // Reveal thinking steps one at a time so the agent's work is legible; instant with reduced motion.
  useEffect(() => {
    if (shown >= steps.length) return;
    const t = setTimeout(() => setShown((n) => Math.min(steps.length, n + 1)), reduceMotion() ? 0 : 520);
    return () => clearTimeout(t);
  }, [shown, steps.length]);

  const finished = !running && runKey !== "" && shown >= steps.length && events.some((e) => e.type === "done");
  const announced = useRef("");
  useEffect(() => {
    if (!finished || !spec || announced.current === runKey) return;
    announced.current = runKey;
    const { considered } = searchCounts(events);
    const s = summarizeResults(reports, spec, { considered, dropped: events.filter((e) => e.type === "drop").length });
    const quick = reports.length ? ["Compare the layouts", "Draft an email", "Make it bigger"] : ["Make it bigger", "Raise the budget"];
    push(bot([...s.paragraphs, s.followUp], quick));
    const next = { ...chat, phase: "results" as const };
    setChat(next);
    if (!replay) void persist({ messages: [{ role: "bot", kind: "text", payload: { paragraphs: [...s.paragraphs, s.followUp], quick } }], state: next, lastRunId: runId });
    setResultsReady(true);
  }, [finished, spec, reports, events, runKey, runId, replay, chat]);

  const respond = useCallback(async (turn: Turn) => {
    setChat(turn.state);
    push(bot([turn.reply], turn.quickReplies.length ? turn.quickReplies : undefined, turn.card));
    if (turn.action === "compare" && reports.length) {
      push({ id: uid(), role: "bot", kind: "compare", reports });
      void persist({ messages: [{ role: "bot", kind: "compare", payload: { reports } }] });
    }
    if (turn.action === "email" && reports.length) setEmailFor(reports[selected] ?? reports[0]);
    if (turn.ready && turn.state.spec.city && turn.state.spec.useType) await runSearch(turn.state.spec as RequirementSpec);
  }, [reports, selected, runSearch]);

  const openNew = useCallback(async (draft: Draft, userText?: string) => {
    try {
      const r = await postJSON<ChatResponse>("/api/chat", { open: true, spec: draft, ...(userText ? { userText } : {}) });
      conv.current = r.conversationId;
      router.replace(`${window.location.pathname}?c=${r.conversationId}`, { scroll: false });
      await respond(r.turn);
    } catch {
      push(bot(["I couldn't reach the Hermit server. Check that it's running and try again."]));
    }
  }, [respond, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch("/api/saved").then((r) => (r.ok ? r.json() : [])).then((rows: { report: ShellReport; spec: RequirementSpec; savedAt: string }[]) =>
      setSaved(Object.fromEntries(rows.map((x) => [x.report.shellId, x])))).catch(() => {});
    if (replay) {
      push({ id: uid(), role: "user", text: "Show me the recorded demo search." });
      push(bot(["Here's a recorded run. It replays the exact steps without calling any outside service."]));
      void runSearch({ ...EMPTY_DRAFT, city: "houston", useType: "space" }, replay);
      return;
    }
    const pending = load<{ source: "survey" | "layout"; spec?: Draft; summary?: string }>(KEYS.pending);
    if (!pending && conv.current) {
      fetch(`/api/conversations/${conv.current}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((c: ConvResponse) => {
        setMessages(c.messages.map(fromStored).filter((m): m is Msg => !!m));
        setChat(c.state);
        if (c.run) {
          const rep = c.run.events.find((e) => e.type === "report") as Extract<TraceEvent, { type: "report" }> | undefined;
          setSpec(c.run.spec); setEvents(c.run.events); setReports(rep?.reports ?? []);
          setShown(Number.MAX_SAFE_INTEGER); setResultsReady(!!rep?.reports.length);
          const run = c.run.events.find((e) => e.type === "run") as Extract<TraceEvent, { type: "run" }> | undefined;
          setRunId(run?.runId ?? null);
        }
      }).catch(() => { conv.current = null; push(bot(["I couldn't find that conversation. Let's start a new one."])); void openNew(EMPTY_DRAFT); });
      return;
    }
    save(KEYS.pending, null);
    const draft = pending?.source === "layout" && pending.spec ? pending.spec : EMPTY_DRAFT;
    if (pending?.summary) push({ id: uid(), role: "user", text: pending.summary });
    void openNew(draft, pending?.summary);
  }, [replay, openNew, runSearch]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" }); }, [messages, shown]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || busy || running) return;
    setInput("");
    push({ id: uid(), role: "user", text: t });
    setBusy(true);
    try {
      const r = await postJSON<ChatResponse>("/api/chat", { conversationId: conv.current, text: t });
      await respond(r.turn);
    } catch {
      push(bot(["Something went wrong talking to the server. Try that again?"]));
    } finally {
      setBusy(false);
    }
  };

  const toggleSave = (r: ShellReport) => {
    if (!spec) return;
    const next = { ...saved };
    if (next[r.shellId]) delete next[r.shellId];
    else next[r.shellId] = { report: r, spec, savedAt: new Date().toISOString() };
    setSaved(next);
    void (next[r.shellId]
      ? fetch("/api/saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report: r, spec }) })
      : fetch(`/api/saved?shellId=${encodeURIComponent(r.shellId)}`, { method: "DELETE" }));
  };

  const current = reports[selected];
  const visibleReports = resultsReady ? reports : [];
  const showResults = visibleReports.length > 0;
  const searching = running || (runKey !== "" && !resultsReady && !finished);
  const summary = resultsReady ? traceSummary(events) : [];
  const lastQuick = [...messages].reverse().find((m) => m.role === "bot" && m.kind === "text") as Extract<Msg, { kind: "text" }> | undefined;

  return (
    <>
      <div className="search-grid">
        <section className="card chat" aria-label="Chat with Hermit">
          <div className="tabs-pill" role="group" aria-label="Evidence for the selected space">
            {([["inside", "Inside", Sofa], ["above", "Above", Layers], ["fit", "Fit", SlidersHorizontal]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" data-active={tab === k} aria-expanded={tab === k && evidenceOpen && showResults} aria-controls="evidence-panel"
                onClick={() => { if (tab === k && evidenceOpen) setEvidenceOpen(false); else { setTab(k); setEvidenceOpen(true); } }}
                title={showResults ? `Show ${label.toLowerCase()} view of the selected space` : "Available once Hermit finds matches"}>
                <Icon aria-hidden="true" /> {label}
              </button>
            ))}
          </div>

          {showResults && current && evidenceOpen && (
            <div className="evidence" id="evidence-panel" role="region" aria-label={`${tab} view of ${current.name.split(" · ")[0]}`}>
              {tab === "fit" ? (
                <div className="fit"><FitView report={current} /></div>
              ) : (
                <div className="media">
                  {tab === "above" && <Aerial report={current} />}
                  {tab === "inside" && (current.inside
                    ? tour === current.inside.sid
                      ? <iframe title={`Matterport 3D tour of ${current.name}`} src={`https://my.matterport.com/show/?m=${current.inside.sid}&play=1&qs=1&brand=0`} allow="xr-spatial-tracking; fullscreen" allowFullScreen />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img className="photo" src={`/api/asset/${current.inside.sid}`} alt={`Inside ${current.name.split(" · ")[0]}`} onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                    : <p style={{ padding: 20 }}>No 3D scan for this space; its details come from CoStar records.</p>)}
                </div>
              )}
              <div className="cap">
                <span>{tab === "inside" ? "Matterport scan" : tab === "above" ? "Esri World Imagery (Vexcel not connected)" : "Your rooms mapped onto the measured floor plan"} · {current.name.split(" · ")[0]}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  {tab === "inside" && current.inside && tour !== current.inside.sid && <button type="button" className="btn small" onClick={() => setTour(current.inside!.sid)}>Open 3D tour</button>}
                  <button type="button" className="btn small" onClick={() => setEvidenceOpen(false)} aria-label="Hide evidence"><X aria-hidden="true" /></button>
                </span>
              </div>
            </div>
          )}

          <div className="messages" ref={scroller} aria-live="polite" aria-label="Conversation">
            {messages.map((m) => {
              if (m.role === "user") return (
                <div key={m.id} className="msg user"><span className="avatar user" aria-hidden="true"><User /></span><div className="bubbles"><div className="bubble">{m.text}</div></div></div>
              );
              return (
                <div key={m.id} className="msg bot">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="avatar bot" aria-hidden="true"><img src="/hermit-logo.svg" alt="" /></span>
                  <div className="bubbles">
                    {m.kind === "text" && (
                      <>
                        <div className="bubble">{m.paragraphs.slice(0, m.paragraphs.length > 2 ? -1 : undefined).map((p, i) => <p key={i}>{p}</p>)}</div>
                        {m.paragraphs.length > 2 && <div className="bubble"><p>{m.paragraphs.at(-1)}</p></div>}
                        {m.card && m === lastQuick && !running && <MultiCard card={m.card} onSubmit={send} />}
                        {m.quick && m === lastQuick && !running && (
                          <div className="quick" role="group" aria-label="Suggested replies">{m.quick.map((q) => <button key={q} type="button" onClick={() => send(q)}>{q}</button>)}</div>
                        )}
                      </>
                    )}
                    {m.kind === "thinking" && <Thinking steps={m.runKey === runKey ? steps.slice(0, shown) : steps} total={steps.length} done={m.runKey !== runKey || finished} />}
                    {m.kind === "compare" && <Compare reports={m.reports} />}
                  </div>
                </div>
              );
            })}
            {busy && <div className="msg bot"><span className="avatar bot" aria-hidden="true">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/hermit-logo.svg" alt="" /></span><div className="bubble"><span className="dots" aria-label="Hermit is typing"><span /><span /><span /></span></div></div>}
          </div>

          <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <Sparkles className="spark" aria-hidden="true" />
            <label htmlFor="ask" className="sr-only">Message Hermit</label>
            <input id="ask" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tell Hermit what you're looking for..." autoComplete="off" />
            <button className="send" type="submit" disabled={!input.trim() || busy || running} aria-label="Send"><Send aria-hidden="true" /></button>
          </form>
        </section>

        <section className="card results-card" aria-labelledby="matches-title">
          <div className="results-head">
            <h2 id="matches-title"><Layers aria-hidden="true" /> Matching Spaces</h2>
            <span className="muted" role="status">{searching ? "Searching…" : showResults ? `${visibleReports.length} result${visibleReports.length === 1 ? "" : "s"}` : ""}</span>
          </div>
          <div className="results-list">
            {!showResults && (
              <div style={{ padding: "40px 20px", textAlign: "center" }} className="muted">
                {searching ? "Hermit is checking spaces. Matches will appear here." : "Tell Hermit about your space and the best matches will show up here, each with the evidence behind it."}
              </div>
            )}
            {showResults && spec && visibleReports.map((r, i) => (
              <SpaceCard key={r.shellId} report={r} spec={spec} selected={i === selected} saved={!!saved[r.shellId]}
                onSelect={() => { setSelected(i); setTour(null); }}
                onEmail={() => setEmailFor(r)} onDetails={() => setDetailsFor(r)} onSave={() => toggleSave(r)} />
            ))}
          </div>
        </section>
      </div>

      <section className="card trace-bar" aria-label="Agent trace">
        <span className="title"><Sparkles aria-hidden="true" /> Agent Trace</span>
        {summary.length === 0 && <span className="muted">{searching ? "Working through the checks…" : "Hermit's steps will show here once it starts searching."}</span>}
        {summary.map((s) => <span key={s} className="trace-step"><CircleCheck aria-hidden="true" /> {s}</span>)}
        {events.length > 0 && (
          <details>
            <summary>See every step</summary>
            <ol className="trace-full" tabIndex={0} aria-label="Full agent trace">
              {events.filter((e) => e.type !== "report").map((e) => (
                <li key={e.id}>
                  <span className={`kind ${e.type}`}>{e.type}</span>{" "}
                  {e.type === "plan" && e.text}
                  {e.type === "tool" && <><code>{e.tool}</code> {e.summary} <span className="muted num">({e.resultId})</span></>}
                  {e.type === "drop" && <><strong>{e.shellId}</strong>: {e.reason}</>}
                  {e.type === "escalate" && <><strong>{e.shellId}</strong>: {e.question} → {e.outcome}</>}
                  {e.type === "rerank" && e.reason}
                  {e.type === "error" && e.message}
                  {e.type === "done" && `Finished in ${(e.ms / 1000).toFixed(1)}s with ${e.toolCalls} tool calls (${e.planner} planner).`}
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>

      {emailFor && <EmailDraft report={emailFor} onClose={() => setEmailFor(null)} />}
      {detailsFor && <Modal title={detailsFor.name.split(" · ")[0]} onClose={() => setDetailsFor(null)}><ReportPanel report={detailsFor} runId={runId} /></Modal>}
    </>
  );
}

function Thinking({ steps, total, done }: { steps: ReturnType<typeof thinkingSteps>; total: number; done: boolean }) {
  const pct = done ? 100 : total ? Math.round((steps.length / Math.max(total, steps.length + 1)) * 100) : 8;
  return (
    <div className="bubble thinking" aria-label={done ? "Hermit finished checking" : "Hermit is thinking"}>
      <div className="thinking-head">{done ? "Here's what I checked" : <>Thinking <span className="dots" aria-hidden="true"><span /><span /><span /></span></>}</div>
      <div className="shore" aria-hidden="true">
        <div className="water" style={{ width: `${pct}%` }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="crab" src="/hermit-logo.svg" alt="" style={{ left: `calc(${pct}% - 30px)` }} />
      </div>
      {steps.map((s, i) => {
        const Icon = ICONS[s.icon] ?? Search;
        const active = !done && i === steps.length - 1;
        return (
          <div key={s.id} className={`think-step ${s.tone}${active ? " active" : ""}`}>
            <span className="ic"><Icon aria-hidden="true" /></span>
            <span>{s.label}</span>
            <span className="state">{active ? <span className="dots" aria-hidden="true"><span /><span /><span /></span> : <CircleCheck aria-hidden="true" />}</span>
          </div>
        );
      })}
    </div>
  );
}

function Compare({ reports }: { reports: ShellReport[] }) {
  const rows = compareRows(reports);
  return (
    <div className="bubble compare-wrap" style={{ padding: 12 }} tabIndex={0} aria-label="Comparison of matching spaces">
      <table className="compare">
        <thead><tr><th scope="col"><span className="sr-only">Measure</span></th>{reports.map((r) => <th key={r.shellId} scope="col">{r.name.split(" · ")[0]}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th>{row.values.map((v, i) => <td key={i} className="num">{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function MultiCard({ card, onSubmit }: { card: Card; onSubmit: (text: string) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (label: string) => setPicked((p) => (p.includes(label) ? p.filter((x) => x !== label) : [...p, label]));
  return (
    <div className="multi-card" role="group" aria-label="Choose all that apply">
      {card.options.map((o) => (
        <button key={o.value} type="button" className="chip-toggle" aria-pressed={picked.includes(o.label)} onClick={() => toggle(o.label)}>{o.label}</button>
      ))}
      <button type="button" className="btn primary" disabled={!picked.length} onClick={() => onSubmit(picked.join(", "))}>Done</button>
    </div>
  );
}
