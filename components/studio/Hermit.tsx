"use client";
import { ImageUp, RotateCcw, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HermitNote } from "@/lib/client/session";
import { KEYS, load, save } from "@/lib/client/store";
import { isSaved, toggleSaved } from "@/lib/client/persist";
import type { IState, ITurn } from "@/lib/interview/turn";
import type { Furn } from "@/lib/spec/furnish";
import { adjacency, toLayout, type SketchRoom } from "@/lib/spec/sketch";
import { blocksToSketch, roomsFromBlocks, sketchToBlocks } from "@/lib/spec/blocks";
import type { Block } from "@/lib/spec/parse";
import { searchCounts, summarizeResults, thinkingSteps } from "@/lib/chat/present";
import { isLayoutEdit, localCommand, type LocalCommand } from "@/lib/chat/commands";
import { chatAsked, type ChatState, type Turn } from "@/lib/chat/converse";
import { validateUpload } from "@/lib/design/extract";
import type { FitoutDiff, FitoutOp } from "@/lib/design/fitout";
import type { Finding } from "@/lib/regs/research";
import type { Draft } from "@/lib/spec/survey";
import { packFor, seedRooms } from "@/lib/uses/packs";
import type { RequirementSpec, RoomReq, ShellReport, TraceEvent } from "@/lib/types";
import { Interview, type ChatMsg } from "./Interview";
import { CrewTrace } from "./CrewTrace";
import { MatchingSpaces } from "./MatchingSpaces";
import { LayoutPreview } from "../LayoutPreview";
import { LayoutStudio } from "../LayoutStudio";
import { Thinking } from "../Thinking";
import { Compare } from "../Compare";
import { EmailDraft } from "../EmailDraft";
import { FitView, type Proposal } from "../FitView";
import { isBuying, ParcelInfo } from "../ParcelInfo";
import { RegulationList } from "../Regulations";

const uid = () => Math.random().toString(36).slice(2, 10);
const EMPTY: Draft = { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" };
type Persist = { iv: IState; messages: ChatMsg[]; layout: SketchRoom[]; furniture: Furn[]; extras?: Block[]; ready: boolean; progress?: number; reports: ShellReport[]; events: TraceEvent[]; runId: string | null; conv?: string | null };
type Fitout = Proposal & { ops: FitoutOp[] };
// What /api/chat returns when a follow-up edits the drawn layout or proposes changes to a scanned space.
type Design =
  | { kind: "layout"; blocks: Block[]; applied: number; rejected: unknown[] }
  | { kind: "fitout"; shellId: string; ops: FitoutOp[]; report: ShellReport; diff: FitoutDiff; rejected: unknown[] };
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
  const [layout, setLayout] = useState<SketchRoom[]>([]);
  const [furniture, setFurniture] = useState<Furn[]>([]);
  const [extras, setExtras] = useState<Block[]>([]); // doors, windows: Layout Studio objects that aren't furniture
  // What the inline editor is seeded with. It follows the sketch only until the user edits, then changes only on outside edits.
  const [editorInit, setEditorInit] = useState<Block[]>([]);
  const touched = useRef(false);
  const pendingQ = useRef<string | null>(null);
  const fromInterview = useRef(false), pushEditor = useRef(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [reports, setReports] = useState<ShellReport[]>([]);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const started = useRef(false);
  // Follow-ups run through the chat brain (/api/chat), which needs a server-side conversation.
  const conv = useRef<string | null>(null);
  const announced = useRef<string | null>(null);
  const past = useRef<Block[][]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState(0);
  const [fitouts, setFitouts] = useState<Record<string, Fitout[]>>({});
  const [lastEdit, setLastEdit] = useState<"layout" | "fitout" | null>(null);
  const [emailFor, setEmailFor] = useState<ShellReport | null>(null);
  const [parcelFor, setParcelFor] = useState<ShellReport | null>(null);
  const say = (text: string, more: Partial<ChatMsg> = {}) => setMessages((m) => [...m, { id: uid(), role: "hermit", text, ...more }]);

  const spec = iv.spec;
  const pack = useMemo(() => packFor({ useType: spec.useType || "office", mode: spec.mode }), [spec.useType, spec.mode]);
  const sketchRooms: RoomReq[] = useMemo(() => (spec.useType ? seedRooms(spec) : []), [spec]);
  // After an editor edit, only interview answers re-lay out (toLayout keeps the user's rooms and adds/removes the delta),
  // and that result is pushed back into the editor.
  useEffect(() => {
    if (touched.current && !fromInterview.current) return;
    pushEditor.current = touched.current;
    fromInterview.current = false;
    setLayout((prev) => toLayout(sketchRooms, pack, prev));
  }, [sketchRooms, pack]);

  const ask = useCallback(async (state: IState, text: string | null): Promise<ITurn | null> => {
    setBusy(true);
    try {
      const t = await post<ITurn>("/api/interview", { state, text });
      setIv(t.state); setReady(t.ready);
      pendingQ.current = t.ready ? null : t.question ?? null;
      fromInterview.current = true;
      if (typeof t.progress === "number") setProgress(t.progress);
      setMessages((m) => [...m, { id: uid(), role: "hermit", text: t.reply, why: t.why }]);
      return t;
    } catch {
      setMessages((m) => [...m, { id: uid(), role: "hermit", text: "I couldn't reach the Hermit server. Check that it's running and try again." }]);
      return null;
    } finally { setBusy(false); }
  }, []);

  const runSearch = useCallback(async (s: RequirementSpec, replayId?: string) => {
    setEvents([]); setReports([]); setRunning(true); setViewIndex(null); setSelected(0);
    // The crew's checks render under the Hermit message that announced this search.
    setMessages((m) => { const i = m.map((x) => x.role).lastIndexOf("hermit"); return i < 0 ? m : m.map((x, j) => (j === i ? { ...x, thinking: true } : x)); });
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
          if (e.type === "run") { setRunId(e.runId); if (e.spec) setIv((x) => ({ ...x, spec: e.spec as Draft })); continue; }
          setEvents((x) => [...x, e]);
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
      setMessages([{ id: uid(), role: "hermit", text: "This is a recorded run. It replays my exact steps without calling any outside service." }]);
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
      setIv(p.iv); setMessages(p.messages); setLayout(p.layout ?? []); setFurniture(p.furniture ?? []); setExtras(p.extras ?? []); setReady(p.ready); setProgress(p.progress ?? 0); setReports(p.reports); setEvents(p.events); setRunId(p.runId);
      conv.current = p.conv ?? null; announced.current = p.runId;
      return;
    }
    void ask({ spec: EMPTY, asked: [], history: [] }, null);
  }, [replay, runSearch, ask, firstQ, router]);

  useEffect(() => {
    if (!started.current || replay || !messages.length) return;
    save(KEYS.chat, { iv, messages, layout, furniture, extras, ready, progress, reports, events, runId, conv: conv.current } satisfies Persist);
  }, [iv, messages, layout, furniture, extras, ready, progress, reports, events, runId, replay]);

  // Notes from the 3D tour (what the user asked there and what Hermit did) join this conversation.
  useEffect(() => {
    const onNote = (e: Event) => {
      const n = (e as CustomEvent<HermitNote>).detail;
      n.handled = true;
      setMessages((m) => [...m, { id: uid(), role: n.role, text: n.text, ...(n.agent && { agent: n.agent }) }]);
    };
    window.addEventListener("hermit:note", onNote);
    return () => window.removeEventListener("hermit:note", onNote);
  }, []);

  const blocks = useMemo(() => sketchToBlocks(layout, furniture, extras), [layout, furniture, extras]);
  useEffect(() => { if (!touched.current || pushEditor.current) { pushEditor.current = false; setEditorInit(blocks); } }, [blocks]);

  const finalSpec = (s: Draft): RequirementSpec => {
    const adj = adjacency(layout);
    // Once edited in the editor, search exactly the rooms the user sees there.
    const rooms = (touched.current ? roomsFromBlocks(blocks, s.rooms) : seedRooms(s)).map((r) => (adj[r.label] ? { ...r, adjacentTo: adj[r.label] } : r));
    // A drawn layout also goes to match_layout, which ranks scans by floor-plan similarity.
    const drawnLayout = s.input === "layout" && layout.length ? { layout: layout.map(({ label, x, y, w, h }) => ({ label, x, y, w, h })) } : {};
    return { ...s, city: s.city ?? "houston", useType: s.useType || "office", rooms, ...drawnLayout };
  };

  const search = (s: Draft = spec) => {
    setReady(false);
    say("Looking for spaces that fit. I'll walk inside the best ones and tell you what's left to do.");
    void runSearch(finalSpec(s));
  };

  const editLayout = () => {
    const el = editor.current;
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };

  const send = (text: string) => {
    const cmd = localCommand(text);
    if (cmd === "studio") { editLayout(); return; }
    if (cmd === "reset") { reset(); return; }
    setMessages((m) => [...m, { id: uid(), role: "user", text }]);
    if (cmd === "search") { search(); return; }
    if (running) { void ask(iv, text); return; }
    if (reports.length || (blocks.some((b) => b.kind !== "object") && isLayoutEdit(text))) { void followUp(text, cmd); return; }
    void ask(iv, text).then((t) => { if (t?.search) search(t.state.spec); });
  };

  // Opens (or re-syncs) the chat conversation with the studio's current spec, so the chat brain sees edits made here.
  const syncConv = async (s: Draft, phase: ChatState["phase"]) => {
    for (let i = 0; i < 2; i++) {
      conv.current ??= (await post<{ conversationId: string }>("/api/chat", { open: true, spec: s })).conversationId;
      const r = await fetch(`/api/conversations/${conv.current}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: { spec: s, asked: chatAsked(iv.asked), phase }, ...(runId ? { lastRunId: runId } : {}) }) });
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
      const id = await syncConv((reports.length ? runSpec : spec) as Draft, reports.length ? "results" : "gathering");
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
      if (d.applied) { past.current = [...past.current.slice(-49), blocks]; setLastEdit("layout"); applyBlocks(d.blocks); }
      const stale = d.applied && reports.length ? " These matches are from before this change. Say “search with this” to update them." : "";
      // Before results, repeat the interview's pending question so it doesn't stall (interview state stays as is).
      const pending = !reports.length && pendingQ.current ? ` ${pendingQ.current}` : "";
      // Before results the editor is open beside the chat, so the chat needn't redraw the layout.
      return say(turn.reply + stale + pending, d.applied && reports.length ? { blocks: d.blocks } : {});
    }
    if (d?.kind === "fitout") {
      setFitouts((all) => {
        const stack = all[d.shellId] ?? [];
        if (JSON.stringify(stack.at(-1)?.ops) === JSON.stringify(d.ops)) return all;
        return { ...all, [d.shellId]: [...stack, { ops: d.ops, report: d.report, diff: d.diff, kept: false }] };
      });
      setLastEdit("fitout");
      return say(turn.reply, { fitout: d.shellId });
    }
    if (turn.action === "regulations" && turn.state.spec.city && turn.state.spec.useType) {
      const qs = new URLSearchParams({ city: turn.state.spec.city, useType: turn.state.spec.useType });
      const r: { findings: Finding[] } = await fetch(`/api/regulations?${qs}`).then((x) => (x.ok ? x.json() : { findings: [] })).catch(() => ({ findings: [] }));
      return say(turn.reply, { findings: r.findings });
    }
    if (turn.action === "reset") return reset();
    // A "search now" turn can also be ready:true; run one search, on the turn's spec.
    if (turn.action === "search") { if (turn.ready) setIv((x) => ({ ...x, spec: turn.state.spec })); return search(turn.ready ? turn.state.spec : spec); }
    const idx = turn.target ? turn.target - 1 : selected;
    const target = reports[idx];
    if ((turn.action === "save" || turn.action === "report" || turn.action === "broker") && (!target || !runId)) return say("That works once your matches are loaded.");
    if (turn.action === "save" && target && isSaved(target.shellId)) return say("Already saved.");
    say(turn.reply, turn.action === "compare" ? { compare: reports } : {});
    if (turn.action === "email" && target) setEmailFor(target);
    if (turn.action === "save" && target && runId) { toggleSaved(target, runId); window.dispatchEvent(new Event("hermit:saved")); }
    if (turn.action === "view" && target) { setSelected(idx); setViewIndex(idx); }
    if (turn.action === "report" && target && runId) router.push(`/shell/${target.shellId}?run=${runId}`);
    if (turn.action === "broker" && target && runId) router.push(`/shell/${target.shellId}?run=${runId}&tab=broker`);
    if (turn.action === "edit_layout") editLayout();
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
    applyBlocks(prev);
    say("Undone. Here's your layout again.", reports.length ? { blocks: prev } : {});
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
    if (bad) return say(bad.error);
    setMessages((m) => [...m, { id: uid(), role: "user", text: `Uploaded ${file.name}` }]);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("conversationId", await syncConv((reports.length ? runSpec : spec) as Draft, reports.length ? "results" : "gathering"));
      fd.append("file", file);
      const res = await fetch("/api/design", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Upload failed (${res.status})`);
      const { turn } = (await res.json()) as { turn: Turn };
      touched.current = false;
      setIv((x) => ({ ...x, spec: turn.state.spec }));
      if (turn.ready && !reports.length) setReady(true);
      say(turn.reply);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  // A drawing (from the editor or a chat edit) becomes the sketch (rooms pinned where drawn) and the room requirements.
  const applyBlocks = (next: Block[], fromEditor = false) => {
    touched.current = fromEditor;
    const sk = blocksToSketch(next);
    const roomBlocks = next.filter((b) => b.kind !== "object");
    // Only guess the use when the rooms make it obvious; otherwise the interview still asks.
    const guess = roomBlocks.some((b) => ["bedroom", "living room", "laundry", "garage"].includes(b.label)) ? "home" : roomBlocks.some((b) => b.label === "exam room") ? "medical clinic" : "";
    const base = spec.useType || !guess ? spec : { ...spec, mode: guess === "home" ? "home" as const : spec.mode, useType: guess };
    setLayout(sk.layout); setFurniture(sk.furniture); setExtras(sk.extras);
    const rooms = roomsFromBlocks(next, base.useType ? seedRooms(base) : []);
    const draft = { ...base, rooms, input: "layout" as const };
    setIv((x) => ({ ...x, spec: draft }));
    return draft;
  };

  const reset = () => {
    conv.current = null; announced.current = null; past.current = []; started.current = true;
    setFitouts({}); setSelected(0); setViewIndex(null); save(KEYS.chat, null);
    setIv({ spec: EMPTY, asked: [], history: [] }); setMessages([]); setReports([]); setEvents([]); setRunId(null);
    setReady(false); setProgress(0); setLayout([]); setFurniture([]); setExtras([]); touched.current = false;
    void ask({ spec: EMPTY, asked: [], history: [] }, null);
  };

  const runSpec = useMemo(() => ({ ...spec, city: spec.city ?? "houston", useType: spec.useType || "office" }) as RequirementSpec, [spec]);
  const steps = useMemo(() => thinkingSteps(events, runSpec), [events, runSpec]);
  const finished = !running && events.some((e) => e.type === "done");
  useEffect(() => {
    if (!finished || !runId || announced.current === runId) return;
    announced.current = runId;
    const s = summarizeResults(reports, runSpec, { considered: searchCounts(events).considered, dropped: events.filter((e) => e.type === "drop").length });
    setMessages((m) => [...m, { id: uid(), role: "hermit", text: [...s.paragraphs, s.followUp].join(" ") }]);
  }, [finished, runId, reports, runSpec, events]);

  // Only the newest proposal message for a space shows the plan, and only the newest search shows the crew's checks.
  const lastFit = useMemo(() => new Map(messages.filter((m) => m.fitout).map((m) => [m.fitout!, m.id])), [messages]);
  const lastThink = useMemo(() => [...messages].reverse().find((m) => m.thinking)?.id, [messages]);
  const extraFor = (m: ChatMsg) => {
    if (m.id === lastThink && (running || events.length > 0)) return <Thinking steps={steps} running={running} />;
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
  const cta = ready && !searched;
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  const studio = <LayoutStudio inline useType={spec.useType} initial={editorInit} onChange={(b) => applyBlocks(b, true)} onDone={() => {}} />;

  return (
    <div className="studio">
      <div className="studio-top">
        <span />
        <button type="button" className="btn small" onClick={reset}><RotateCcw aria-hidden="true" /> Start over</button>
      </div>
      <div className="studio-grid">
        <Interview messages={messages} busy={busy} onSend={send} extra={extraFor}
          placeholder={reports.length ? "Ask about a match, or “make it 3 exam rooms”" : undefined}
          top={!searched && (
            <div className="studio-progress">
              <span id="req-progress">Your requirements: {pct}%</span>
              <div className="studio-progress-bar" role="progressbar" aria-labelledby="req-progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
            </div>
          )}
          attach={<>
            <button type="button" className="icon-btn" aria-label="Upload a floor plan" title="Upload a floor plan" disabled={busy || running} onClick={() => fileInput.current?.click()}><ImageUp aria-hidden="true" /></button>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" tabIndex={-1} aria-label="Floor plan file"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
          </>}>
          {cta && (
            <div className="cta-row">
              <button type="button" className="cta" onClick={() => search()}><Sparkles aria-hidden="true" /> See your matches</button>
              <span className="muted small">You can still change the layout or tell me more first.</span>
            </div>
          )}
        </Interview>

        <div className="studio-right">
          {searched ? (
            <>
              <MatchingSpaces reports={reports} spec={runSpec} runId={runId} running={running} selected={selected} onSelect={setSelected}
                onOpen={(r) => setViewIndex(reports.indexOf(r))} design={blocks} viewIndex={viewIndex} onViewIndex={setViewIndex} />
              <CrewTrace events={events} running={running} useLabel={(spec.useType || "space").toLowerCase()} />
              <details className="card pad studio-editor" ref={(el) => { editor.current = el; }} tabIndex={-1}>
                <summary>Edit your layout</summary>
                {studio}
              </details>
            </>
          ) : (
            <section className="card pad studio-editor" ref={(el) => { editor.current = el; }} tabIndex={-1} aria-labelledby="editor-title">
              <h2 id="editor-title">Edit your layout</h2>
              {studio}
            </section>
          )}
        </div>
      </div>
      {emailReport && <EmailDraft report={emailReport} onClose={() => setEmailFor(null)} />}
      {parcelFor && <ParcelInfo report={parcelFor} onClose={() => setParcelFor(null)} />}
    </div>
  );
}
