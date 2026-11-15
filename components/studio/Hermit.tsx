"use client";
import { Box, ImageUp, PencilRuler, RotateCcw, Sparkles, SquareDashed } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KEYS, load, save } from "@/lib/client/store";
import type { IState, ITurn } from "@/lib/interview/turn";
import { roomOf, type Furn } from "@/lib/spec/furnish";
import { adjacency, toLayout, type SketchRoom } from "@/lib/spec/sketch";
import { blocksToSketch, roomsFromBlocks, sketchToBlocks } from "@/lib/spec/blocks";
import type { Block } from "@/lib/spec/parse";
import { searchCounts, summarizeResults, thinkingSteps } from "@/lib/chat/present";
import { localCommand, type LocalCommand } from "@/lib/chat/commands";
import type { ChatState, Turn } from "@/lib/chat/converse";
import { validateUpload } from "@/lib/design/extract";
import type { FitoutDiff, FitoutOp } from "@/lib/design/fitout";
import type { Finding } from "@/lib/regs/research";
import { ROOM_TYPES } from "@/lib/design/rooms";
import type { Draft } from "@/lib/spec/survey";
import { packFor, seedRooms } from "@/lib/uses/packs";
import type { FunnelStage, RequirementSpec, RoomReq, ShellReport, TraceEvent } from "@/lib/types";
import { Counter, type Extra } from "./Counter";
import { CrewTrace } from "./CrewTrace";
import { Interview, type ChatMsg } from "./Interview";
import { ShellReportView } from "./ShellReportView";
import { DesignSheet } from "../DesignSheet";
import { LayoutPreview } from "../LayoutPreview";
import { Plan3D, rectPoly } from "../Plan3D";
import { Thinking } from "../Thinking";
import { MatchingSpaces } from "./MatchingSpaces";
import { Compare } from "../Compare";
import { EmailDraft } from "../EmailDraft";
import { FitView, type Proposal } from "../FitView";
import { isBuying, ParcelInfo } from "../ParcelInfo";
import { RegulationList } from "../Regulations";

const uid = () => Math.random().toString(36).slice(2, 10);
const EMPTY: Draft = { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" };
type Persist = { iv: IState; messages: ChatMsg[]; layout: SketchRoom[]; furniture: Furn[]; extras?: Block[]; ready: boolean; basics: boolean; reports: ShellReport[]; events: TraceEvent[]; runId: string | null; conv?: string | null };
type Fitout = Proposal & { ops: FitoutOp[] };
// What /api/chat returns when a follow-up edits the drawn layout or proposes changes to a scanned space.
type Design =
  | { kind: "layout"; blocks: Block[]; applied: number; rejected: unknown[] }
  | { kind: "fitout"; shellId: string; ops: FitoutOp[]; report: ShellReport; diff: FitoutDiff; rejected: unknown[] };
const FILL = Object.fromEntries(ROOM_TYPES.map((r) => [r.type, r.fill]));
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

export function Hermit() {
  const params = useSearchParams();
  const replay = params.get("replay");
  const firstQ = params.get("q");
  const router = useRouter();
  const [iv, setIv] = useState<IState>({ spec: EMPTY, asked: [], history: [] });
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [layout, setLayout] = useState<SketchRoom[]>([]);
  const [furniture, setFurniture] = useState<Furn[]>([]);
  const [extras, setExtras] = useState<Block[]>([]); // doors, windows: Layout Studio objects that aren't furniture
  const [drawing, setDrawing] = useState(params.get("design") === "draw");
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [shown, setShown] = useState(0);
  const [ready, setReady] = useState(false);
  const [basics, setBasics] = useState(false);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [reports, setReports] = useState<ShellReport[]>([]);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [open, setOpen] = useState<ShellReport | null>(null);
  const started = useRef(false);
  // Follow-ups after results run through the chat brain (/api/chat), which needs a server-side conversation.
  const conv = useRef<string | null>(null);
  const announced = useRef<string | null>(null);
  const past = useRef<Block[][]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(0);
  const [fitouts, setFitouts] = useState<Record<string, Fitout[]>>({});
  const [lastEdit, setLastEdit] = useState<"layout" | "fitout" | null>(null);
  const [emailFor, setEmailFor] = useState<ShellReport | null>(null);
  const [parcelFor, setParcelFor] = useState<ShellReport | null>(null);
  const say = (text: string, more: Partial<ChatMsg> = {}) => setMessages((m) => [...m, { id: uid(), role: "hermit", text, ...more }]);

  const spec = iv.spec;
  const pack = useMemo(() => packFor({ useType: spec.useType || "office", mode: spec.mode }), [spec.useType, spec.mode]);
  const sketchRooms: RoomReq[] = useMemo(() => (spec.useType ? seedRooms(spec) : []), [spec]);
  useEffect(() => { setLayout((prev) => toLayout(sketchRooms, pack, prev)); }, [sketchRooms, pack]);

  const recount = useCallback(async (s: Draft) => {
    if (!s.city) return;
    try { setStages((await post<{ stages: FunnelStage[] }>("/api/count", s)).stages); } catch { /* the counter is advisory */ }
  }, []);

  const ask = useCallback(async (state: IState, text: string | null) => {
    setBusy(true);
    try {
      const t = await post<ITurn>("/api/interview", { state, text });
      setIv(t.state); setStages(t.state.spec.city ? t.stages : []); setReady(t.ready); setBasics(t.basicsDone);
      setMessages((m) => [...m, { id: uid(), role: "hermit", text: t.reply, why: t.why, quick: t.quick, multi: t.multi, cta: t.ready }]);
    } catch {
      setMessages((m) => [...m, { id: uid(), role: "hermit", text: "I couldn't reach the Hermit server. Check that it's running and try again." }]);
    } finally { setBusy(false); }
  }, []);

  const runSearch = useCallback(async (s: RequirementSpec, replayId?: string) => {
    setEvents([]); setReports([]); setRunning(true); setOpen(null); setShown(0); setSelected(0);
    try {
      const res = replayId ? await fetch(`/api/agent?replay=${encodeURIComponent(replayId)}`) : await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
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
          if (e.type === "run") { setRunId(e.runId); if (e.spec) { setIv((x) => ({ ...x, spec: e.spec as Draft })); setBasics(true); } continue; }
          setEvents((x) => [...x, e]);
          if (e.type === "funnel") setStages(e.stages);
          if (e.type === "report") setReports(e.reports);
        }
      }
    } catch (err) {
      setMessages((m) => [...m, { id: uid(), role: "hermit", text: err instanceof Error ? err.message : String(err) }]);
    } finally { setRunning(false); }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (replay) {
      setMessages([{ id: uid(), role: "hermit", text: "This is a recorded run. It replays the crew's exact steps without calling any outside service." }]);
      void runSearch({ ...EMPTY, city: "houston", useType: "space" } as RequirementSpec, replay);
      return;
    }
    if (firstQ) {
      // Started from the hero: a fresh search, and the typed request is the first answer.
      save(KEYS.chat, null);
      setMessages([{ id: uid(), role: "user", text: firstQ }]);
      void ask({ spec: EMPTY, asked: [], history: [{ role: "hermit", text: "What are you opening, or looking for?" }] }, firstQ);
      router.replace("/studio");
      return;
    }
    const p = load<Persist>(KEYS.chat);
    if (p?.iv?.spec && p.messages?.length) {
      setIv(p.iv); setMessages(p.messages); setLayout(p.layout ?? []); setFurniture(p.furniture ?? []); setExtras(p.extras ?? []); setReady(p.ready); setBasics(p.basics); setReports(p.reports); setEvents(p.events); setRunId(p.runId);
      conv.current = p.conv ?? null; announced.current = p.runId;
      void recount(p.iv.spec);
      return;
    }
    void ask({ spec: EMPTY, asked: [], history: [] }, null);
  }, [replay, runSearch, recount, ask, firstQ, router]);

  useEffect(() => {
    if (!started.current || replay || !messages.length) return;
    save(KEYS.chat, { iv, messages, layout, furniture, extras, ready, basics, reports, events, runId, conv: conv.current } satisfies Persist);
  }, [iv, messages, layout, furniture, extras, ready, basics, reports, events, runId, replay]);

  const finalSpec = (s: Draft): RequirementSpec => {
    const adj = adjacency(layout);
    const rooms = seedRooms(s).map((r) => (adj[r.label] ? { ...r, adjacentTo: adj[r.label] } : r));
    // A layout drawn in Layout Studio also goes to match_layout, which ranks scans by floor-plan similarity.
    const drawn = s.input === "layout" && layout.length ? { layout: layout.map(({ label, x, y, w, h }) => ({ label, x, y, w, h })) } : {};
    return { ...s, city: s.city ?? "houston", useType: s.useType || "office", rooms, ...drawn };
  };

  const search = () => {
    setReady(false);
    setMessages((m) => [...m.map((x) => ({ ...x, cta: false })), { id: uid(), role: "hermit", text: "Sending in the crew! They'll scuttle through every shell, crawl inside the best ones, and tell you exactly what's left to do." }]);
    void runSearch(finalSpec(spec));
  };

  const send = (text: string) => {
    const cmd = localCommand(text);
    if (cmd === "studio") { setDrawing(true); return; }
    setMessages((m) => [...m.map((x) => ({ ...x, quick: undefined, cta: false })), { id: uid(), role: "user", text }]);
    if (cmd === "search") { search(); return; }
    if (reports.length && !running) { void followUp(text, cmd); return; }
    void ask(iv, text);
  };

  // Opens (or re-syncs) the chat conversation with the studio's current spec, so the chat brain sees edits made here.
  const syncConv = async (s: Draft, phase: ChatState["phase"]) => {
    for (let i = 0; i < 2; i++) {
      conv.current ??= (await post<{ conversationId: string }>("/api/chat", { open: true, spec: s })).conversationId;
      const r = await fetch(`/api/conversations/${conv.current}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: { spec: s, asked: [], phase }, ...(runId ? { lastRunId: runId } : {}) }) });
      if (r.ok) return conv.current;
      conv.current = null; // stale id (database reset or another browser); open a fresh one
    }
    throw new Error("conversation unavailable");
  };

  const followUp = async (text: string, cmd: LocalCommand | null) => {
    const sel = reports[selected];
    if (cmd === "undo") return undo();
    if (cmd === "keep") return keep();
    if (cmd === "parcel" && sel) {
      if (!isBuying(runSpec, sel)) return say("Parcel records show when you're buying, and this space is a lease. You can ask the landlord about the lot, taxes or APN in your inquiry.");
      setParcelFor(sel);
      return say(`Here are the parcel records for ${sel.name.split(" · ")[0]}. Anything missing is marked "Not on record".`);
    }
    setBusy(true);
    try {
      const id = await syncConv(runSpec as Draft, "results");
      const r = await post<{ turn: Turn; design?: Design }>("/api/chat", {
        // The API takes [A-Za-z0-9_-] ids; sketch keys ("exam room#0") are rebuilt from labels on the way back.
        conversationId: id, text, layout: blocks.length ? blocks.map((b) => ({ ...b, id: b.id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) })) : null,
        fitout: sel ? { shellId: sel.shellId, ops: fitouts[sel.shellId]?.at(-1)?.ops ?? [] } : null,
      });
      await respond(r.turn, r.design);
    } catch {
      say("Something went wrong talking to the server. Try that again?");
    } finally { setBusy(false); }
  };

  const respond = async (turn: Turn, d?: Design) => {
    if (d?.kind === "layout") {
      if (d.applied) { past.current = [...past.current.slice(-49), blocks]; setLastEdit("layout"); applyBlocks(d.blocks, false); }
      const stale = d.applied ? " These results are from before this change. Tap “Search with this” to update them." : "";
      return say(turn.reply + stale, { quick: turn.quickReplies, ...(d.applied ? { blocks: d.blocks } : {}) });
    }
    if (d?.kind === "fitout") {
      setFitouts((all) => {
        const stack = all[d.shellId] ?? [];
        if (JSON.stringify(stack.at(-1)?.ops) === JSON.stringify(d.ops)) return all;
        return { ...all, [d.shellId]: [...stack, { ops: d.ops, report: d.report, diff: d.diff, kept: false }] };
      });
      setLastEdit("fitout");
      return say(turn.reply, { quick: turn.quickReplies, fitout: d.shellId });
    }
    const quick = turn.quickReplies.length ? turn.quickReplies : undefined;
    if (turn.action === "regulations" && turn.state.spec.city && turn.state.spec.useType) {
      const qs = new URLSearchParams({ city: turn.state.spec.city, useType: turn.state.spec.useType });
      const r: { findings: Finding[] } = await fetch(`/api/regulations?${qs}`).then((x) => (x.ok ? x.json() : { findings: [] })).catch(() => ({ findings: [] }));
      return say(turn.reply, { quick, findings: r.findings });
    }
    say(turn.reply, { quick, ...(turn.action === "compare" ? { compare: reports } : {}) });
    const sel = reports[selected];
    if (turn.action === "email" && sel) setEmailFor(sel);
    if (turn.ready) { setIv((x) => ({ ...x, spec: turn.state.spec })); void runSearch(finalSpec(turn.state.spec)); }
  };

  const undo = (kind = lastEdit) => {
    const id = reports[selected]?.shellId;
    if (kind === "fitout" && id && fitouts[id]?.length) {
      say(fitouts[id].length > 1 ? "Undone. Back to the previous proposal." : "Undone. This is the space as measured.");
      return setFitouts((all) => ({ ...all, [id]: all[id].slice(0, -1) }));
    }
    const prev = past.current.at(-1);
    if (!prev) return say("There's nothing to undo.");
    past.current = past.current.slice(0, -1);
    applyBlocks(prev, false);
    say("Undone. Here's your layout again.", { blocks: prev });
  };

  const keep = () => {
    const id = reports[selected]?.shellId;
    const last = id ? fitouts[id]?.at(-1) : undefined;
    if (!id || !last) return say("There's no proposed change to keep yet.");
    setFitouts((all) => ({ ...all, [id]: [...all[id].slice(0, -1), { ...last, kept: true }] }));
    const asks = last.report.unknowns.some((u) => u.topic === "proposed change" && last.report.draftMessage.includes(u.question));
    say(asks ? "Kept. The open questions from these changes are now in the inquiry draft for this space." : "Kept. These changes raise no new questions for the landlord, so the inquiry draft is unchanged.");
  };

  const upload = async (file: File) => {
    const bad = validateUpload(file.size, file.type);
    if (bad) return say(bad.error, { quick: ["Draw a layout"] });
    setMessages((m) => [...m, { id: uid(), role: "user", text: `Uploaded ${file.name}` }]);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("conversationId", await syncConv((reports.length ? runSpec : spec) as Draft, reports.length ? "results" : "gathering"));
      fd.append("file", file);
      const res = await fetch("/api/design", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
      const { turn } = (await res.json()) as { turn: Turn };
      setIv((x) => ({ ...x, spec: turn.state.spec }));
      if (turn.state.spec.useType) setBasics(true);
      if (turn.ready && !reports.length) setReady(true);
      say(turn.reply, { quick: turn.quickReplies });
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), { quick: ["Draw a layout"] });
    } finally { setBusy(false); }
  };

  const onRooms = (rooms: RoomReq[], note: string) => {
    const next = { ...iv, spec: { ...spec, rooms, input: "layout" as const } };
    setIv(next);
    void recount(next.spec);
    setMessages((m) => (m.at(-1)?.agent === "sketch" ? [...m.slice(0, -1), { ...m.at(-1)!, text: `Sketch updated: ${note}.` }] : [...m, { id: uid(), role: "hermit", agent: "sketch", text: `Sketch updated: ${note}.` }]));
  };

  // "Use this layout" from Layout Studio: the drawing becomes the sketch (rooms pinned where drawn) and the room requirements.
  const applyBlocks = (blocks: Block[], note = true) => {
    setDrawing(false);
    const next = blocksToSketch(blocks);
    const roomBlocks = blocks.filter((b) => b.kind !== "object");
    const home = roomBlocks.some((b) => ["bedroom", "living room", "laundry", "garage"].includes(b.label));
    const base = spec.useType ? spec : { ...spec, mode: home ? "home" as const : spec.mode, useType: home ? "home" : roomBlocks.some((b) => b.label === "exam room") ? "medical clinic" : "office" };
    setLayout(next.layout); setFurniture(next.furniture); setExtras(next.extras);
    const area = Math.round(roomBlocks.reduce((t, b) => t + b.w * b.h, 0));
    const rooms = roomsFromBlocks(blocks, base.useType ? seedRooms(base) : []);
    const ivNext = { ...iv, spec: { ...base, rooms, input: "layout" as const } };
    setIv(ivNext);
    if (!basics && base.useType) setBasics(true);
    void recount(ivNext.spec);
    if (note) setMessages((m) => [...m, { id: uid(), role: "hermit", agent: "sketch", text: `Layout updated: ${roomBlocks.length} rooms, about ${area.toLocaleString()} sq ft. I'll match it against real floor plans.` }]);
  };

  const reset = () => { conv.current = null; announced.current = null; past.current = []; setFitouts({}); setSelected(0); save(KEYS.chat, null); setIv({ spec: EMPTY, asked: [], history: [] }); setMessages([]); setStages([]); setReports([]); setEvents([]); setReady(false); setBasics(false); setLayout([]); setFurniture([]); setExtras([]); setShown(0); started.current = true; void ask({ spec: EMPTY, asked: [], history: [] }, null); };

  // Furniture by room label, so the tour guide can say "your desk goes here".
  const furnitureByRoom = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of furniture) { const r = roomOf(f, layout); if (r) (out[r.label] ??= []).push(f.type); }
    return out;
  }, [furniture, layout]);

  const extra: Extra[] = useMemo(() => {
    if (!events.length) return [];
    const walked = events.filter((e) => e.type === "verdict" && e.verdict.agent === "inspector").length;
    const vetoes = events.filter((e) => e.type === "veto") as Extract<TraceEvent, { type: "veto" }>[];
    const drops = (events.filter((e) => e.type === "drop") as Extract<TraceEvent, { type: "drop" }>[]).filter((d) => !vetoes.some((v) => v.shellId === d.shellId));
    const out: Extra[] = [];
    if (walked) out.push({ key: "walked", label: "explored inside", count: walked });
    // Only scans the Inspector walked count against "walked"; record-screen drops happen before anyone goes inside.
    const walkedIds = new Set(events.flatMap((e) => (e.type === "verdict" && e.verdict.agent === "inspector" ? [e.verdict.shellId] : [])));
    const failedInside = new Set([...vetoes, ...drops].map((x) => x.shellId).filter((id) => walkedIds.has(id))).size;
    if (walked && (vetoes.length || drops.length)) out.push({ key: "veto", label: "passed every crab's check", count: Math.max(0, walked - failedInside), tone: "veto",
      removed: [...vetoes.map((v) => ({ id: v.shellId, name: v.name, reason: v.reason })), ...drops.map((d) => ({ id: d.shellId, name: d.shellId, reason: d.reason }))] });
    if (reports.length) out.push({ key: "reports", label: "shells picked for you", count: reports.length });
    return out;
  }, [events, reports]);

  const runSpec = useMemo(() => ({ ...spec, city: spec.city ?? "houston", useType: spec.useType || "office" }) as RequirementSpec, [spec]);
  const steps = useMemo(() => thinkingSteps(events, runSpec), [events, runSpec]);
  // Reveal the crew's checks one at a time ("Here's what I checked" once done); instant with reduced motion or a restored run.
  useEffect(() => {
    if (shown >= steps.length) return;
    const t = setTimeout(() => setShown((n) => Math.min(steps.length, n + 1)), running && !reduceMotion() ? 520 : 0);
    return () => clearTimeout(t);
  }, [shown, steps.length, running]);
  const finished = !running && events.some((e) => e.type === "done") && shown >= steps.length;
  const blocks = useMemo(() => sketchToBlocks(layout, furniture, extras), [layout, furniture, extras]);
  useEffect(() => {
    if (!finished || !runId || announced.current === runId) return;
    announced.current = runId;
    const s = summarizeResults(reports, runSpec, { considered: searchCounts(events).considered, dropped: events.filter((e) => e.type === "drop").length });
    setMessages((m) => [...m, { id: uid(), role: "hermit", text: [...s.paragraphs, s.followUp].join(" "), quick: reports.length ? ["Compare the layouts", "Draft an email", "Make it bigger"] : ["Make it bigger", "Raise the budget"] }]);
  }, [finished, runId, reports, runSpec, events]);

  // Only the newest proposal message for a space shows the plan, so the chat doesn't repeat it.
  const lastFit = useMemo(() => new Map(messages.filter((m) => m.fitout).map((m) => [m.fitout!, m.id])), [messages]);
  const extraFor = (m: ChatMsg) => {
    if (m.compare?.length) return <Compare reports={m.compare} />;
    if (m.findings) return <div className="bubble"><RegulationList findings={m.findings} /></div>;
    if (m.blocks) return <div className="bubble"><LayoutPreview blocks={m.blocks} /></div>;
    const fr = m.fitout && lastFit.get(m.fitout) === m.id ? reports.find((r) => r.shellId === m.fitout) : undefined;
    // ponytail: proposals live in memory, so after a reload the plan card is gone; persist fitouts if that matters.
    if (fr) return <div className="bubble fit"><FitView report={fr} proposal={fitouts[fr.shellId]?.at(-1)} onKeep={keep} onUndo={() => undo("fitout")} /></div>;
    return null;
  };
  const emailReport = emailFor && (fitouts[emailFor.shellId]?.at(-1)?.kept ? fitouts[emailFor.shellId].at(-1)!.report : emailFor);

  const searched = running || events.length > 0;
  const showSketch = (basics && !!spec.useType) || layout.length > 0;
  const cta = ready && !searched;

  const layoutCard = (
    <div className="layout-card">
      <div className="layout-card-head">
        <h2><SquareDashed aria-hidden="true" /> Your layout</h2>
        <div className="view-switch" role="group" aria-label="Layout view">
          <button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>2D plan</button>
          <button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}><Box aria-hidden="true" /> 3D model</button>
        </div>
        <button type="button" className="btn primary small" onClick={() => setDrawing(true)}><PencilRuler aria-hidden="true" /> Build your layout</button>
      </div>
      {view === "3d" && blocks.some((b) => b.kind !== "object")
        ? <Plan3D solids={blocks.filter((b) => b.kind !== "object").map((b) => ({ id: b.id, label: b.label, polygon: rectPoly(b), height: 9, fill: FILL[b.label] ?? "#f7efe9" }))} label={`Your layout in 3D: ${layout.length} rooms`} height={340} wallScale={0.45} />
        : <LayoutPreview blocks={blocks} />}
      <p className="muted small">Drag rooms, furniture, doors and windows in Layout Studio; Hermit matches the drawing against real scanned floor plans.</p>
    </div>
  );

  return (
    <div className="studio">
      <div className="studio-top">
        <Counter stages={stages} extra={extra} useLabel={pack.label.toLowerCase()} />
        <button type="button" className="btn small" onClick={reset}><RotateCcw aria-hidden="true" /> Start over</button>
      </div>
      <div className="studio-grid">
        <Interview messages={messages} busy={busy} onSend={send} extra={extraFor}
          placeholder={reports.length ? "Compare, draft an email, or “make it 3 exam rooms”" : undefined}
          attach={<>
            <button type="button" className="icon-btn" aria-label="Upload a floor plan" title="Upload a floor plan" disabled={busy || running} onClick={() => fileInput.current?.click()}><ImageUp aria-hidden="true" /></button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" tabIndex={-1} aria-label="Floor plan file"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          </>}>
          {cta && (
            <div className="cta-row">
              <button type="button" className="cta" onClick={search}><Sparkles aria-hidden="true" /> Walk inside the matches</button>
              <span className="muted small">You can still change the sketch or tell me more first.</span>
            </div>
          )}
        </Interview>

        <div className="studio-right">
          {searched && (
            <>
              {steps.length > 0 && <div className="card pad"><Thinking steps={steps.slice(0, shown)} total={steps.length} done={finished} /></div>}
              <MatchingSpaces reports={reports} spec={runSpec} runId={runId} running={running} onOpen={setOpen} selected={selected} onSelect={setSelected} />
              <CrewTrace events={events} running={running} useLabel={pack.label.toLowerCase()} />
            </>
          )}
          {showSketch ? (
            searched
              ? <details className="card pad"><summary>Your layout</summary>{layoutCard}</details>
              : <div className="card pad">{layoutCard}</div>
          ) : !searched && (
            <div className="card sketch-placeholder">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hermit-logo.svg" alt="" />
              <p><strong>Your space will appear here.</strong> Answer a few questions and I&apos;ll sketch what you need, room by room, or <button type="button" className="linkish" onClick={() => setDrawing(true)}>build your layout</button> yourself.</p>
            </div>
          )}
        </div>
      </div>
      <p className="truth">Real data: {stages[0]?.count.toLocaleString() ?? "14,944"} Matterport scans from the CoStar hackathon index, measured with the Matterport API. Some CoStar record details aren&apos;t loaded yet and show as unknown. Aerials are Esri imagery while Vexcel access is pending. Hermit screens; it doesn&apos;t inspect, certify code status or promise availability.</p>
      {drawing && <DesignSheet initial={blocks} onDone={applyBlocks} onClose={() => setDrawing(false)} />}
      {emailReport && <EmailDraft report={emailReport} onClose={() => setEmailFor(null)} />}
      {parcelFor && <ParcelInfo report={parcelFor} onClose={() => setParcelFor(null)} />}
      {open && <ShellReportView report={open} onClose={() => setOpen(null)} packetHref={runId ? `/packet/${runId}/${open.shellId}` : undefined} furniture={furnitureByRoom} />}
    </div>
  );
}
