"use client";
// Inside & furnish: one place to look around a space and try furniture in it, as a measured 2D plan or the 3D tour.
// Both views edit the same furniture list. One Hermit prompt handles "add a table to this room" in either view and
// answers questions about the space.
import { Box, Map as MapIcon, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { KEYS, load } from "@/lib/client/store";
import { glyphFor, fromPlacement, roomOf, toFootprint } from "@/lib/furnish/plan";
import { FURNITURE, roomOf as sketchRoomOf, type Furn, type FurnType } from "@/lib/spec/furnish";
import { place, type Wall } from "@/lib/spec/place";
import type { SketchRoom } from "@/lib/spec/sketch";
import { roomStop, tourSteps, tourUrl } from "@/lib/viewer/matterport";
import { FurnishTour, type TourHandle, type TourTarget } from "../FurnishTour";
import { GuideCard } from "../GuideCard";
import { Furniture } from "../studio/Furniture";
import { Mic } from "../Voice";
import { FloorPlan, isApproximate, mainFloor, roomsWithShape } from "./FloorPlan";
import { useFurnished, usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

type Line = { role: "user" | "hermit"; text: string; followUp?: string | null };
type View = "2d" | "3d";
type Action = { op: "add" | "remove"; type: FurnType; count: number; roomId: string | null; wall: Wall };
type Target = TourTarget & { index?: number };

// Furniture verbs go to placement; anything else is a question about the space.
const FURNISH = /\b(add|put|place|move|remove|delete|take out|get rid|rotate|turn|swap|replace|make|paint|resize|furnish|bring|fit)\b/i;
const post = async <T,>(url: string, body: unknown): Promise<T> => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
};

export function InsideFurnish({ report, runId, use }: ReportCtx) {
  const sid = report.inside?.sid;
  const g = report.floorplan;
  const [items, setItems] = useFurnished(report.shellId, sid);
  const [log, setLog] = usePersisted<Line[]>(`hermit:inside-chat:${report.shellId}`, []);
  const [extra, setExtra] = usePersisted<string[]>(`hermit:extraq:${report.shellId}`, []);
  const [sel, setSel] = useState<string | null>(report.fit.assignment.find((a) => a.roomId)?.roomId ?? null);
  const [selItem, setSelItem] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [plain, setPlain] = useState(false); // the 3D furnishing tour couldn't start: plain tour, 2D for furniture
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<Target>();
  const handle = useRef<TourHandle | null>(null);
  const n = useRef(0);

  const approx = !!g && isApproximate(g);
  const shaped = useMemo(() => (g ? roomsWithShape(g).filter((r) => isApproximate(g) || r.floorId === mainFloor(g)) : []), [g]);
  const has2d = shaped.length > 0;
  const [view, setView] = useState<View>(sid ? "3d" : "2d");
  const [opened3d, setOpened3d] = useState(view === "3d"); // keep the tour mounted once opened: it's slow to start
  useEffect(() => { if (view === "3d") setOpened3d(true); }, [view]);

  // Every measured room gets a name you can type: your requirement if it matched, else "Room N".
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of report.fit.assignment) if (a.roomId) m.set(a.roomId, a.req);
    let i = 1;
    for (const r of shaped) if (!m.has(r.id)) m.set(r.id, `Room ${i++}`);
    return m;
  }, [report, shaped]);
  const footprints = useMemo(() => items.map((p) => toFootprint(p, shaped)), [items, shaped]);

  // Furniture from the user's own sketch, so the tour can say "picture your desk here".
  const [sketchFurn, setSketchFurn] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const p = load<{ layout?: SketchRoom[]; furniture?: Furn[] }>(KEYS.chat);
    const out: Record<string, string[]> = {};
    for (const f of p?.furniture ?? []) { const r = sketchRoomOf(f, p?.layout ?? []); if (r) (out[r.label] ??= []).push(f.type); }
    setSketchFurn(out);
  }, []);
  const steps = useMemo(() => tourSteps(report, sketchFurn), [report, sketchFurn]);

  const goStep = (i: number) => {
    const s = steps[i];
    setStep(i);
    if (s?.sweepId) setTarget({ sweepId: s.sweepId, yaw: s.yaw, index: s.sweep, n: ++n.current });
    const roomId = s?.room && report.fit.assignment.find((a) => a.req.replace(/\s*#(\d+)/, " $1") === s.room)?.roomId;
    if (roomId) setSel(roomId);
  };
  // Picking a room on the plan or in the list also walks the 3D tour to it (inside it, or facing it from next door).
  const pickRoom = (id: string) => {
    setSel(id); setSelItem(null);
    const name = names.get(id)?.replace(/\s*#(\d+)/, " $1");
    const i = steps.findIndex((s) => s.room === name);
    if (i >= 0) { goStep(i); return; }
    const stop = roomStop(g, g?.rooms.find((r) => r.id === id));
    if (stop) setTarget({ sweepId: stop.sweepId, yaw: stop.yaw, index: stop.index, n: ++n.current });
  };

  const say = (line: Line) => setLog([...log, line]);
  const placeIn = (roomId: string, type: FurnType, count: number, wall: Wall, current = items) => {
    const room = shaped.find((r) => r.id === roomId);
    if (!room) return { next: current, msg: `I can't place furniture in ${names.get(roomId) ?? "that room"}: the scan has no outline for it.` };
    const inRoom = current.map((p) => toFootprint(p, shaped)).filter((f) => f.roomId === roomId);
    const { placed, missed } = place(roomId, room.polygon, inRoom, type, count, wall);
    const next = [...current];
    for (const f of placed) next.push(fromPlacement(f, next));
    const where = names.get(roomId);
    return { next, msg: placed.length ? `Placed ${placed.length} ${type}${placed.length > 1 ? "s" : ""} in ${where}${wall ? ` along the ${wall} wall` : ""}.${missed ? ` ${missed} more won't fit with walking room.` : ""}` : `No ${type} fits in ${where} with walking room around it.` };
  };

  // The measured placer: rooms by name, "this room" = the selected room. Works in both views (positions are real).
  const place2d = async (q: string, roomHint: string | null): Promise<string> => {
    const out = await post<{ reply: string; actions: Action[] }>("/api/furnish", { text: q, rooms: [...names].map(([id, name]) => ({ id, name })) });
    let next = items;
    const msgs: string[] = [];
    for (const a of out.actions ?? []) {
      const roomId = a.roomId && names.has(a.roomId) ? a.roomId : roomHint;
      if (a.op === "remove") {
        const before = next.length;
        next = next.filter((p) => !(glyphFor(p.name) === a.type && (!roomId || roomOf(p, shaped) === roomId)));
        msgs.push(before === next.length ? `There's no ${a.type} to remove${roomId ? ` in ${names.get(roomId)}` : ""}.` : `Removed ${before - next.length} ${a.type}${before - next.length > 1 ? "s" : ""}.`);
        continue;
      }
      if (!roomId) { msgs.push(`Which room should the ${a.type} go in? Tap a room, or name it, like "in ${[...names.values()][0]}".`); continue; }
      const r = placeIn(roomId, a.type, Math.min(20, Math.max(1, Math.round(a.count))), a.wall, next);
      next = r.next; msgs.push(r.msg);
      if (roomId !== sel) pickRoom(roomId);
    }
    setItems(next);
    return [out.reply, ...msgs].filter(Boolean).join(" ") || `I couldn't tell what to place. Try "add a table to this room".`;
  };

  const run = async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    const base = [...log, { role: "user" as const, text: q }];
    setLog(base); setText(""); setBusy(true);
    try {
      if (!FURNISH.test(q)) {
        const out = await post<{ answer?: string; followUp?: string | null }>("/api/ask", { runId, shellId: report.shellId, question: q, room: (sel && names.get(sel)) ?? null, history: base.slice(-8).map(({ role, text }) => ({ role, text })) });
        setLog([...base, { role: "hermit", text: out.answer ?? "Sorry, I couldn't answer that.", followUp: out.followUp }]);
        return;
      }
      // A named room always uses the measured placer; "this room"/"here" in 3D means where you're standing.
      const lower = q.toLowerCase();
      const named = [...names].sort((a, b) => b[1].length - a[1].length).find(([, nm]) => lower.includes(nm.toLowerCase()))?.[0] ?? null;
      const in3d = view === "3d" && !plain && !!handle.current?.ready();
      const reply = in3d && !named ? await handle.current!.send(q) : has2d ? await place2d(q, named ?? sel) : "This scan has no room outlines, so I can only place furniture in the 3D tour.";
      setLog([...base, { role: "hermit", text: reply }]);
    } catch {
      setLog([...base, { role: "hermit", text: "I couldn't reach the server. Try again?" }]);
    } finally { setBusy(false); }
  };

  const selRoom = sel ? shaped.find((r) => r.id === sel) : undefined;
  const selFoot = footprints.find((f) => f.id === selItem);
  if (!sid && !has2d) return <p className="card pad">This space has no 3D scan and no room outlines, so there&apos;s nothing to walk through or furnish here.</p>;

  return (
    <div className="inside2">
      <div className="inside2-main card">
        <div className="inside2-bar">
          <div className="seg" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "2d"} disabled={!has2d} onClick={() => setView("2d")}><MapIcon aria-hidden="true" /> 2D plan</button>
            <button type="button" aria-pressed={view === "3d"} disabled={!sid} onClick={() => setView("3d")}><Box aria-hidden="true" /> 3D tour</button>
          </div>
          <span className="muted small">{view === "2d"
            ? approx ? "Rooms drawn as squares of their measured area (no wall outlines in this scan)." : "Measured from the scan. Tap a room to pick it."
            : plain ? "Basic tour: furniture is placed on the 2D plan." : "Drag furniture to move it. Furniture sizes are typical, not measured."}</span>
        </div>
        <div className="inside2-canvas">
          {view === "2d" && has2d && (
            <div className="inside2-plan">
              <FloorPlan graph={g!} names={names} highlight={sel} items={footprints} selected={selItem} onRoom={pickRoom} onItem={(id) => setSelItem(id)} height={560}
                label={`Measured floor plan of ${report.name} with ${items.length} pieces of furniture`} />
              <div className="sel-bar">
                {selFoot ? (
                  <><span><strong>{items.find((p) => p.id === selItem)?.name}</strong> in {names.get(selFoot.roomId) ?? "the space"}</span>
                    <button type="button" className="btn small danger" onClick={() => { setItems((cur) => cur.filter((p) => p.id !== selItem)); setSelItem(null); }}><Trash2 aria-hidden="true" /> Remove</button></>
                ) : selRoom ? <span><strong>{names.get(selRoom.id)}</strong> · {Math.round(selRoom.areaSqft)} sf measured. Tap a piece below to add it here.</span>
                  : <span className="muted">Tap a room to pick it, or tell Hermit what you want.</span>}
              </div>
              {selRoom && (
                <div className="tiles objects inline-tiles" role="group" aria-label={`Add furniture to ${names.get(selRoom.id)}`}>
                  {FURNITURE.map((f) => (
                    <button key={f.type} type="button" className="tile obj" onClick={() => { const r = placeIn(selRoom.id, f.type, 1, null); setItems(r.next); say({ role: "hermit", text: r.msg }); }}>
                      <svg viewBox={`-0.4 -0.4 ${Math.max(f.w, f.h) + 0.8} ${Math.max(f.w, f.h) + 0.8}`} width={30} height={26} aria-hidden="true"><Furniture type={f.type} w={f.w} h={f.h} /></svg>
                      <span>{f.type}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {sid && opened3d && (
            <div className={`inside2-3d guide-stage${view === "3d" ? "" : " is-hidden"}`} aria-hidden={view !== "3d" || undefined}>
              {plain ? (
                <div className="pv-frame">
                  <iframe key={`${target?.index ?? "start"}-${target?.yaw ?? ""}`} title={`Matterport 3D tour of ${report.name}`} src={tourUrl(sid, target?.index, target?.yaw)} allow="xr-spatial-tracking; fullscreen" allowFullScreen />
                </div>
              ) : <FurnishTour report={report} use={use} stop={target} stops={[]} onFail={() => setPlain(true)} items={items} setItems={setItems} chat={false} handle={handle} />}
              <GuideCard text={steps[step].text}>
                <button type="button" className="btn" onClick={() => goStep(step - 1)} disabled={step === 0}>Back</button>
                <span className="muted num" aria-label={`Stop ${step + 1} of ${steps.length}`}>{step + 1} / {steps.length}</span>
                {step < steps.length - 1
                  ? <button type="button" className="btn primary" onClick={() => goStep(step + 1)}>Next room</button>
                  : <button type="button" className="btn" onClick={() => goStep(0)}>Start over</button>}
              </GuideCard>
            </div>
          )}
        </div>
      </div>

      <aside className="inside2-side card" aria-label="Rooms and Hermit">
        <h2>Your rooms in this space</h2>
        <ol className="room-list">
          {report.fit.assignment.map((a) => (
            <li key={a.req}>
              {a.roomId ? <button type="button" aria-pressed={sel === a.roomId} onClick={() => pickRoom(a.roomId!)}>
                <strong>{a.req}</strong> <span className="muted">{Math.round(g?.rooms.find((r) => r.id === a.roomId)?.areaSqft ?? 0)} sf</span>
              </button> : <span className="room-missing"><strong>{a.req}</strong> <span>not built here yet</span></span>}
            </li>
          ))}
        </ol>

        <section className="ask" aria-labelledby="hermit-ask-title">
          <h3 id="hermit-ask-title">Tell Hermit what to put where, or ask about the space</h3>
          <div className="ask-log" aria-live="polite">
            {!log.length && <p className="muted small">Try: &ldquo;add a table to this room&rdquo;, &ldquo;put 2 chairs in {[...names.values()][0] ?? "reception"}&rdquo;, or &ldquo;is there a sink in the exam rooms?&rdquo;</p>}
            {log.map((m, i) => (
              <div key={i} className={`ask-msg ${m.role}`}>
                <p>{m.text}</p>
                {m.followUp && !extra.includes(m.followUp) && <button type="button" className="btn small" onClick={() => setExtra([...extra, m.followUp!])}><Plus aria-hidden="true" /> Add &ldquo;{m.followUp}&rdquo; to my broker questions</button>}
              </div>
            ))}
            {busy && <p className="muted small">Hermit is working on it…</p>}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void run(text); }}>
            <label className="sr-only" htmlFor="inside-input">Tell Hermit what to place, or ask about this space</label>
            <input id="inside-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Try: add a table to this room" maxLength={500} autoComplete="off" />
            <Mic disabled={busy} onText={(t) => void run(t)} />
            <button type="submit" className="send" disabled={!text.trim() || busy} aria-label="Send"><Send aria-hidden="true" /></button>
          </form>
          <p className="muted small">Furniture is saved in this browser and shows in both views. Visualization only: nothing here changes the property.</p>
          {items.length > 0 && <button type="button" className="btn small" onClick={() => { setItems([]); setSelItem(null); say({ role: "hermit", text: "Cleared all furniture." }); }}><Trash2 aria-hidden="true" /> Clear all furniture</button>}
        </section>
      </aside>
    </div>
  );
}
