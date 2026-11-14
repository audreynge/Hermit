"use client";
import { Copy, LayoutGrid, List, Minus, Plus, Sofa, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { designTips, FURNITURE, furnId, furnishAll, isFixture, roomOf, type Furn, type FurnType } from "@/lib/spec/furnish";
import { dims, sketchArea, type SketchRoom } from "@/lib/spec/sketch";
import type { Pack } from "@/lib/uses/packs";
import type { RoomReq } from "@/lib/types";
import { FurnArt } from "./FurnArt";

export const FIXTURES = ["sink", "toilet", "shower", "hood", "shampoo sink"];
const FILL: Record<string, string> = { reception: "#fde3d4", "exam room": "#dcefff", office: "#e6f4e8", bathroom: "#e3f4fb", kitchen: "#fff0e0", storage: "#ece6f6", lab: "#e8f0ff", "styling floor": "#fde3ee", open: "#f3f0e6", conference: "#f3ecff", dining: "#fff3dd", bedroom: "#e6f4e8", living: "#fdf1ea" };

type Sel = { kind: "room" | "furn"; key: string } | null;
type Props = {
  rooms: RoomReq[]; pack: Pack; layout: SketchRoom[]; furniture: Furn[]; wheelchair?: boolean;
  onRooms: (rooms: RoomReq[], note: string) => void; onMove: (layout: SketchRoom[]) => void; onFurniture: (f: Furn[]) => void;
};

export function Sketch({ rooms, pack, layout, furniture, wheelchair, onRooms, onMove, onFurniture }: Props) {
  const [tab, setTab] = useState<"sketch" | "design">("sketch");
  const [view, setView] = useState<"plan" | "list">("plan");
  const [sel, setSel] = useState<Sel>(null);
  const [announce, setAnnounce] = useState("");
  const drag = useRef<{ sel: NonNullable<Sel>; dx: number; dy: number; kids: { id: string; dx: number; dy: number }[] } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const area = sketchArea(layout);
  const W = Math.max(58, ...layout.map((b) => b.x + b.w + 2)), H = Math.max(30, ...layout.map((b) => b.y + b.h + 2));
  const selRoom = sel?.kind === "room" ? layout.find((b) => b.key === sel.key) : undefined;
  const selFurn = sel?.kind === "furn" ? furniture.find((f) => f.id === sel.key) : undefined;

  useEffect(() => { if (sel && !selRoom && !selFurn) setSel(null); }, [sel, selRoom, selFurn]);

  const say = (t: string) => setAnnounce(t);
  const nameOf = (b: SketchRoom) => ((rooms.find((r) => r.label === b.label)?.count ?? 1) > 1 ? `${b.label} ${b.index + 1}` : b.label);

  const setRoom = (i: number, patch: Partial<RoomReq> | null, note: string) => {
    onRooms(patch === null ? rooms.filter((_, j) => j !== i) : rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)), note);
    say(note);
  };
  const addRoom = (label: string) => {
    const i = rooms.findIndex((r) => r.label === label);
    if (i >= 0) return setRoom(i, { count: rooms[i].count + 1 }, `Added another ${label}`);
    const p = pack.rooms.find((r) => r.label === label);
    onRooms([...rooms, { label, count: 1, hard: false, ...(p?.minSqft ? { minSqft: p.minSqft } : {}), ...(p?.fixtures ? { fixtures: p.fixtures } : {}) }], `Added ${label}`);
    say(`Added ${label}`);
  };
  const deleteRoom = (b: SketchRoom) => {
    const i = rooms.findIndex((r) => r.label === b.label);
    if (i < 0) return;
    const inside = furniture.filter((f) => roomOf(f, layout)?.key === b.key).map((f) => f.id);
    if (inside.length) onFurniture(furniture.filter((f) => !inside.includes(f.id)));
    setRoom(i, rooms[i].count > 1 ? { count: rooms[i].count - 1 } : null, `Deleted ${nameOf(b)}`);
    setSel(null);
  };
  const deleteFurn = (f: Furn) => { onFurniture(furniture.filter((x) => x.id !== f.id)); setSel(null); say(`Removed ${f.type}`); };
  const deleteSel = () => { if (selRoom) deleteRoom(selRoom); else if (selFurn) deleteFurn(selFurn); };

  const addFurn = (type: FurnType) => {
    const spec = FURNITURE.find((f) => f.type === type)!;
    const host = selRoom ?? (selFurn ? roomOf(selFurn, layout) : undefined) ?? layout[0];
    const x = host ? host.x + Math.max(0.5, (host.w - spec.w) / 2) : 1, y = host ? host.y + Math.max(0.5, (host.h - spec.h) / 2) : 1;
    const f: Furn = { id: furnId(), type, x, y, w: spec.w, h: spec.h };
    onFurniture([...furniture, f]);
    setSel({ kind: "furn", key: f.id });
    say(`Added a ${type}${host ? ` to ${nameOf(host)}` : ""}`);
    // A plumbing fixture dropped into a room becomes a requirement for that room.
    if (host && isFixture(type)) {
      const i = rooms.findIndex((r) => r.label === host.label);
      if (i >= 0 && !rooms[i].fixtures?.includes(type)) onRooms(rooms.map((r, j) => (j === i ? { ...r, fixtures: [...(r.fixtures ?? []), type] } : r)), `${host.label} needs a ${type}`);
    }
  };

  const toFt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * (H + 4) };
  };
  const moveSel = (s: NonNullable<Sel>, dx: number, dy: number) => {
    if (s.kind === "room") {
      const b = layout.find((x) => x.key === s.key)!;
      const kids = furniture.filter((f) => roomOf(f, layout)?.key === b.key).map((f) => f.id);
      onMove(layout.map((x) => (x.key === s.key ? { ...x, x: Math.max(0, x.x + dx), y: Math.max(0, x.y + dy), pinned: true } : x)));
      if (kids.length) onFurniture(furniture.map((f) => (kids.includes(f.id) ? { ...f, x: f.x + dx, y: f.y + dy } : f)));
    } else onFurniture(furniture.map((f) => (f.id === s.key ? { ...f, x: Math.max(0, f.x + dx), y: Math.max(0, f.y + dy) } : f)));
  };
  const keys = (e: React.KeyboardEvent, s: NonNullable<Sel>) => {
    const step = e.shiftKey ? 5 : s.kind === "furn" ? 0.5 : 1;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (mv[e.key]) { e.preventDefault(); moveSel(s, ...mv[e.key]); }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSel(); }
    if (e.key === "Escape") setSel(null);
  };
  const startDrag = (e: React.PointerEvent, s: NonNullable<Sel>, x: number, y: number) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toFt(e);
    const kids = s.kind === "room" ? furniture.filter((f) => roomOf(f, layout)?.key === s.key).map((f) => ({ id: f.id, dx: f.x - x, dy: f.y - y })) : [];
    drag.current = { sel: s, dx: p.x - x, dy: p.y - y, kids };
    setSel(s);
  };
  const onDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toFt(e);
    const nx = Math.max(0, p.x - d.dx), ny = Math.max(0, p.y - d.dy);
    if (d.sel.kind === "room") {
      const rx = Math.round(nx), ry = Math.round(ny);
      onMove(layout.map((b) => (b.key === d.sel.key ? { ...b, x: rx, y: ry, pinned: true } : b)));
      if (d.kids.length) onFurniture(furniture.map((f) => { const k = d.kids.find((x) => x.id === f.id); return k ? { ...f, x: rx + k.dx, y: ry + k.dy } : f; }));
    } else onFurniture(furniture.map((f) => (f.id === d.sel.key ? { ...f, x: Math.round(nx * 2) / 2, y: Math.round(ny * 2) / 2 } : f)));
  };

  const palette = [...new Set([...pack.rooms.map((r) => r.label), "lab", "office", "storage", "kitchen", "conference", "reception", "bathroom"])];
  const tips = designTips(pack, { wheelchair });
  const box = selRoom ?? selFurn;

  return (
    <section className="card sketch" aria-labelledby="sketch-title">
      <div className="tabs" role="tablist" aria-label="Layout">
        <button role="tab" type="button" aria-selected={tab === "sketch"} onClick={() => setTab("sketch")}><LayoutGrid aria-hidden="true" /> Your sketch</button>
        <button role="tab" type="button" aria-selected={tab === "design"} onClick={() => setTab("design")}><Sparkles aria-hidden="true" /> Let Hermit help you design!</button>
      </div>
      <h2 id="sketch-title" className="sr-only">Your space, sketched</h2>
      <p className="sr-only" aria-live="polite">{announce}</p>

      {tab === "design" ? (
        <div className="design">
          <div className="speech">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hermit-logo.svg" alt="" className="speech-crab" />
            <div className="speech-bubble">
              <p><strong>Here&apos;s how I&apos;d lay out a {pack.label.toLowerCase()}:</strong></p>
              <ul>{tips.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          </div>
          <div className="design-actions">
            <button type="button" className="btn primary" onClick={() => { onFurniture(furnishAll(layout)); setTab("sketch"); say("Hermit furnished every room"); }}><Wand2 aria-hidden="true" /> Furnish every room for me</button>
            <button type="button" className="btn" onClick={() => { onMove(layout.map((b) => ({ ...b, pinned: false }))); onFurniture([]); say("Tidied the layout"); }}><LayoutGrid aria-hidden="true" /> Tidy the layout</button>
            <button type="button" className="btn" onClick={() => { onFurniture([]); say("Cleared all furniture"); }}><Trash2 aria-hidden="true" /> Clear furniture</button>
          </div>
          <p className="muted small">Furniture helps you picture the space and shows up in the guided tour. Plumbing fixtures (sinks, toilets, showers, hoods) also become requirements.</p>
        </div>
      ) : (
        <>
          <div className="sketch-head">
            <p className="muted">About <span className="num">{area.toLocaleString()}</span> sf of rooms. Drag to move, or select something and press Delete.</p>
            <div className="seg" role="group" aria-label="Sketch view">
              <button type="button" aria-pressed={view === "plan"} onClick={() => setView("plan")}><LayoutGrid aria-hidden="true" /> Plan</button>
              <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List aria-hidden="true" /> List</button>
            </div>
          </div>

          {view === "plan" ? (
            <>
              <div className="sel-bar" aria-live="polite">
                {box ? (
                  <>
                    <span><strong>{selRoom ? nameOf(selRoom) : selFurn!.type}</strong>{selRoom ? ` · ${selRoom.w * selRoom.h} sf` : ""}</span>
                    {selRoom && <button type="button" className="btn small" onClick={() => addRoom(selRoom.label)}><Copy aria-hidden="true" /> Duplicate</button>}
                    <button type="button" className="btn small danger" onClick={deleteSel}><Trash2 aria-hidden="true" /> Delete</button>
                  </>
                ) : <span className="muted">Tap a room or a piece of furniture to select it.</span>}
              </div>
              <div className="sketch-canvas">
                <svg ref={svg} viewBox={`0 0 ${W} ${H + 4}`} width="100%" style={{ maxHeight: 380, touchAction: "none" }} role="group"
                  aria-label={`Sketch: ${layout.length} rooms and ${furniture.length} pieces of furniture, about ${area} square feet. Each item is a button: arrow keys move it, Delete removes it.`}
                  onPointerMove={onDrag} onPointerUp={() => { drag.current = null; }} onPointerDown={(e) => { if (e.target === svg.current) setSel(null); }}>
                  {layout.map((b) => {
                    const s = { kind: "room" as const, key: b.key };
                    const on = sel?.kind === "room" && sel.key === b.key;
                    return (
                      <g key={b.key} role="button" tabIndex={0} aria-pressed={on} aria-label={`${nameOf(b)}, ${b.w} by ${b.h} feet${b.fixtures.length ? `, needs ${b.fixtures.join(", ")}` : ""}`}
                        onFocus={() => setSel(s)} onKeyDown={(e) => keys(e, s)} onPointerDown={(e) => startDrag(e, s, b.x, b.y)} style={{ cursor: "grab" }}>
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={0.6} fill={FILL[b.label] ?? "#f7efe9"} stroke={on ? "#a23a23" : "#6b4a3a"} strokeWidth={on ? 0.45 : 0.25} />
                        <text x={b.x + 0.6} y={b.y + 1.7} fontSize={Math.min(1.5, (b.w - 1) / (nameOf(b).length * 0.58))} fontWeight={800} fill="#3b2320">{nameOf(b)}</text>
                        <text x={b.x + 0.6} y={b.y + b.h - 0.6} fontSize={Math.min(1.2, (b.w - 1) / 6)} fill="#3b2320">{b.w * b.h} sf{b.fixtures.length && b.w >= 10 ? ` · ${b.fixtures.join(", ")}` : ""}</text>
                      </g>
                    );
                  })}
                  {furniture.map((f) => {
                    const s = { kind: "furn" as const, key: f.id };
                    const on = sel?.kind === "furn" && sel.key === f.id;
                    return (
                      <g key={f.id} role="button" tabIndex={0} aria-pressed={on} aria-label={`${f.type}${roomOf(f, layout) ? ` in ${nameOf(roomOf(f, layout)!)}` : ""}`} transform={`translate(${f.x} ${f.y})`}
                        onFocus={() => setSel(s)} onKeyDown={(e) => keys(e, s)} onPointerDown={(e) => startDrag(e, s, f.x, f.y)} style={{ cursor: "grab" }}>
                        <FurnArt type={f.type} w={f.w} h={f.h} />
                        {on && <rect x={-0.25} y={-0.25} width={f.w + 0.5} height={f.h + 0.5} rx={0.3} fill="none" stroke="#a23a23" strokeWidth={0.2} strokeDasharray="0.5 0.3" />}
                      </g>
                    );
                  })}
                  {box && (
                    <g role="button" tabIndex={-1} aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); deleteSel(); }} style={{ cursor: "pointer" }}
                      transform={`translate(${box.x + box.w - 0.2} ${box.y - 0.2})`}>
                      <circle r={1.1} fill="#b23a28" stroke="#fff" strokeWidth={0.2} />
                      <path d="M-0.45 -0.45 L0.45 0.45 M0.45 -0.45 L-0.45 0.45" stroke="#fff" strokeWidth={0.28} strokeLinecap="round" />
                    </g>
                  )}
                  <g transform={`translate(0 ${H + 1.5})`} aria-hidden="true">
                    <line x1={0} x2={10} y1={0} y2={0} stroke="#3b2320" strokeWidth={0.25} />
                    <line x1={0} x2={0} y1={-0.6} y2={0.6} stroke="#3b2320" strokeWidth={0.25} /><line x1={10} x2={10} y1={-0.6} y2={0.6} stroke="#3b2320" strokeWidth={0.25} />
                    <text x={11} y={0.5} fontSize={1.3} fill="#3b2320">10 ft</text>
                  </g>
                </svg>
              </div>
            </>
          ) : (
            <table className="sketch-list">
              <caption className="sr-only">Rooms you need</caption>
              <thead><tr><th scope="col">Room</th><th scope="col">How many</th><th scope="col">Min sf each</th><th scope="col">Needs</th><th scope="col"><span className="sr-only">Delete</span></th></tr></thead>
              <tbody>
                {rooms.map((r, i) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td>
                      <div className="stepper-mini">
                        <button type="button" aria-label={`Fewer ${r.label}s`} onClick={() => (r.count > 1 ? setRoom(i, { count: r.count - 1 }, `${r.label}: ${r.count - 1}`) : setRoom(i, null, `Deleted ${r.label}`))}><Minus aria-hidden="true" /></button>
                        <span className="num">{r.count}</span>
                        <button type="button" aria-label={`More ${r.label}s`} onClick={() => setRoom(i, { count: r.count + 1 }, `${r.label}: ${r.count + 1}`)}><Plus aria-hidden="true" /></button>
                      </div>
                    </td>
                    <td><label className="sr-only" htmlFor={`sf-${i}`}>Minimum square feet for {r.label}</label>
                      <input id={`sf-${i}`} className="mini-input num" inputMode="numeric" defaultValue={r.minSqft ?? dims(r, pack).w * dims(r, pack).h}
                        onBlur={(e) => { const v = Number(e.target.value.replace(/\D/g, "")); if (v > 0 && v !== r.minSqft) setRoom(i, { minSqft: v }, `${r.label} at least ${v} sf`); }} /></td>
                    <td>
                      <fieldset className="fixtures"><legend className="sr-only">Fixtures {r.label} needs</legend>
                        {FIXTURES.map((f) => (
                          <label key={f}><input type="checkbox" checked={!!r.fixtures?.includes(f)}
                            onChange={(e) => setRoom(i, { fixtures: e.target.checked ? [...(r.fixtures ?? []), f] : (r.fixtures ?? []).filter((x) => x !== f) }, `${r.label} ${e.target.checked ? "needs" : "doesn't need"} a ${f}`)} /> {f}</label>
                        ))}
                      </fieldset>
                    </td>
                    <td><button type="button" className="btn small danger" onClick={() => setRoom(i, null, `Deleted ${r.label}`)}><X aria-hidden="true" /> Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="sketch-add" role="group" aria-label="Add a room">
            <span className="muted">Add room:</span>
            {palette.map((l) => <button key={l} type="button" className="chip" onClick={() => addRoom(l)}><Plus aria-hidden="true" /> {l}</button>)}
          </div>
          <div className="sketch-add" role="group" aria-label="Add furniture">
            <span className="muted"><Sofa aria-hidden="true" className="inline-icon" /> Furnish{selRoom ? ` ${nameOf(selRoom)}` : ""}:</span>
            {FURNITURE.map((f) => <button key={f.type} type="button" className="chip furn" onClick={() => addFurn(f.type)}>
              <svg viewBox={`-0.3 -0.3 ${f.w + 0.6} ${f.h + 0.6}`} width={18} height={18} aria-hidden="true"><FurnArt type={f.type} w={f.w} h={f.h} /></svg>{f.type}</button>)}
          </div>
        </>
      )}
    </section>
  );
}

