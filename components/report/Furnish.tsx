"use client";
import { Send, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { FURNITURE, type FurnType } from "@/lib/spec/furnish";
import { place, type Wall } from "@/lib/spec/place";
import { Furniture } from "../studio/Furniture";
import { FloorPlan, isApproximate, mainFloor, roomsWithShape } from "./FloorPlan";
import { useFurnished, usePersisted, type PlacedItem } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

type Line = { role: "user" | "hermit"; text: string };

export function Furnish({ report }: ReportCtx) {
  const g = report.floorplan;
  const [items, setItems] = useFurnished(report.shellId);
  const [log, setLog] = usePersisted<Line[]>(`hermit:furnish-chat:${report.shellId}`, []);
  const [sel, setSel] = useState<string | null>(null);
  const [selItem, setSelItem] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const approx = !!g && isApproximate(g);
  const shaped = useMemo(() => (g ? roomsWithShape(g).filter((r) => isApproximate(g) || r.floorId === mainFloor(g)) : []), [g]);
  // Every measured room gets a name you can type: your requirement if it matched, else "Room N".
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of report.fit.assignment) if (a.roomId) m.set(a.roomId, a.req);
    let n = 1;
    for (const r of shaped) if (!m.has(r.id)) m.set(r.id, `Room ${n++}`);
    return m;
  }, [report, shaped]);
  if (!g || !shaped.length) return <p className="card pad">This scan has no wall outlines, so furniture can&apos;t be placed to scale here. Use your own sketch in Find a space instead.</p>;

  const say = (t: string) => setLog([...log, { role: "hermit", text: t }]);
  const addItems = (roomId: string, type: FurnType, count: number, wall: Wall, current: PlacedItem[]) => {
    const room = shaped.find((r) => r.id === roomId)!;
    const { placed, missed } = place(roomId, room.polygon, current.filter((i) => i.roomId === roomId), type, count, wall);
    return { next: [...current, ...placed], msg: placed.length ? `Placed ${placed.length} ${type}${placed.length > 1 ? "s" : ""} in ${names.get(roomId)}${wall ? ` along the ${wall} wall` : ""}.${missed ? ` ${missed} more won't fit with clearance.` : ""}` : `No ${type} fits in ${names.get(roomId)} with walking room around it.` };
  };

  const run = async (q: string) => {
    if (!q.trim() || busy) return;
    const base = [...log, { role: "user" as const, text: q.trim() }];
    setLog(base); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/furnish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: q, rooms: [...names].map(([id, name]) => ({ id, name })) }) });
      const out = await r.json() as { reply: string; actions: { op: "add" | "remove"; type: FurnType; count: number; roomId: string | null; wall: Wall }[] };
      let next = items;
      const msgs: string[] = [];
      for (const a of out.actions ?? []) {
        const roomId = a.roomId && names.has(a.roomId) ? a.roomId : sel;
        if (a.op === "remove") {
          const before = next.length;
          next = next.filter((i) => !(i.type === a.type && (!roomId || i.roomId === roomId)));
          msgs.push(before === next.length ? `There's no ${a.type} to remove${roomId ? ` in ${names.get(roomId)}` : ""}.` : `Removed ${before - next.length} ${a.type}${before - next.length > 1 ? "s" : ""}.`);
          continue;
        }
        if (!roomId) { msgs.push(`Which room should the ${a.type} go in? Tap a room on the plan or name it, like “in ${[...names.values()][0]}”.`); continue; }
        const res = addItems(roomId, a.type, Math.min(20, Math.max(1, Math.round(a.count))), a.wall, next);
        next = res.next; msgs.push(res.msg);
      }
      setItems(next);
      setLog([...base, { role: "hermit", text: [out.reply, ...msgs].filter(Boolean).join(" ") || "I couldn't tell what to place. Try “add 3 chairs to reception”." }]);
    } catch { setLog([...base, { role: "hermit", text: "I couldn't reach the server. Try again?" }]); }
    finally { setBusy(false); }
  };

  const selRoom = sel ? shaped.find((r) => r.id === sel) : undefined;
  return (
    <div className="furnish">
      <div className="furnish-plan card">
        <FloorPlan graph={g} names={names} highlight={sel} items={items} selected={selItem} onRoom={(id) => { setSel(id); setSelItem(null); }} onItem={(id) => setSelItem(id)} height={520}
          label={`Measured floor plan of ${report.name} with ${items.length} pieces of furniture you placed`} />
        <div className="sel-bar">
          {selItem ? (
            <><span><strong>{items.find((i) => i.id === selItem)?.type}</strong> in {names.get(items.find((i) => i.id === selItem)?.roomId ?? "")}</span>
              <button type="button" className="btn small danger" onClick={() => { setItems(items.filter((i) => i.id !== selItem)); setSelItem(null); }}><Trash2 aria-hidden="true" /> Remove</button></>
          ) : selRoom ? <span><strong>{names.get(selRoom.id)}</strong> · {Math.round(selRoom.areaSqft)} sf measured. Tap an item below to add it here.</span>
            : <span className="muted">Tap a room to pick it, or just tell Hermit what you want on the right.</span>}
        </div>
        {selRoom && (
          <div className="tiles objects inline-tiles" role="group" aria-label={`Add furniture to ${names.get(selRoom.id)}`}>
            {FURNITURE.map((f) => (
              <button key={f.type} type="button" className="tile obj" onClick={() => { const r = addItems(selRoom.id, f.type, 1, null, items); setItems(r.next); say(r.msg); }}>
                <svg viewBox={`-0.4 -0.4 ${Math.max(f.w, f.h) + 0.8} ${Math.max(f.w, f.h) + 0.8}`} width={30} height={26} aria-hidden="true"><Furniture type={f.type} w={f.w} h={f.h} /></svg>
                <span>{f.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <aside className="card furnish-side" aria-labelledby="furnish-title">
        <h2 id="furnish-title">Tell Hermit what to put where</h2>
        <p className="muted small">{approx ? "This scan has room sizes but no wall outlines, so rooms are drawn as squares of their measured area (approximate shapes, real floor area)." : "Hermit places each piece inside the real measured walls with walking room around it."} It tells you when something won&apos;t fit. Saved in this browser.</p>
        <div className="ask-log" aria-live="polite">
          {!log.length && <p className="muted small">Try: “add 3 salon chairs along the north wall of {[...names.values()][0]}”, or “put a reception desk in {[...names.values()][1] ?? "Room 1"}”.</p>}
          {log.map((m, i) => <div key={i} className={`ask-msg ${m.role}`}><p>{m.text}</p></div>)}
          {busy && <p className="muted small">Measuring…</p>}
        </div>
        <form className="composer" onSubmit={(e) => { e.preventDefault(); void run(text); }}>
          <label className="sr-only" htmlFor="furnish-input">Furniture request</label>
          <input id="furnish-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. add 2 desks to Room 2" autoComplete="off" />
          <button type="submit" className="send" disabled={!text.trim() || busy} aria-label="Place furniture"><Send aria-hidden="true" /></button>
        </form>
        {items.length > 0 && <button type="button" className="btn small" onClick={() => { setItems([]); say("Cleared all furniture."); }}><Trash2 aria-hidden="true" /> Clear all furniture</button>}
      </aside>
    </div>
  );
}
