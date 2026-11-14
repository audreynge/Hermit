"use client";
import {
  Accessibility, ArrowUpDown, Check, CircleCheck, CircleX, DollarSign, Eye, FileText, Flame, Gavel, Layers, LayoutGrid, Car,
  ImageUp, PencilRuler, Plus, Ruler, Search, Send, SlidersHorizontal, Sofa, Sparkles, Tag, User, X, Zap,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card, ChatState, Turn } from "@/lib/chat/converse";
import { compareRows, searchCounts, summarizeResults, thinkingSteps, traceSummary } from "@/lib/chat/present";
import type { Draft } from "@/lib/spec/survey";
import type { Block } from "@/lib/spec/parse";
import { layoutSummary, validateUpload } from "@/lib/design/extract";
import { DesignSheet } from "./DesignSheet";
import { DesignThumb } from "./DesignThumb";
import type { RequirementSpec, ShellReport, TraceEvent } from "@/lib/types";
import { Aerial } from "./Aerial";
import { EmailDraft } from "./EmailDraft";
import { FitView, type Proposal } from "./FitView";
import { LayoutPreview } from "./LayoutPreview";
import type { FitoutDiff, FitoutOp } from "@/lib/design/fitout";
import { loadLayouts, putLayout } from "@/lib/client/layouts";
import { KEYS, load, save } from "@/lib/client/store";
import { Modal } from "./Modal";
import { ReportPanel } from "./ReportPanel";
import { PropertyViewer } from "./PropertyViewer";
import { RegulationList } from "./Regulations";
import type { Finding } from "@/lib/regs/research";
import { SpaceCard } from "./SpaceCard";

type Msg =
  | { id: string; role: "user"; text: string; design?: DesignPreview }
  | { id: string; role: "bot"; kind: "text"; paragraphs: string[]; quick?: string[]; card?: Card; fallback?: boolean }
  | { id: string; role: "bot"; kind: "thinking"; runKey: string }
  | { id: string; role: "bot"; kind: "compare"; reports: ShellReport[] }
  | { id: string; role: "bot"; kind: "regulations"; findings: Finding[] }
  | { id: string; role: "bot"; kind: "layout"; blocks: Block[] };

type Fitout = Proposal & { ops: FitoutOp[] };
type Design =
  | { kind: "layout"; blocks: Block[]; applied: number; rejected: unknown[] }
  | { kind: "fitout"; shellId: string; ops: FitoutOp[]; report: ShellReport; diff: FitoutDiff; rejected: unknown[] };
const COMMANDS = { search: /^search with this$/i, undo: /^undo( (that|it|the last change))?$/i, keep: /^keep( these changes| it)?$/i, studio: /^open (the layout|in layout studio)$/i };

type Saved = Record<string, { report: ShellReport; spec: RequirementSpec; savedAt: string }>;
type DesignPreview = { kind: "layout"; blocks: Block[] } | { kind: "upload"; name: string; url?: string };
type StoredRow = { role: "user" | "bot"; kind: string; payload: { text?: string; paragraphs?: string[]; quick?: string[]; card?: Card; fallback?: string; reports?: ShellReport[]; findings?: Finding[]; kind?: string; blocks?: Block[]; summary?: string; name?: string; design?: Design } };
type ConvResponse = { id: string; owner: boolean; state: ChatState; messages: StoredRow[]; run: { spec: RequirementSpec; events: TraceEvent[] } | null };
type ChatResponse = { conversationId: string; turn: Turn; design?: Design };

// A chat layout edit is stored on its bot reply; replay it as the reply plus the edited layout.
function fromStored(r: StoredRow): Msg[] {
  const m = fromStoredOne(r);
  const d = r.payload.design;
  return [...(m ? [m] : []), ...(d?.kind === "layout" && d.applied ? [{ id: uid(), role: "bot" as const, kind: "layout" as const, blocks: d.blocks }] : [])];
}
const lastLayout = (rows: StoredRow[]) =>
  rows.map((r) => (r.payload.design?.kind === "layout" && r.payload.design.applied ? r.payload.design.blocks : r.role === "user" && r.kind === "design" && r.payload.kind === "layout" ? r.payload.blocks : null)).filter(Boolean).at(-1) ?? null;

function fromStoredOne(r: StoredRow): Msg | null {
  if (r.role === "user" && r.kind === "design") return r.payload.kind === "layout"
    ? { id: uid(), role: "user", text: r.payload.summary ?? "Here's my layout.", design: { kind: "layout", blocks: r.payload.blocks ?? [] } }
    : { id: uid(), role: "user", text: `Uploaded ${r.payload.name ?? "a floor plan"}`, design: { kind: "upload", name: r.payload.name ?? "floor plan" } };
  if (r.role === "user") return { id: uid(), role: "user", text: r.payload.text ?? "" };
  if (r.kind === "text") return { id: uid(), role: "bot", kind: "text", paragraphs: r.payload.paragraphs ?? [], quick: r.payload.quick?.length ? r.payload.quick : undefined, card: r.payload.card, fallback: !!r.payload.fallback };
  if (r.kind === "compare" && r.payload.reports) return { id: uid(), role: "bot", kind: "compare", reports: r.payload.reports };
  if (r.kind === "regulations" && r.payload.findings) return { id: uid(), role: "bot", kind: "regulations", findings: r.payload.findings };
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
  // ?c= keeps a conversation linkable (shared, read-only for others), but a browser refresh always starts a fresh chat.
  const reloaded = typeof window !== "undefined" && (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "reload";
  const conv = useRef<string | null>(reloaded ? null : params.get("c"));
  // Resolves once the conversation exists, so a message typed during the greeting is not sent without an id.
  const opening = useRef<Promise<void> | null>(null);
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
  const [viewing, setViewing] = useState<ShellReport | null>(null);
  const [saved, setSaved] = useState<Saved>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [runKey, setRunKey] = useState("");
  const [resultsReady, setResultsReady] = useState(false);
  const [owner, setOwner] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawing, setDrawing] = useState(params.get("design") === "draw");
  // Design edits: the drawn layout chat edits apply to, its undo history, and proposed changes per scanned space.
  const [layout, setLayout] = useState<Block[] | null>(null);
  const [layoutId, setLayoutId] = useState<string | null>(null);
  const [layoutPast, setLayoutPast] = useState<Block[][]>([]);
  const [fitouts, setFitouts] = useState<Record<string, Fitout[]>>({});
  const [lastEdit, setLastEdit] = useState<"layout" | "fitout" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Chat edits write back to the open layout (and its saved copy), so the drawing sheet and the next search see them.
  const storeLayout = useCallback((blocks: Block[]) => {
    save(KEYS.layout, blocks);
    const saved = layoutId ? loadLayouts().find((l) => l.id === layoutId) : undefined;
    if (saved) putLayout({ ...saved, items: blocks });
  }, [layoutId]);
  const fileInput = useRef<HTMLInputElement>(null);
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

  const respond = useCallback(async (turn: Turn, d?: Design) => {
    setChat(turn.state);
    if (d?.kind === "layout") {
      if (d.applied) {
        if (layout) setLayoutPast((p) => [...p.slice(-49), layout]);
        setLayout(d.blocks);
        storeLayout(d.blocks);
        setLastEdit("layout");
      }
      const stale = d.applied && reports.length ? ["These results are from before this change. Tap \u201cSearch with this\u201d to update them."] : [];
      push(bot([turn.reply, ...stale], turn.quickReplies), ...(d.applied ? [{ id: uid(), role: "bot" as const, kind: "layout" as const, blocks: d.blocks }] : []));
      return;
    }
    if (d?.kind === "fitout") {
      setFitouts((all) => {
        const stack = all[d.shellId] ?? [];
        const last = stack.at(-1);
        if (last && JSON.stringify(last.ops) === JSON.stringify(d.ops)) return all;
        return { ...all, [d.shellId]: [...stack, { ops: d.ops, report: d.report, diff: d.diff, kept: false }] };
      });
      setLastEdit("fitout");
      setTab("fit"); setEvidenceOpen(true);
      push(bot([turn.reply], turn.quickReplies));
      return;
    }
    push({ ...bot([turn.reply], turn.quickReplies.length ? turn.quickReplies : undefined, turn.card), fallback: !!turn.fallback } as Msg);
    if (turn.action === "compare" && reports.length) {
      push({ id: uid(), role: "bot", kind: "compare", reports });
      void persist({ messages: [{ role: "bot", kind: "compare", payload: { reports } }] });
    }
    if (turn.action === "email" && reports.length) setEmailFor(reports[selected] ?? reports[0]);
    if (turn.action === "regulations" && turn.state.spec.city && turn.state.spec.useType) {
      const qs = new URLSearchParams({ city: turn.state.spec.city, useType: turn.state.spec.useType });
      const r = await fetch(`/api/regulations?${qs}`).then((x) => (x.ok ? x.json() : { findings: [] })).catch(() => ({ findings: [] }));
      push({ id: uid(), role: "bot", kind: "regulations", findings: r.findings });
      void persist({ messages: [{ role: "bot", kind: "regulations", payload: { findings: r.findings } }] });
    }
    if (turn.ready && turn.state.spec.city && turn.state.spec.useType) await runSearch(turn.state.spec as RequirementSpec);
  }, [reports, selected, runSearch, layout, storeLayout]);

  const undo = (kind = lastEdit) => {
    const id = reports[selected]?.shellId;
    if (kind === "fitout" && id && fitouts[id]?.length) {
      setFitouts((all) => ({ ...all, [id]: all[id].slice(0, -1) }));
      push(bot([fitouts[id].length > 1 ? "Undone. Back to the previous proposal." : "Undone. This is the space as measured."]));
      return;
    }
    const prev = layoutPast.at(-1);
    if (!prev) return push(bot(["There's nothing to undo."]));
    setLayoutPast((p) => p.slice(0, -1));
    setLayout(prev);
    storeLayout(prev);
    push(bot(["Undone. Here's your layout again."]), { id: uid(), role: "bot", kind: "layout", blocks: prev });
  };
  const keep = () => {
    const id = reports[selected]?.shellId;
    const last = id ? fitouts[id]?.at(-1) : undefined;
    if (!id || !last) return push(bot(["There's no proposed change to keep yet."]));
    setFitouts((all) => ({ ...all, [id]: [...all[id].slice(0, -1), { ...last, kept: true }] }));
    push(bot(["Kept. The open questions from these changes are now in the email draft for this space."]));
  };

  const openNew = useCallback((draft: Draft, userText?: string) => (opening.current = (async () => {
    try {
      const r = await postJSON<ChatResponse>("/api/chat", { open: true, spec: draft, ...(userText ? { userText } : {}) });
      conv.current = r.conversationId;
      router.replace(`${window.location.pathname}?c=${r.conversationId}`, { scroll: false });
      await respond(r.turn);
    } catch {
      push(bot(["I couldn't reach the Hermit server. Check that it's running and try again."]));
    }
  })()), [respond, router]);

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
    if (conv.current) {
      fetch(`/api/conversations/${conv.current}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((c: ConvResponse) => {
        setMessages(c.messages.flatMap(fromStored));
        setLayout(lastLayout(c.messages));
        setChat(c.state);
        setOwner(c.owner);
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
    void openNew(EMPTY_DRAFT);
  }, [replay, openNew, runSearch]);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" }); }, [messages, shown]);

  const sendDesign = async (body: FormData | { blocks: Block[] }, preview: DesignPreview, text: string) => {
    if (!conv.current && opening.current) await opening.current;
    if (!conv.current || busy || running) return;
    if (body instanceof FormData) body.set("conversationId", conv.current);
    push({ id: uid(), role: "user", text, design: preview });
    setBusy(true);
    try {
      const res = await fetch("/api/design", body instanceof FormData
        ? { method: "POST", body }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conv.current, ...body }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
      await respond(((await res.json()) as ChatResponse).turn);
    } catch (e) {
      push(bot([`${e instanceof Error ? e.message : String(e)}`], ["Draw a layout"]));
    } finally {
      setBusy(false);
    }
  };

  const applyDrawing = (blocks: Block[]) => {
    setDrawing(false);
    if (layout) setLayoutPast((p) => [...p.slice(-49), layout]);
    setLayout(blocks);
    setLayoutId(load<string>(KEYS.layoutOpen));
    void sendDesign({ blocks }, { kind: "layout", blocks }, layoutSummary(blocks));
  };

  const upload = (file: File) => {
    const bad = validateUpload(file.size, file.type);
    if (bad) { push(bot([bad.error], ["Draw a layout"])); return; }
    const fd = new FormData();
    fd.append("conversationId", conv.current ?? "");
    fd.append("file", file);
    void sendDesign(fd, { kind: "upload", name: file.name, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined }, `Uploaded ${file.name}`);
  };

  const send = async (text: string) => {
    if (/^draw a layout$/i.test(text.trim()) || COMMANDS.studio.test(text.trim())) { setDrawing(true); return; }
    const t = text.trim();
    if (!t || busy || running) return;
    setInput("");
    push({ id: uid(), role: "user", text: t });
    const refocus = () => inputRef.current?.focus({ preventScroll: true });
    if (COMMANDS.undo.test(t)) return void (undo(), refocus());
    if (COMMANDS.keep.test(t)) return void (keep(), refocus());
    if (COMMANDS.search.test(t)) {
      refocus();
      const s = chat.spec;
      if (s.city && s.useType) return void runSearch(s as RequirementSpec);
      return void push(bot(["Which city should I search: Houston or Los Angeles?"], ["Houston", "Los Angeles"]));
    }
    setBusy(true);
    const current = reports[selected];
    const fitout = chat.phase === "results" && current ? { shellId: current.shellId, ops: fitouts[current.shellId]?.at(-1)?.ops ?? [] } : null;
    try {
      if (!conv.current && opening.current) await opening.current;
      const r = await postJSON<ChatResponse>("/api/chat", { conversationId: conv.current, text: t, layout, fitout });
      await respond(r.turn, r.design);
    } catch {
      push(bot(["Something went wrong talking to the server. Try that again?"]));
    } finally {
      setBusy(false);
      refocus();
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
          {showResults && <div className="tabs-pill" role="group" aria-label="Evidence for the selected space">
            {([["inside", "Interior & tour", Sofa, "photos and the 3D walkthrough"], ["above", "Aerial view", Layers, "satellite view of the building and lot"], ["fit", "Floor plan", SlidersHorizontal, "floor plan with your rooms placed in it"]] as const).map(([k, label, Icon, what]) => (
              <button key={k} type="button" data-active={tab === k && evidenceOpen} aria-expanded={tab === k && evidenceOpen} aria-controls="evidence-panel"
                onClick={() => { if (tab === k && evidenceOpen) setEvidenceOpen(false); else { setTab(k); setEvidenceOpen(true); } }}
                title={`Show the ${what} for the selected space`}>
                <Icon aria-hidden="true" /> {label}
              </button>
            ))}
          </div>}

          {showResults && current && evidenceOpen && (
            <div className="evidence" id="evidence-panel" role="region" aria-label={`${tab} view of ${current.name.split(" · ")[0]}`}>
              {tab === "fit" ? (
                <div className="fit"><FitView report={current} proposal={fitouts[current.shellId]?.at(-1)} onKeep={() => keep()} onUndo={() => undo("fitout")} /></div>
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
                <span>{tab === "inside" ? "Matterport scan" : tab === "above" ? "Vexcel aerial imagery" : "Your rooms mapped onto the measured floor plan"} · {current.name.split(" · ")[0]}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  {tab === "inside" && current.inside && tour !== current.inside.sid && <button type="button" className="btn small" onClick={() => setTour(current.inside!.sid)}>Open 3D tour</button>}
                  <button type="button" className="btn small" onClick={() => setViewing(current)}>View property</button>
                  <button type="button" className="btn small" onClick={() => setEvidenceOpen(false)} aria-label="Hide evidence"><X aria-hidden="true" /></button>
                </span>
              </div>
            </div>
          )}

          <div className="messages" ref={scroller} aria-live="polite" aria-label="Conversation">
            {messages.map((m) => {
              if (m.role === "user") return (
                <div key={m.id} className="msg user"><span className="avatar user" aria-hidden="true"><User /></span><div className="bubbles"><div className="bubble">{m.text}
                  {m.design?.kind === "layout" && <DesignThumb blocks={m.design.blocks} />}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {m.design?.kind === "upload" && m.design.url && <img className="design-img" src={m.design.url} alt={`Uploaded floor plan ${m.design.name}`} />}
                </div></div></div>
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
                        {m.fallback && <p className="muted" style={{ fontSize: 13 }}>Answered without Claude (it was unavailable).</p>}
                        {m.card && m === lastQuick && !running && owner && <MultiCard card={m.card} onSubmit={send} />}
                        {m.quick && m === lastQuick && !running && owner && (
                          <div className="quick" role="group" aria-label="Suggested replies">{m.quick.map((q) => <button key={q} type="button" onClick={() => send(q)}>{q}</button>)}</div>
                        )}
                      </>
                    )}
                    {m.kind === "thinking" && <Thinking steps={m.runKey === runKey ? steps.slice(0, shown) : steps} total={steps.length} done={m.runKey !== runKey || finished} />}
                    {m.kind === "compare" && <Compare reports={m.reports} />}
                    {m.kind === "regulations" && <div className="bubble"><RegulationList findings={m.findings} /></div>}
                    {m.kind === "layout" && <div className="bubble"><LayoutPreview blocks={m.blocks} /></div>}
                  </div>
                </div>
              );
            })}
            {busy && <div className="msg bot"><span className="avatar bot" aria-hidden="true">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/hermit-logo.svg" alt="" /></span><div className="bubble"><span className="dots" aria-label="Hermit is typing"><span /><span /><span /></span></div></div>}
          </div>

          {!owner && (
            <div className="readonly-banner" role="status">
              <span>You&apos;re viewing someone else&apos;s search.</span>
              <button type="button" className="btn primary" onClick={() => { setOwner(true); setMessages([]); setRunKey(""); void openNew({ ...chat.spec, input: "chat" }); }}>Start my own search from this</button>
            </div>
          )}
          {owner && <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <div className="attach">
              <button type="button" className="icon-btn" aria-label="Add a design" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}
                onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}><Plus aria-hidden="true" /></button>
              {menuOpen && (
                <div className="attach-menu" role="menu" onKeyDown={(e) => { if (e.key === "Escape") setMenuOpen(false); }}>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDrawing(true); }}><PencilRuler aria-hidden="true" /> Draw a layout</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); fileInput.current?.click(); }}><ImageUp aria-hidden="true" /> Upload a floor plan</button>
                </div>
              )}
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" tabIndex={-1} aria-label="Floor plan file"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
            </div>
            <Sparkles className="spark" aria-hidden="true" />
            <label htmlFor="ask" className="sr-only">Message Hermit</label>
            <input id="ask" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Tell Hermit what you're looking for..." autoComplete="off" maxLength={2000} />
            <button className="send" type="submit" disabled={!input.trim() || busy || running} aria-label="Send"><Send aria-hidden="true" /></button>
          </form>}
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
                onEmail={() => setEmailFor(r)} onDetails={() => setDetailsFor(r)} onSave={() => toggleSave(r)} onView={() => setViewing(r)} />
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

      {viewing && <PropertyViewer report={viewing} onClose={() => setViewing(null)} />}
      {drawing && <DesignSheet onDone={applyDrawing} onClose={() => setDrawing(false)} />}
      {emailFor && <EmailDraft report={fitouts[emailFor.shellId]?.at(-1)?.kept ? fitouts[emailFor.shellId].at(-1)!.report : emailFor} onClose={() => setEmailFor(null)} />}
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
      <div className="multi-options">
        {card.options.map((o) => {
          const on = picked.includes(o.label);
          return <button key={o.value} type="button" className="chip-toggle" aria-pressed={on} onClick={() => toggle(o.label)}>{on ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}{o.label}</button>;
        })}
      </div>
      <div className="multi-foot">
        <span className="muted" aria-live="polite">{picked.length ? `${picked.length} selected` : "Tap all that apply"}</span>
        <button type="button" className="btn primary" disabled={!picked.length} onClick={() => onSubmit(picked.join(", "))}>Done</button>
      </div>
    </div>
  );
}
