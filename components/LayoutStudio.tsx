"use client";
import {
  Archive, ArrowRight, Armchair, BedDouble, Car, Columns2, ConciergeBell, CookingPot, Expand, Layers, Monitor, Redo2, Shrink, Sofa,
  Sparkles, SquarePlus, Stethoscope, Toilet, Undo2, Users, UtensilsCrossed, WashingMachine, ZoomIn, ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { KEYS, load, save } from "@/lib/client/store";
import type { Block } from "@/lib/spec/parse";
import type { City, Mode } from "@/lib/types";
import { Plan3D, rectPoly, type Solid } from "./Plan3D";
import { SimilarScans } from "./SimilarScans";

type Item = Block & { kind: "room" | "object" };

const ROOMS: { type: string; label: string; Icon: typeof Stethoscope; w: number; h: number; fill: string }[] = [
  { type: "reception", label: "Reception", Icon: ConciergeBell, w: 16, h: 10, fill: "#fde3d4" },
  { type: "exam room", label: "Exam Room", Icon: Stethoscope, w: 12, h: 10, fill: "#dcefff" },
  { type: "office", label: "Office", Icon: Monitor, w: 10, h: 10, fill: "#e6f4e8" },
  { type: "hallway", label: "Hallway", Icon: Columns2, w: 6, h: 18, fill: "#fff1d6" },
  { type: "storage", label: "Storage", Icon: Archive, w: 8, h: 8, fill: "#ece6f6" },
  { type: "kitchen", label: "Kitchen", Icon: CookingPot, w: 10, h: 8, fill: "#fff0e0" },
  { type: "bathroom", label: "Bathroom", Icon: Toilet, w: 7, h: 8, fill: "#e3f4fb" },
  { type: "waiting area", label: "Waiting Area", Icon: Armchair, w: 12, h: 8, fill: "#fde3d4" },
  { type: "conference", label: "Conference Room", Icon: Users, w: 14, h: 12, fill: "#f3ecff" },
  { type: "procedure room", label: "Procedure Room", Icon: SquarePlus, w: 12, h: 12, fill: "#ffe5e5" },
  { type: "bedroom", label: "Bedroom", Icon: BedDouble, w: 12, h: 12, fill: "#e9e4fb" },
  { type: "living room", label: "Living Room", Icon: Sofa, w: 18, h: 14, fill: "#fde9d6" },
  { type: "dining room", label: "Dining Room", Icon: UtensilsCrossed, w: 12, h: 11, fill: "#fff0e0" },
  { type: "laundry", label: "Laundry", Icon: WashingMachine, w: 7, h: 7, fill: "#e3f4fb" },
  { type: "garage", label: "Garage", Icon: Car, w: 20, h: 20, fill: "#eceae6" },
];
const HOME_ROOMS = new Set(["bedroom", "living room", "dining room", "laundry", "garage"]);
// Drawn rooms decide the mode: any home-only room means a home search.
const modeOf = (labels: string[]): Mode => (labels.some((l) => HOME_ROOMS.has(l)) ? "home" : "business");
const OBJECT_HEIGHT: Record<string, number> = { chair: 3, stool: 2.2, table: 2.5, desk: 2.5, "reception desk": 3.5, sink: 3, counter: 3, kitchenette: 3, plant: 4, "exam bed": 2.8, shelf: 6, other: 2 };
const OBJECTS: { type: string; label: string; w: number; h: number }[] = [
  { type: "chair", label: "Chair", w: 3, h: 3 }, { type: "table", label: "Table", w: 5, h: 3 }, { type: "desk", label: "Desk", w: 5, h: 3 },
  { type: "sink", label: "Sink", w: 3, h: 3 }, { type: "counter", label: "Counter", w: 6, h: 2.5 }, { type: "kitchenette", label: "Kitchenette", w: 6, h: 3 },
  { type: "door", label: "Door", w: 3, h: 3 }, { type: "window", label: "Window", w: 4, h: 1.5 }, { type: "plant", label: "Plant", w: 2.5, h: 3 },
  { type: "other", label: "Other", w: 3, h: 3 },
];
const FILL = Object.fromEntries(ROOMS.map((r) => [r.type, r.fill]));
const TEMPLATE: Item[] = [
  { id: "t1", kind: "room", label: "reception", x: 4, y: 4, w: 52, h: 13 },
  { id: "t2", kind: "room", label: "exam room", x: 4, y: 17, w: 23, h: 10 },
  { id: "t3", kind: "room", label: "exam room", x: 4, y: 27, w: 23, h: 10 },
  { id: "t4", kind: "room", label: "hallway", x: 27, y: 17, w: 12, h: 20 },
  { id: "t5", kind: "room", label: "storage", x: 39, y: 17, w: 17, h: 20 },
  { id: "o1", kind: "object", label: "plant", x: 6, y: 6, w: 3, h: 4 },
  { id: "o2", kind: "object", label: "chair", x: 11, y: 10, w: 3, h: 3.5 },
  { id: "o3", kind: "object", label: "chair", x: 14.5, y: 10, w: 3, h: 3.5 },
  { id: "o4", kind: "object", label: "chair", x: 18, y: 10, w: 3, h: 3.5 },
  { id: "o5", kind: "object", label: "reception desk", x: 39, y: 8, w: 12, h: 5 },
  { id: "o6", kind: "object", label: "plant", x: 48.5, y: 5.5, w: 2.5, h: 3 },
  { id: "o7", kind: "object", label: "door", x: 26, y: 1, w: 7, h: 3.5 },
  { id: "o8", kind: "object", label: "exam bed", x: 6, y: 22, w: 9, h: 3 },
  { id: "o9", kind: "object", label: "stool", x: 17, y: 22.5, w: 2.5, h: 2.5 },
  { id: "o10", kind: "object", label: "sink", x: 22, y: 18.5, w: 3.5, h: 3 },
  { id: "o11", kind: "object", label: "exam bed", x: 6, y: 32, w: 9, h: 3 },
  { id: "o12", kind: "object", label: "stool", x: 17, y: 32.5, w: 2.5, h: 2.5 },
  { id: "o13", kind: "object", label: "sink", x: 22, y: 32.5, w: 3.5, h: 3 },
  { id: "o14", kind: "object", label: "door", x: 25, y: 21, w: 3, h: 3 },
  { id: "o15", kind: "object", label: "door", x: 25, y: 30, w: 3, h: 3 },
  { id: "o16", kind: "object", label: "door", x: 37, y: 30, w: 3, h: 3 },
  { id: "o17", kind: "object", label: "shelf", x: 49.5, y: 27.5, w: 5.5, h: 8 },
];
const TEMPLATES: Record<string, { label: string; items: Item[] }> = {
  clinic: { label: "Small clinic", items: TEMPLATE },
  office: { label: "Team office", items: [
    { id: "f1", kind: "room", label: "reception", x: 4, y: 4, w: 20, h: 14 },
    { id: "f2", kind: "room", label: "office", x: 24, y: 4, w: 12, h: 11 },
    { id: "f3", kind: "room", label: "office", x: 36, y: 4, w: 12, h: 11 },
    { id: "f4", kind: "room", label: "conference", x: 4, y: 18, w: 20, h: 14 },
    { id: "f5", kind: "room", label: "hallway", x: 24, y: 15, w: 24, h: 5 },
    { id: "f6", kind: "room", label: "kitchen", x: 24, y: 20, w: 12, h: 12 },
    { id: "f7", kind: "room", label: "bathroom", x: 36, y: 20, w: 8, h: 8 },
  ] },
  home: { label: "2-bed home", items: [
    { id: "h1", kind: "room", label: "living room", x: 4, y: 4, w: 20, h: 16 },
    { id: "h2", kind: "room", label: "kitchen", x: 24, y: 4, w: 12, h: 10 },
    { id: "h3", kind: "room", label: "dining room", x: 24, y: 14, w: 12, h: 10 },
    { id: "h4", kind: "room", label: "bedroom", x: 4, y: 20, w: 13, h: 13 },
    { id: "h5", kind: "room", label: "bedroom", x: 17, y: 24, w: 12, h: 12 },
    { id: "h6", kind: "room", label: "bathroom", x: 29, y: 24, w: 8, h: 8 },
    { id: "h7", kind: "room", label: "laundry", x: 29, y: 32, w: 7, h: 6 },
  ] },
  blank: { label: "Blank canvas", items: [] },
};
const PX = 14;

export function LayoutStudio({ onDone, doneLabel = "Analyze & match layout" }: { onDone: (items: Block[]) => void; doneLabel?: string }) {
  const [items, setItems] = useState<Item[]>(TEMPLATE);
  const [past, setPast] = useState<Item[][]>([]);
  const [future, setFuture] = useState<Item[][]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [snap, setSnap] = useState(true);
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [city, setCity] = useState<City>("houston");
  const drag = useRef<{ id: string; dx: number; dy: number; mode: "move" | "resize"; before: Item[] } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const scale = (PX * zoom) / 100;

  useEffect(() => {
    const prev = load<Item[]>(KEYS.layout);
    if (prev) setItems(prev);
  }, []);
  useEffect(() => { save(KEYS.layout, items); }, [items]);

  const commit = useCallback((next: Item[], before = items) => {
    setPast((p) => [...p.slice(-49), before]);
    setFuture([]);
    setItems(next);
  }, [items]);
  const undo = () => { const prev = past.at(-1); if (!prev) return; setFuture((f) => [items, ...f]); setPast((p) => p.slice(0, -1)); setItems(prev); };
  const redo = () => { const next = future[0]; if (!next) return; setPast((p) => [...p, items]); setFuture((f) => f.slice(1)); setItems(next); };

  const q = (v: number) => (snap ? Math.round(v) : Math.round(v * 4) / 4);
  const spec = (type: string) => ROOMS.find((r) => r.type === type) ?? OBJECTS.find((o) => o.type === type);
  const add = (type: string, x?: number, y?: number) => {
    const s = spec(type);
    if (!s) return;
    const kind = ROOMS.some((r) => r.type === type) ? "room" : "object";
    const id = `${kind[0]}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const bx = x ?? 20 + (items.length % 5) * 3, by = y ?? 14 + (items.length % 4) * 3;
    commit([...items, { id, kind, label: type, x: q(Math.max(0, bx - s.w / 2)), y: q(Math.max(0, by - s.h / 2)), w: s.w, h: s.h }]);
    setSel(id);
  };
  const toFt = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  const onKey = (e: React.KeyboardEvent, it: Item) => {
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, Partial<Item>> = {
      ArrowLeft: { x: it.x - step }, ArrowRight: { x: it.x + step }, ArrowUp: { y: it.y - step }, ArrowDown: { y: it.y + step },
      "+": { w: it.w + 1, h: it.h + 1 }, "=": { w: it.w + 1, h: it.h + 1 }, "-": { w: Math.max(2, it.w - 1), h: Math.max(2, it.h - 1) },
    };
    if (moves[e.key]) { e.preventDefault(); commit(items.map((x) => (x.id === it.id ? { ...x, ...moves[e.key], x: Math.max(0, (moves[e.key].x ?? x.x)), y: Math.max(0, (moves[e.key].y ?? x.y)) } : x))); }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); commit(items.filter((x) => x.id !== it.id)); setSel(null); }
    if (e.key === "Escape") setSel(null);
  };

  const rooms = items.filter((i) => i.kind === "room");
  const objects = items.filter((i) => i.kind === "object");
  const nameOf = (it: Item) => {
    const base = spec(it.label)?.label ?? it.label;
    const same = rooms.filter((r) => r.label === it.label);
    return same.length > 1 ? `${base} ${same.indexOf(it) + 1}` : base;
  };
  const W = Math.max(64, ...items.map((i) => i.x + i.w + 6)), H = Math.max(44, ...items.map((i) => i.y + i.h + 6));
  const bounds = rooms.length ? { x: Math.min(...rooms.map((r) => r.x)), y: Math.min(...rooms.map((r) => r.y)), x2: Math.max(...rooms.map((r) => r.x + r.w)), y2: Math.max(...rooms.map((r) => r.y + r.h)) } : null;
  const area = Math.round(rooms.reduce((s, r) => s + r.w * r.h, 0));

  // Linear scale about the plan's top-left corner; area changes by f².
  const rescale = (f: number) => {
    const ox = Math.min(...items.map((i) => i.x)), oy = Math.min(...items.map((i) => i.y));
    const r = (v: number) => Math.round(v * 2) / 2;
    commit(items.map((i) => ({ ...i, x: r(ox + (i.x - ox) * f), y: r(oy + (i.y - oy) * f), ...(i.kind === "room" ? { w: Math.max(2, r(i.w * f)), h: Math.max(2, r(i.h * f)) } : {}) })));
  };
  const mode = modeOf(rooms.map((r) => r.label));
  const solids: Solid[] = [
    ...rooms.map((r) => ({ id: r.id, label: nameOf(r), polygon: rectPoly(r), height: 9, fill: FILL[r.label] ?? "#f7efe9" })),
    ...objects.filter((o) => !["door", "window"].includes(o.label)).map((o) => ({ id: o.id, polygon: rectPoly(o), height: OBJECT_HEIGHT[o.label] ?? 2, fill: o.label === "plant" ? "#9bd18f" : "#fdeee2", cap: true })),
  ];

  return (
    <>
      <div className="layout-grid">
        <aside className="card palette" aria-labelledby="blocks-title">
          <h2 id="blocks-title"><Layers aria-hidden="true" /> Room blocks</h2>
          <h3>Spaces <span>(drag to add)</span></h3>
          <div className="tiles">
            {ROOMS.map((r) => (
              <button key={r.type} type="button" className="tile" draggable onDragStart={(e) => e.dataTransfer.setData("text/x-hermit", r.type)} onClick={() => add(r.type)} aria-label={`Add ${r.label}`}>
                <r.Icon aria-hidden="true" /> {r.label}
              </button>
            ))}
          </div>
          <hr />
          <h3>Objects <span>(drag to add)</span></h3>
          <div className="tiles objects">
            {OBJECTS.map((o) => (
              <button key={o.type} type="button" className="tile" draggable onDragStart={(e) => e.dataTransfer.setData("text/x-hermit", o.type)} onClick={() => add(o.type)} aria-label={`Add ${o.label}`}>
                <svg viewBox="0 0 40 34" width="38" height="32" aria-hidden="true"><ObjectArt type={o.type} w={40} h={34} /></svg>
                {o.label}
              </button>
            ))}
          </div>
        </aside>

        <section className="card canvas-card" aria-label="Layout canvas">
          <div className="toolbar">
            <button type="button" className="btn" onClick={undo} disabled={!past.length}><Undo2 aria-hidden="true" /> Undo</button>
            <button type="button" className="btn" onClick={redo} disabled={!future.length}><Redo2 aria-hidden="true" /> Redo</button>
            <span className="sep" aria-hidden="true" />
            <div className="zoom">
              <button type="button" onClick={() => setZoom((z) => Math.max(50, z - 25))} aria-label="Zoom out"><ZoomOut aria-hidden="true" /></button>
              <label className="sr-only" htmlFor="zoom">Zoom</label>
              <select id="zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
                {[50, 75, 100, 125, 150, 200].map((z) => <option key={z} value={z}>{z}%</option>)}
              </select>
              <button type="button" onClick={() => setZoom((z) => Math.min(200, z + 25))} aria-label="Zoom in"><ZoomIn aria-hidden="true" /></button>
            </div>
            <span className="sep" aria-hidden="true" />
            <button type="button" className="snap" role="switch" aria-checked={snap} onClick={() => setSnap((s) => !s)}>
              Snap to grid <span className="switch" aria-hidden="true" />
            </button>
          </div>
          <div className="toolbar">
            <div className="view-switch" role="group" aria-label="Canvas view" style={{ margin: 0 }}>
              <button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>2D plan</button>
              <button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}>3D model</button>
            </div>
            <span className="sep" aria-hidden="true" />
            <button type="button" className="btn small" onClick={() => rescale(0.9)} disabled={!rooms.length}><Shrink aria-hidden="true" /> Scale down</button>
            <button type="button" className="btn small" onClick={() => rescale(1.1)} disabled={!rooms.length}><Expand aria-hidden="true" /> Scale up</button>
            <span className="num muted" aria-live="polite">{area.toLocaleString()} sq ft</span>
            <span className="sep" aria-hidden="true" />
            <label className="start-from">Start from{" "}
              <select value="" onChange={(e) => { const t = TEMPLATES[e.target.value]; if (t) { commit(t.items); setSel(null); } }}>
                <option value="" disabled>Choose…</option>
                {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
              </select>
            </label>
          </div>
          {view === "3d" && <Plan3D solids={solids} label={`Your layout: ${rooms.length} rooms, about ${area.toLocaleString()} square feet`} height={520} wallScale={0.45} />}
          <p className="sr-only" id="canvas-help">Each room and object is a button. Arrow keys move it (Shift for 5 ft), plus and minus resize, Delete removes. You can also drag with a mouse or finger.</p>
          <div className="canvas" hidden={view === "3d"} style={{ backgroundSize: `${scale * 2}px ${scale * 2}px` }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const t = e.dataTransfer.getData("text/x-hermit"); if (!t) return; const p = toFt(e.clientX, e.clientY); add(t, p.x, p.y); }}>
            <svg ref={svg} className="plan" width={W * scale} height={H * scale} viewBox={`0 0 ${W} ${H}`} role="application" aria-describedby="canvas-help"
              aria-label={`Floor plan: ${rooms.length} rooms, ${objects.length} objects, about ${area.toLocaleString()} square feet`}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const p = toFt(e.clientX, e.clientY);
                setItems((xs) => xs.map((x) => (x.id !== d.id ? x : d.mode === "move" ? { ...x, x: Math.max(0, q(p.x - d.dx)), y: Math.max(0, q(p.y - d.dy)) } : { ...x, w: Math.max(3, q(p.x - x.x)), h: Math.max(3, q(p.y - x.y)) })));
              }}
              onPointerUp={() => { const d = drag.current; if (d) { setPast((p) => [...p.slice(-49), d.before]); setFuture([]); } drag.current = null; }}
              onPointerDown={(e) => { if (e.target === svg.current) setSel(null); }}>
              {bounds && <rect x={bounds.x - 0.4} y={bounds.y - 0.4} width={bounds.x2 - bounds.x + 0.8} height={bounds.y2 - bounds.y + 0.8} rx={1.4} fill="none" stroke="#6b4a3a" strokeWidth={0.9} />}
              {[...rooms, ...objects].map((it) => {
                const isSel = sel === it.id;
                const room = it.kind === "room";
                const Icon = room ? ROOMS.find((r) => r.type === it.label)?.Icon : null;
                const furnished = room && objects.some((o) => o.x >= it.x && o.x < it.x + it.w && o.y >= it.y && o.y < it.y + it.h && o.label !== "door");
                const ly = furnished && it.label !== "reception" ? it.y + 3.6 : it.y + it.h / 2 + 1.3;
                return (
                  <g key={it.id} tabIndex={0} role="button" aria-pressed={isSel} aria-label={`${room ? nameOf(it) : spec(it.label)?.label ?? it.label}, ${it.w} by ${it.h} feet`}
                    onFocus={() => setSel(it.id)} onKeyDown={(e) => onKey(e, it)} style={{ cursor: "grab", outline: "none" }}
                    onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); const p = toFt(e.clientX, e.clientY); drag.current = { id: it.id, dx: p.x - it.x, dy: p.y - it.y, mode: "move", before: items }; setSel(it.id); }}>
                    {room ? (
                      <>
                        <rect x={it.x} y={it.y} width={it.w} height={it.h} rx={0.6} fill={FILL[it.label] ?? "#f7efe9"} stroke={isSel ? "#f26a4b" : "#6b4a3a"} strokeWidth={isSel ? 0.45 : 0.3} />
                        {Icon && <g transform={`translate(${it.x + it.w / 2 - 1.2}, ${ly - 4.7}) scale(0.1)`} color="#d9573c"><Icon width={24} height={24} strokeWidth={2} /></g>}
                        <text x={it.x + it.w / 2} y={ly} textAnchor="middle" fontSize={1.45} fontWeight={800} fill="#3b2320">{nameOf(it)}</text>
                        {isSel && <rect x={it.x + it.w - 1.2} y={it.y + it.h - 1.2} width={1.6} height={1.6} rx={0.3} fill="#f26a4b" style={{ cursor: "nwse-resize" }}
                          onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { id: it.id, dx: 0, dy: 0, mode: "resize", before: items }; }} />}
                      </>
                    ) : (
                      <g transform={`translate(${it.x}, ${it.y})`}>
                        {isSel && <rect x={-0.3} y={-0.3} width={it.w + 0.6} height={it.h + 0.6} rx={0.4} fill="none" stroke="#f26a4b" strokeWidth={0.2} strokeDasharray="0.6 0.4" />}
                        <ObjectArt type={it.label} w={it.w} h={it.h} />
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </section>
      </div>
      <SimilarScans layout={rooms.map(({ label, x, y, w, h }) => ({ label, x, y, w, h }))} mode={mode} city={city} onCity={setCity} />
      <div className="layout-cta">
        <button type="button" className="cta" onClick={() => onDone(items)} disabled={!rooms.length}><Sparkles aria-hidden="true" /> {doneLabel} <ArrowRight aria-hidden="true" /></button>
      </div>
    </>
  );
}

// Small illustrated fixtures drawn in a w×h box (feet on the canvas, px in the palette).
function ObjectArt({ type, w, h }: { type: string; w: number; h: number }) {
  const s = Math.min(w, h);
  const stroke = "#6b4a3a", sw = s * 0.07, coral = "#f58a6b", wood = "#f6dcc4";
  switch (type) {
    case "chair":
      return <g><rect x={w * 0.15} y={h * 0.1} width={w * 0.7} height={h * 0.55} rx={s * 0.2} fill={coral} stroke={stroke} strokeWidth={sw} /><rect x={w * 0.1} y={h * 0.55} width={w * 0.8} height={h * 0.18} rx={s * 0.08} fill={coral} stroke={stroke} strokeWidth={sw} /><path d={`M${w * 0.22} ${h * 0.73} v${h * 0.22} M${w * 0.78} ${h * 0.73} v${h * 0.22}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "stool":
      return <g><ellipse cx={w / 2} cy={h * 0.25} rx={w * 0.35} ry={h * 0.13} fill="#fff" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} ${h * 0.35} V${h * 0.8} M${w * 0.2} ${h * 0.9} L${w / 2} ${h * 0.8} L${w * 0.8} ${h * 0.9}`} stroke={stroke} strokeWidth={sw} fill="none" /></g>;
    case "table":
      return <g><rect x={0} y={h * 0.15} width={w} height={h * 0.25} rx={s * 0.08} fill={wood} stroke={stroke} strokeWidth={sw} /><path d={`M${w * 0.12} ${h * 0.4} V${h * 0.95} M${w * 0.88} ${h * 0.4} V${h * 0.95}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "desk":
    case "reception desk":
      return <g><rect x={0} y={h * 0.35} width={w} height={h * 0.6} rx={s * 0.2} fill="#fde9d6" stroke={stroke} strokeWidth={sw} /><rect x={w * 0.35} y={h * 0.02} width={w * 0.3} height={h * 0.3} rx={s * 0.04} fill="#7a7a86" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} ${h * 0.32} v${h * 0.06}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "sink":
      return <g><rect x={w * 0.05} y={h * 0.3} width={w * 0.9} height={h * 0.62} rx={s * 0.12} fill="#e9eef2" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} ${h * 0.3} V${h * 0.08} H${w * 0.68}`} stroke={stroke} strokeWidth={sw} fill="none" /><path d={`M${w * 0.3} ${h * 0.55} H${w * 0.7}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "counter":
    case "kitchenette":
      return <g><rect x={0} y={0} width={w} height={h} rx={s * 0.12} fill="#fdeee2" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 3} 0 V${h} M${(2 * w) / 3} 0 V${h}`} stroke={stroke} strokeWidth={sw * 0.7} />{type === "kitchenette" && <circle cx={w / 6} cy={h / 2} r={s * 0.22} fill="#e9eef2" stroke={stroke} strokeWidth={sw * 0.7} />}</g>;
    case "door":
      return w > h * 1.6
        ? <g fill="#fff" stroke={stroke} strokeWidth={sw}><path d={`M0 ${h} V0 A${w / 2} ${h} 0 0 1 ${w / 2} ${h} Z`} /><path d={`M${w} ${h} V0 A${w / 2} ${h} 0 0 0 ${w / 2} ${h} Z`} /></g>
        : <path d={`M0 ${h} H${w} M0 ${h} V0 A${w} ${h} 0 0 1 ${w} ${h}`} fill="#fff" stroke={stroke} strokeWidth={sw} />;
    case "window":
      return <g><rect x={0} y={0} width={w} height={h} fill="#dff3fb" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} 0 V${h} M0 ${h / 2} H${w}`} stroke={stroke} strokeWidth={sw * 0.7} /></g>;
    case "plant":
      return <g><path d={`M${w * 0.25} ${h * 0.6} H${w * 0.75} L${w * 0.68} ${h} H${w * 0.32} Z`} fill={wood} stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} ${h * 0.6} C${w * 0.1} ${h * 0.45} ${w * 0.1} ${h * 0.15} ${w * 0.35} ${h * 0.05} C${w * 0.4} ${h * 0.3} ${w * 0.45} ${h * 0.45} ${w / 2} ${h * 0.6} C${w * 0.6} ${h * 0.3} ${w * 0.7} ${h * 0.1} ${w * 0.9} ${h * 0.12} C${w * 0.9} ${h * 0.4} ${w * 0.7} ${h * 0.55} ${w / 2} ${h * 0.6}`} fill="#7cc576" stroke="#4f8f4a" strokeWidth={sw * 0.6} /></g>;
    case "exam bed":
      return <g><rect x={0} y={h * 0.25} width={w} height={h * 0.35} rx={s * 0.12} fill="#fff" stroke={stroke} strokeWidth={sw} /><path d={`M${w * 0.02} ${h * 0.3} L${w * 0.3} ${h * 0.02} L${w * 0.36} ${h * 0.28}`} fill="#8ecae6" stroke={stroke} strokeWidth={sw} /><path d={`M${w * 0.1} ${h * 0.6} V${h} M${w * 0.9} ${h * 0.6} V${h}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "shelf":
      return <g fill="none" stroke={stroke} strokeWidth={sw * 0.6}><rect x={0} y={0} width={w} height={h} fill="#fff7ef" /><path d={`M0 ${h / 3} H${w} M0 ${(2 * h) / 3} H${w}`} /><rect x={w * 0.15} y={h * 0.1} width={w * 0.45} height={h * 0.2} fill="#f4c7a1" /><rect x={w * 0.1} y={h * 0.43} width={w * 0.35} height={h * 0.2} fill="#f4c7a1" /><rect x={w * 0.52} y={h * 0.43} width={w * 0.35} height={h * 0.2} fill="#f4c7a1" /></g>;
    default:
      return <g fill={stroke}>{[0.25, 0.5, 0.75].map((f) => <circle key={f} cx={w * f} cy={h / 2} r={s * 0.07} />)}</g>;
  }
}
