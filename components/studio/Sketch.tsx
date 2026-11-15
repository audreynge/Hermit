"use client";
import {
  Archive, Armchair, Bed, Columns2, ConciergeBell, CookingPot, Copy, FlaskConical, LayoutGrid, Layers, List, Minus, Monitor, Plus, Redo2,
  Scissors, Sofa, Sparkles, SquarePlus, Stethoscope, Toilet, Trash2, Undo2, Users, Utensils, Wand2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { designTips, FURNITURE, furnId, furnishAll, isFixture, roomOf, type Furn, type FurnType } from "@/lib/spec/furnish";
import { dims, sketchArea, type SketchRoom } from "@/lib/spec/sketch";
import type { Pack } from "@/lib/uses/packs";
import type { RoomReq } from "@/lib/types";
import { Furniture } from "./Furniture";

export const FIXTURES = ["sink", "toilet", "shower", "hood", "shampoo sink"];
const ICON: Record<string, typeof Stethoscope> = {
  reception: ConciergeBell, "exam room": Stethoscope, office: Monitor, hallway: Columns2, storage: Archive, kitchen: CookingPot, bathroom: Toilet,
  "waiting area": Armchair, conference: Users, "procedure room": SquarePlus, lab: FlaskConical, "styling floor": Scissors, dining: Utensils,
  open: LayoutGrid, bedroom: Bed, living: Sofa,
};
const FILL: Record<string, string> = { reception: "#fde3d4", "exam room": "#dcefff", office: "#e6f4e8", bathroom: "#e3f4fb", kitchen: "#fff0e0", storage: "#ece6f6", lab: "#e8f0ff", "styling floor": "#fde3ee", open: "#f3f0e6", conference: "#f3ecff", dining: "#fff3dd", bedroom: "#e6f4e8", living: "#fdf1ea", hallway: "#fff1d6" };
const PX = 13;

type Sel = { kind: "room" | "furn"; key: string } | null;
type Snapshot = { rooms: RoomReq[]; layout: SketchRoom[]; furniture: Furn[] };
type Props = {
  rooms: RoomReq[]; pack: Pack; layout: SketchRoom[]; furniture: Furn[]; wheelchair?: boolean;
  onRooms: (rooms: RoomReq[], note: string) => void; onMove: (layout: SketchRoom[]) => void; onFurniture: (f: Furn[]) => void;
};

export function Sketch({ rooms, pack, layout, furniture, wheelchair, onRooms, onMove, onFurniture }: Props) {
  const [tab, setTab] = useState<"sketch" | "design">("sketch");
  const [view, setView] = useState<"plan" | "list">("plan");
  const [sel, setSel] = useState<Sel>(null);
  const [zoom, setZoom] = useState(100);
  const [announce, setAnnounce] = useState("");
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const drag = useRef<{ sel: NonNullable<Sel>; dx: number; dy: number; kids: { id: string; dx: number; dy: number }[]; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const area = sketchArea(layout);
  const W = Math.max(58, ...layout.map((b) => b.x + b.w + 3), ...furniture.map((f) => f.x + f.w + 2)), H = Math.max(34, ...layout.map((b) => b.y + b.h + 3));
  const selRoom = sel?.kind === "room" ? layout.find((b) => b.key === sel.key) : undefined;
  const selFurn = sel?.kind === "furn" ? furniture.find((f) => f.id === sel.key) : undefined;
  const box = selRoom ?? selFurn;
  const scale = (PX * zoom) / 100;

  useEffect(() => { if (sel && !box) setSel(null); }, [sel, box]);

  const snap = (): Snapshot => ({ rooms, layout, furniture });
  const remember = () => { setPast((p) => [...p.slice(-39), snap()]); setFuture([]); };
  const restore = (s: Snapshot) => { onRooms(s.rooms, "Undid a change"); onMove(s.layout); onFurniture(s.furniture); };
  const undo = () => { const s = past.at(-1); if (!s) return; setFuture((f) => [snap(), ...f]); setPast((p) => p.slice(0, -1)); restore(s); setAnnounce("Undone"); };
  const redo = () => { const s = future[0]; if (!s) return; setPast((p) => [...p, snap()]); setFuture((f) => f.slice(1)); restore(s); setAnnounce("Redone"); };

  const nameOf = (b: SketchRoom) => ((rooms.find((r) => r.label === b.label)?.count ?? 1) > 1 ? `${b.label} ${b.index + 1}` : b.label);
  const setRoom = (i: number, patch: Partial<RoomReq> | null, note: string) => {
    remember();
    onRooms(patch === null ? rooms.filter((_, j) => j !== i) : rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)), note);
    setAnnounce(note);
  };
  const addRoom = (label: string) => {
    const i = rooms.findIndex((r) => r.label === label);
    if (i >= 0) return setRoom(i, { count: rooms[i].count + 1 }, `Added another ${label}`);
    const p = pack.rooms.find((r) => r.label === label);
    remember();
    onRooms([...rooms, { label, count: 1, hard: false, ...(p?.minSqft ? { minSqft: p.minSqft } : {}), ...(p?.fixtures ? { fixtures: p.fixtures } : {}) }], `Added ${label}`);
    setAnnounce(`Added ${label}`);
  };
  const deleteRoom = (b: SketchRoom) => {
    const i = rooms.findIndex((r) => r.label === b.label);
    if (i < 0) return;
    const inside = furniture.filter((f) => roomOf(f, layout)?.key === b.key).map((f) => f.id);
    remember();
    if (inside.length) onFurniture(furniture.filter((f) => !inside.includes(f.id)));
    onRooms(rooms[i].count > 1 ? rooms.map((r, j) => (j === i ? { ...r, count: r.count - 1 } : r)) : rooms.filter((_, j) => j !== i), `Deleted ${nameOf(b)}`);
    setAnnounce(`Deleted ${nameOf(b)}`);
    setSel(null);
  };
  const deleteFurn = (f: Furn) => { remember(); onFurniture(furniture.filter((x) => x.id !== f.id)); setSel(null); setAnnounce(`Removed ${f.type}`); };
  const deleteSel = () => { if (selRoom) deleteRoom(selRoom); else if (selFurn) deleteFurn(selFurn); };

  const addFurn = (type: FurnType, at?: { x: number; y: number }) => {
    const spec = FURNITURE.find((f) => f.type === type)!;
    const host = at ? layout.find((r) => at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h) : selRoom ?? (selFurn ? roomOf(selFurn, layout) : undefined) ?? layout[0];
    const x = at ? at.x - spec.w / 2 : host ? host.x + Math.max(0.5, (host.w - spec.w) / 2) : 1;
    const y = at ? at.y - spec.h / 2 : host ? host.y + Math.max(2.2, (host.h - spec.h) / 2) : 1;
    const f: Furn = { id: furnId(), type, x: Math.max(0, x), y: Math.max(0, y), w: spec.w, h: spec.h };
    remember();
    onFurniture([...furniture, f]);
    setSel({ kind: "furn", key: f.id });
    setAnnounce(`Added a ${type}${host ? ` to ${nameOf(host)}` : ""}`);
    if (host && isFixture(type)) {
      const i = rooms.findIndex((r) => r.label === host.label);
      if (i >= 0 && !rooms[i].fixtures?.includes(type)) onRooms(rooms.map((r, j) => (j === i ? { ...r, fixtures: [...(r.fixtures ?? []), type] } : r)), `${host.label} needs a ${type}`);
    }
  };

  const toFt = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * (H + 4) };
  };
  const moveSel = (s: NonNullable<Sel>, dx: number, dy: number) => {
    remember();
    if (s.kind === "room") {
      const kids = furniture.filter((f) => roomOf(f, layout)?.key === s.key).map((f) => f.id);
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  };
  const startDrag = (e: React.PointerEvent, s: NonNullable<Sel>, x: number, y: number) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toFt(e.clientX, e.clientY);
    const kids = s.kind === "room" ? furniture.filter((f) => roomOf(f, layout)?.key === s.key).map((f) => ({ id: f.id, dx: f.x - x, dy: f.y - y })) : [];
    drag.current = { sel: s, dx: p.x - x, dy: p.y - y, kids, moved: false };
    setSel(s);
  };
  const onDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) { remember(); d.moved = true; }
    const p = toFt(e.clientX, e.clientY);
    const nx = Math.max(0, p.x - d.dx), ny = Math.max(0, p.y - d.dy);
    if (d.sel.kind === "room") {
      const rx = Math.round(nx), ry = Math.round(ny);
      onMove(layout.map((b) => (b.key === d.sel.key ? { ...b, x: rx, y: ry, pinned: true } : b)));
      if (d.kids.length) onFurniture(furniture.map((f) => { const k = d.kids.find((x) => x.id === f.id); return k ? { ...f, x: rx + k.dx, y: ry + k.dy } : f; }));
    } else onFurniture(furniture.map((f) => (f.id === d.sel.key ? { ...f, x: Math.round(nx * 2) / 2, y: Math.round(ny * 2) / 2 } : f)));
  };

  const palette = [...new Set([...pack.rooms.map((r) => r.label), "reception", "office", "storage", "kitchen", "bathroom", "conference", "lab", "waiting area"])];
  const bounds = layout.length ? { x: Math.min(...layout.map((r) => r.x)), y: Math.min(...layout.map((r) => r.y)), x2: Math.max(...layout.map((r) => r.x + r.w)), y2: Math.max(...layout.map((r) => r.y + r.h)) } : null;

  return (
    <section className="card sketch" aria-labelledby="sketch-title">
      <div className="tabs" role="tablist" aria-label="Layout">
        <button role="tab" type="button" aria-selected={tab === "sketch"} onClick={() => setTab("sketch")}><Layers aria-hidden="true" /> Build your layout</button>
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
              <ul>{designTips(pack, { wheelchair }).map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          </div>
          <div className="design-actions">
            <button type="button" className="btn primary" onClick={() => { remember(); onFurniture(furnishAll(layout)); setTab("sketch"); setAnnounce("Hermit furnished every room"); }}><Wand2 aria-hidden="true" /> Furnish every room for me</button>
            <button type="button" className="btn" onClick={() => { remember(); onMove(layout.map((b) => ({ ...b, pinned: false }))); onFurniture([]); setAnnounce("Tidied the layout"); }}><LayoutGrid aria-hidden="true" /> Tidy the layout</button>
            <button type="button" className="btn" onClick={() => { remember(); onFurniture([]); setAnnounce("Cleared all furniture"); }}><Trash2 aria-hidden="true" /> Clear furniture</button>
          </div>
          <p className="muted small">Furniture helps you picture the space and shows up in the guided tour. Sinks, toilets, showers and hoods also become requirements.</p>
        </div>
      ) : (
        <div className="studio-layout">
          <aside className="palette" aria-labelledby="blocks-title">
            <h3 id="blocks-title"><Layers aria-hidden="true" /> Room blocks</h3>
            <p className="palette-sub">Spaces <span>(tap or drag to add)</span></p>
            <div className="tiles">
              {palette.map((l) => { const I = ICON[l] ?? LayoutGrid; return (
                <button key={l} type="button" className="tile" draggable onDragStart={(e) => e.dataTransfer.setData("text/x-hermit-room", l)} onClick={() => addRoom(l)} aria-label={`Add ${l}`}><I aria-hidden="true" /> {l}</button>
              ); })}
            </div>
            <p className="palette-sub">Objects <span>(drop into a room)</span></p>
            <div className="tiles objects">
              {FURNITURE.map((f) => (
                <button key={f.type} type="button" className="tile obj" draggable onDragStart={(e) => e.dataTransfer.setData("text/x-hermit-obj", f.type)} onClick={() => addFurn(f.type)} aria-label={`Add ${f.type}${selRoom ? ` to ${nameOf(selRoom)}` : ""}`}>
                  <svg viewBox={`-0.4 -0.4 ${Math.max(f.w, f.h) + 0.8} ${Math.max(f.w, f.h) + 0.8}`} width={34} height={30} aria-hidden="true"><Furniture type={f.type} w={f.w} h={f.h} /></svg>
                  <span>{f.type}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="canvas-col">
            <div className="toolbar">
              <button type="button" className="btn small" onClick={undo} disabled={!past.length}><Undo2 aria-hidden="true" /> Undo</button>
              <button type="button" className="btn small" onClick={redo} disabled={!future.length}><Redo2 aria-hidden="true" /> Redo</button>
              {view === "plan" && <div className="zoom">
                <button type="button" onClick={() => setZoom((z) => Math.max(50, z - 25))} aria-label="Zoom out"><ZoomOut aria-hidden="true" /></button>
                <span className="num" aria-live="polite">{zoom}%</span>
                <button type="button" onClick={() => setZoom((z) => Math.min(200, z + 25))} aria-label="Zoom in"><ZoomIn aria-hidden="true" /></button>
              </div>}
              <div className="seg" role="group" aria-label="Sketch view">
                <button type="button" aria-pressed={view === "plan"} onClick={() => setView("plan")}><LayoutGrid aria-hidden="true" /> Plan</button>
                <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List aria-hidden="true" /> List</button>
              </div>
            </div>
            <div className="sel-bar" aria-live="polite">
              {box ? (
                <>
                  <span><strong>{selRoom ? nameOf(selRoom) : selFurn!.type}</strong>{selRoom ? ` · ${selRoom.w * selRoom.h} sf` : ""}</span>
                  {selRoom && <button type="button" className="btn small" onClick={() => addRoom(selRoom.label)}><Copy aria-hidden="true" /> Duplicate</button>}
                  <button type="button" className="btn small danger" onClick={deleteSel}><Trash2 aria-hidden="true" /> Delete</button>
                </>
              ) : <span className="muted">About <span className="num">{area.toLocaleString()}</span> sf of rooms. Tap anything to move or delete it.</span>}
            </div>

            {view === "plan" ? (
              <div className="sketch-canvas" style={{ backgroundSize: `${scale * 2}px ${scale * 2}px` }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const room = e.dataTransfer.getData("text/x-hermit-room"), obj = e.dataTransfer.getData("text/x-hermit-obj");
                  if (room) addRoom(room);
                  else if (obj) addFurn(obj as FurnType, toFt(e.clientX, e.clientY));
                }}>
                <svg ref={svg} viewBox={`0 0 ${W} ${H + 4}`} width={W * scale} height={(H + 4) * scale} role="group" style={{ touchAction: "none", maxWidth: zoom <= 100 ? "100%" : undefined, height: "auto" }}
                  aria-label={`Floor plan: ${layout.length} rooms and ${furniture.length} objects, about ${area} square feet. Each item is a button: arrow keys move it, Delete removes it, Ctrl+Z undoes.`}
                  onPointerMove={onDrag} onPointerUp={() => { drag.current = null; }} onPointerDown={(e) => { if (e.target === svg.current) setSel(null); }}>
                  {bounds && <>
                    <rect x={bounds.x - 0.5} y={bounds.y - 0.5} width={bounds.x2 - bounds.x + 1} height={bounds.y2 - bounds.y + 1} rx={1.2} fill="none" stroke="#6b4a3a" strokeWidth={0.9} />
                    <g transform={`translate(${(bounds.x + bounds.x2) / 2 - 3} ${bounds.y - 3.6})`} aria-hidden="true">
                      <path d="M0 3.6 V0.6 A3 3 0 0 1 3 3.6 Z M6 3.6 V0.6 A3 3 0 0 0 3 3.6 Z" fill="#fff" stroke="#6b4a3a" strokeWidth={0.25} />
                    </g>
                  </>}
                  {layout.map((b) => {
                    const s = { kind: "room" as const, key: b.key };
                    const on = sel?.kind === "room" && sel.key === b.key;
                    const I = ICON[b.label];
                    const withIcon = !!I && b.w >= 7;
                    const fs = Math.min(1.5, (b.w - (withIcon ? 2.4 : 1)) / (nameOf(b).length * 0.56));
                    return (
                      <g key={b.key} role="button" tabIndex={0} aria-pressed={on} aria-label={`${nameOf(b)}, ${b.w} by ${b.h} feet${b.fixtures.length ? `, needs ${b.fixtures.join(", ")}` : ""}`}
                        onFocus={() => setSel(s)} onKeyDown={(e) => keys(e, s)} onPointerDown={(e) => startDrag(e, s, b.x, b.y)} style={{ cursor: "grab" }}>
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={FILL[b.label] ?? "#f7efe9"} stroke={on ? "#c2410c" : "#6b4a3a"} strokeWidth={on ? 0.5 : 0.3} />
                        {withIcon && <g transform={`translate(${b.x + 0.5} ${b.y + 0.35}) scale(0.06)`} color="#d9573c"><I width={24} height={24} strokeWidth={2.2} /></g>}
                        <text x={b.x + (withIcon ? 2.2 : 0.5)} y={b.y + 1.5} fontSize={fs} fontWeight={800} fill="#3b2320">{nameOf(b)}</text>
                        <text x={b.x + 0.5} y={b.y + b.h - 0.5} fontSize={Math.min(1.15, (b.w - 1) / 6)} fill="#5b3d33">{b.w * b.h} sf{b.fixtures.length && b.w >= 10 ? ` · ${b.fixtures.join(", ")}` : ""}</text>
                        <path d={`M${b.x + b.w - 2.6} ${b.y + b.h} A2.2 2.2 0 0 1 ${b.x + b.w - 0.4} ${b.y + b.h - 2.2} V${b.y + b.h}`} fill="#fff" stroke="#6b4a3a" strokeWidth={0.15} aria-hidden="true" />
                      </g>
                    );
                  })}
                  {furniture.map((f) => {
                    const s = { kind: "furn" as const, key: f.id };
                    const on = sel?.kind === "furn" && sel.key === f.id;
                    const host = roomOf(f, layout);
                    return (
                      <g key={f.id} role="button" tabIndex={0} aria-pressed={on} aria-label={`${f.type}${host ? ` in ${nameOf(host)}` : ""}`} transform={`translate(${f.x} ${f.y})`}
                        onFocus={() => setSel(s)} onKeyDown={(e) => keys(e, s)} onPointerDown={(e) => startDrag(e, s, f.x, f.y)} style={{ cursor: "grab" }}>
                        <rect x={0} y={0} width={f.w} height={f.h} fill="transparent" />
                        <Furniture type={f.type} w={f.w} h={f.h} />
                        {on && <rect x={-0.25} y={-0.25} width={f.w + 0.5} height={f.h + 0.5} rx={0.3} fill="none" stroke="#c2410c" strokeWidth={0.2} strokeDasharray="0.5 0.3" />}
                      </g>
                    );
                  })}
                  {box && (
                    <g role="button" tabIndex={-1} aria-hidden="true" onPointerDown={(e) => { e.stopPropagation(); deleteSel(); }} style={{ cursor: "pointer" }} transform={`translate(${box.x + box.w - 0.2} ${box.y - 0.2})`}>
                      <circle r={1.1} fill="#b23a28" stroke="#fff" strokeWidth={0.2} />
                      <path d="M-0.45 -0.45 L0.45 0.45 M0.45 -0.45 L-0.45 0.45" stroke="#fff" strokeWidth={0.28} strokeLinecap="round" />
                    </g>
                  )}
                  <g transform={`translate(${bounds ? bounds.x : 0} ${H + 2})`} aria-hidden="true">
                    <line x1={0} x2={10} y1={0} y2={0} stroke="#3b2320" strokeWidth={0.25} />
                    <line x1={0} x2={0} y1={-0.6} y2={0.6} stroke="#3b2320" strokeWidth={0.25} /><line x1={10} x2={10} y1={-0.6} y2={0.6} stroke="#3b2320" strokeWidth={0.25} />
                    <text x={11} y={0.5} fontSize={1.3} fill="#3b2320">10 ft</text>
                  </g>
                </svg>
              </div>
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
          </div>
        </div>
      )}
    </section>
  );
}
