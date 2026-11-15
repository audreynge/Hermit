"use client";
import { Box, PencilRuler, RotateCcw, Sparkles, SquareDashed } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KEYS, load, save } from "@/lib/client/store";
import type { IState, ITurn } from "@/lib/interview/turn";
import { roomOf, type Furn } from "@/lib/spec/furnish";
import { adjacency, toLayout, type SketchRoom } from "@/lib/spec/sketch";
import { blocksToSketch, roomsFromBlocks, sketchToBlocks } from "@/lib/spec/blocks";
import type { Block } from "@/lib/spec/parse";
import { thinkingSteps } from "@/lib/chat/present";
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

const uid = () => Math.random().toString(36).slice(2, 10);
const EMPTY: Draft = { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" };
type Persist = { iv: IState; messages: ChatMsg[]; layout: SketchRoom[]; furniture: Furn[]; extras?: Block[]; ready: boolean; basics: boolean; reports: ShellReport[]; events: TraceEvent[]; runId: string | null };
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
    setEvents([]); setReports([]); setRunning(true); setOpen(null); setShown(0);
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
      void recount(p.iv.spec);
      return;
    }
    void ask({ spec: EMPTY, asked: [], history: [] }, null);
  }, [replay, runSearch, recount, ask, firstQ, router]);

  useEffect(() => {
    if (!started.current || replay || !messages.length) return;
    save(KEYS.chat, { iv, messages, layout, furniture, extras, ready, basics, reports, events, runId } satisfies Persist);
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
    setMessages((m) => [...m.map((x) => ({ ...x, quick: undefined, cta: false })), { id: uid(), role: "user", text }]);
    if (reports.length && !running) {
      // After results, a changed requirement sends the crew back in.
      setBusy(true);
      post<ITurn>("/api/interview", { state: { ...iv, field: null, ready: true }, text }).then((t) => {
        const changed = JSON.stringify(t.state.spec) !== JSON.stringify(iv.spec);
        setIv(t.state); setStages(t.stages);
        setMessages((m) => [...m, { id: uid(), role: "hermit", text: changed ? "Got it. Updating your search and sending the crew back in." : "Ask me to change a requirement, or tap “Step inside” on a space to see it." }]);
        if (changed) void runSearch(finalSpec(t.state.spec));
      }).catch(() => {}).finally(() => setBusy(false));
      return;
    }
    void ask(iv, text);
  };

  const onRooms = (rooms: RoomReq[], note: string) => {
    const next = { ...iv, spec: { ...spec, rooms, input: "layout" as const } };
    setIv(next);
    void recount(next.spec);
    setMessages((m) => (m.at(-1)?.agent === "sketch" ? [...m.slice(0, -1), { ...m.at(-1)!, text: `Sketch updated: ${note}.` }] : [...m, { id: uid(), role: "hermit", agent: "sketch", text: `Sketch updated: ${note}.` }]));
  };

  // "Use this layout" from Layout Studio: the drawing becomes the sketch (rooms pinned where drawn) and the room requirements.
  const applyBlocks = (blocks: Block[]) => {
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
    setMessages((m) => [...m, { id: uid(), role: "hermit", agent: "sketch", text: `Layout updated: ${roomBlocks.length} rooms, about ${area.toLocaleString()} sq ft. I'll match it against real floor plans.` }]);
  };

  const reset = () => { save(KEYS.chat, null); setIv({ spec: EMPTY, asked: [], history: [] }); setMessages([]); setStages([]); setReports([]); setEvents([]); setReady(false); setBasics(false); setLayout([]); setFurniture([]); setExtras([]); setShown(0); started.current = true; void ask({ spec: EMPTY, asked: [], history: [] }, null); };

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
        <Interview messages={messages} busy={busy} onSend={send} placeholder={reports.length ? "Change a requirement, e.g. “make it 3 exam rooms”" : undefined}>
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
              <MatchingSpaces reports={reports} spec={runSpec} runId={runId} running={running} onOpen={setOpen} />
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
      {open && <ShellReportView report={open} onClose={() => setOpen(null)} packetHref={runId ? `/packet/${runId}/${open.shellId}` : undefined} furniture={furnitureByRoom} />}
    </div>
  );
}
