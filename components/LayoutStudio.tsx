"use client";
import {
  Archive, ArrowRight, Armchair, BedDouble, Box, Car, Columns2, ConciergeBell, CookingPot, Eraser, Maximize, Minus, Monitor, Plus, Sofa,
  Sparkles, SquarePlus, Stethoscope, Toilet, Trash2, Undo2, Users, UtensilsCrossed, WashingMachine,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { loadLayouts, putLayout, removeLayout, type SavedLayout } from "@/lib/client/layouts";
import { drop, KEYS, load, save } from "@/lib/client/store";
import { OBJECT_TYPES, ROOM_TYPES, roomType } from "@/lib/design/rooms";
import { BASE_Z, fit, pan, toFeet, zoomAt, type Camera } from "@/lib/geometry/camera";
import type { Block } from "@/lib/spec/parse";
import { Plan3D, rectPoly, type Solid } from "./Plan3D";
import { ObjectArt } from "./studio/ObjectArt";

type Item = Block & { kind: "room" | "object" };
type Use = "clinic" | "office" | "home";

const ICONS: Record<string, typeof Stethoscope> = {
  reception: ConciergeBell, "exam room": Stethoscope, office: Monitor, hallway: Columns2, storage: Archive, kitchen: CookingPot,
  bathroom: Toilet, "waiting area": Armchair, conference: Users, "procedure room": SquarePlus,
  bedroom: BedDouble, "living room": Sofa, dining: UtensilsCrossed, laundry: WashingMachine, garage: Car,
};
// The main amenities per use, in the order a first-time user reaches for them.
const AMENITIES: Record<Use, { rooms: string[]; things: string[] }> = {
  clinic: {
    rooms: ["reception", "waiting area", "exam room", "procedure room", "office", "bathroom", "storage", "kitchen", "hallway"],
    things: ["door", "window", "reception desk", "chair", "exam bed", "stool", "sink", "desk", "shelf", "plant"],
  },
  office: {
    rooms: ["reception", "office", "conference", "kitchen", "bathroom", "storage", "waiting area", "hallway"],
    things: ["door", "window", "desk", "chair", "table", "reception desk", "counter", "shelf", "sink", "plant"],
  },
  home: {
    rooms: ["living room", "kitchen", "dining", "bedroom", "bathroom", "office", "laundry", "storage", "garage", "hallway"],
    things: ["door", "window", "table", "chair", "desk", "sink", "toilet", "shower", "shelf", "plant"],
  },
};
// Where a piece of furniture naturally goes when it's added with one tap.
const HOME_ROOM: Record<string, string[]> = {
  "exam bed": ["exam room", "procedure room"], stool: ["exam room", "procedure room"], "reception desk": ["reception", "waiting area"],
  toilet: ["bathroom"], shower: ["bathroom"], sink: ["bathroom", "kitchen", "exam room"], desk: ["office", "reception"],
  table: ["conference", "dining", "kitchen"], counter: ["kitchen", "reception"], kitchenette: ["kitchen"], chair: ["waiting area", "reception", "conference", "office"],
};
const HOME_ONLY = new Set(["bedroom", "living room", "dining", "laundry", "garage"]);
const OBJECT_HEIGHT: Record<string, number> = { chair: 3, stool: 2.2, table: 2.5, desk: 2.5, "reception desk": 3.5, sink: 3, counter: 3, kitchenette: 3, plant: 4, "exam bed": 2.8, shelf: 6, toilet: 2.5, shower: 7, other: 2 };
const FILL = Object.fromEntries(ROOM_TYPES.map((r) => [r.type, r.fill]));
const typeOf = (label: string) => roomType(label) ?? label;
const fillOf = (label: string) => FILL[typeOf(label)] ?? "#f7efe9";
const roomSpec = (type: string) => ROOM_TYPES.find((r) => r.type === type);
const objSpec = (type: string) => OBJECT_TYPES.find((o) => o.type === type);
const roomLabel = (type: string, use: Use) => (type === "bathroom" && use !== "home" ? "Restroom" : roomSpec(type)?.label ?? type);

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
  { id: "o7", kind: "object", label: "door", x: 26, y: 1, w: 7, h: 3.5 },
  { id: "o8", kind: "object", label: "exam bed", x: 6, y: 22, w: 9, h: 3 },
  { id: "o10", kind: "object", label: "sink", x: 22, y: 18.5, w: 3.5, h: 3 },
  { id: "o11", kind: "object", label: "exam bed", x: 6, y: 32, w: 9, h: 3 },
  { id: "o13", kind: "object", label: "sink", x: 22, y: 32.5, w: 3.5, h: 3 },
  { id: "o14", kind: "object", label: "door", x: 25, y: 21, w: 3, h: 3 },
  { id: "o15", kind: "object", label: "door", x: 25, y: 30, w: 3, h: 3 },
  { id: "o17", kind: "object", label: "shelf", x: 49.5, y: 27.5, w: 5.5, h: 8 },
];
const STARTERS: { label: string; items: Item[] }[] = [
  { label: "Small clinic", items: TEMPLATE },
  { label: "Team office", items: [
    { id: "f1", kind: "room", label: "reception", x: 4, y: 4, w: 20, h: 14 },
    { id: "f2", kind: "room", label: "office", x: 24, y: 4, w: 12, h: 11 },
    { id: "f3", kind: "room", label: "office", x: 36, y: 4, w: 12, h: 11 },
    { id: "f4", kind: "room", label: "conference", x: 4, y: 18, w: 20, h: 14 },
    { id: "f5", kind: "room", label: "hallway", x: 24, y: 15, w: 24, h: 5 },
    { id: "f6", kind: "room", label: "kitchen", x: 24, y: 20, w: 12, h: 12 },
    { id: "f7", kind: "room", label: "bathroom", x: 36, y: 20, w: 8, h: 8 },
  ] },
  { label: "2-bed home", items: [
    { id: "h1", kind: "room", label: "living room", x: 4, y: 4, w: 20, h: 16 },
    { id: "h2", kind: "room", label: "kitchen", x: 24, y: 4, w: 12, h: 10 },
    { id: "h3", kind: "room", label: "dining", x: 24, y: 14, w: 12, h: 10 },
    { id: "h4", kind: "room", label: "bedroom", x: 4, y: 20, w: 13, h: 13 },
    { id: "h5", kind: "room", label: "bedroom", x: 17, y: 24, w: 12, h: 12 },
    { id: "h6", kind: "room", label: "bathroom", x: 29, y: 24, w: 8, h: 8 },
    { id: "h7", kind: "room", label: "laundry", x: 29, y: 32, w: 7, h: 6 },
  ] },
];

const norm = (bs: Block[]): Item[] => bs.map((b) => ({ ...b, kind: b.kind ?? "room" }));
// Order and ids don't count: the host re-keys rooms ("label#i") and regroups objects when it stores the sketch.
const sig = (bs: Block[]) => bs.map((b) => `${b.kind ?? "room"}|${b.label}|${b.x}|${b.y}|${b.w}|${b.h}`).sort().join(";");
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: Block) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const boxOf = (bs: Block[]) => bs.length ? { x: Math.min(...bs.map((i) => i.x)), y: Math.min(...bs.map((i) => i.y)), x2: Math.max(...bs.map((i) => i.x + i.w)), y2: Math.max(...bs.map((i) => i.y + i.h)) } : null;
const uid = (kind: string) => `${kind[0]}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// Free spot that grows the plan's footprint least: fills gaps first, then packs against the right or bottom edge.
export function roomSpot(rooms: Block[], w: number, h: number) {
  const b = boxOf(rooms);
  if (!b) return { x: 4, y: 4 };
  let best = { x: Math.round(b.x2), y: Math.round(b.y) }, cost = Infinity;
  for (let y = Math.floor(b.y); y <= Math.ceil(b.y2); y++) {
    for (let x = Math.floor(b.x); x <= Math.ceil(b.x2); x++) {
      if (rooms.some((r) => overlaps({ x, y, w, h }, r))) continue;
      const c = (Math.max(b.x2, x + w) - Math.min(b.x, x)) * (Math.max(b.y2, y + h) - Math.min(b.y, y)) + (x + y) * 1e-3;
      if (c < cost) { cost = c; best = { x, y }; }
    }
  }
  return best;
}

export function objectSpot(room: Block, objects: Block[], w: number, h: number) {
  for (let y = room.y + 0.5; y + h <= room.y + room.h - 0.5; y += 0.5) {
    for (let x = room.x + 0.5; x + w <= room.x + room.w - 0.5; x += 0.5) {
      if (!objects.some((o) => overlaps({ x, y, w, h }, o))) return { x, y };
    }
  }
  return null;
}

// inline: the editor is the page's main pane (no modal chrome, no done button) and reports every edit through onChange.
export function LayoutStudio({ onDone, doneLabel = "Use this layout", initial, inline, onChange, useType }: {
  onDone: (items: Block[]) => void; doneLabel?: string; initial?: Block[]; inline?: boolean; onChange?: (items: Block[]) => void; useType?: string;
}) {
  const seeded = !!initial?.length;
  const [items, setItems] = useState<Item[]>(seeded ? norm(initial!) : inline ? [] : TEMPLATE);
  const [past, setPast] = useState<Item[][]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [tab, setTab] = useState<"rooms" | "things">("rooms");
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, z: BASE_Z });
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const drag = useRef<
    | { mode: "move" | "resize"; id: string; dx: number; dy: number; before: Item[]; live: Item[]; moved: boolean }
    | { mode: "pan"; sx: number; sy: number; from: Camera }
    | null
  >(null);
  const svg = useRef<SVGSVGElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const helpId = useId(), namesId = useId();
  const current = useRef(items);
  useEffect(() => { current.current = items; }, [items]);

  // Saved layouts are a modal-only feature; inline, the host owns the layout.
  const [loaded, setLoaded] = useState(false);
  const [library, setLibrary] = useState<SavedLayout[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const stored = !inline && !seeded;
  useEffect(() => {
    if (!inline) {
      const prev = load<Item[]>(KEYS.layout);
      if (prev && !seeded) setItems(prev);
      const all = loadLayouts();
      const open = all.find((l) => l.id === load<string>(KEYS.layoutOpen));
      if (open) { setOpenId(open.id); setName(open.name); }
      setLibrary(all);
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (loaded && stored) save(KEYS.layout, items); }, [items, loaded, stored]);

  const rooms = items.filter((i) => i.kind === "room");
  const objects = items.filter((i) => i.kind === "object");
  const types = rooms.map((r) => typeOf(r.label));
  const home = useType ? /home|house|apartment|condo/.test(useType) : types.some((t) => HOME_ONLY.has(t));
  const use: Use = home ? "home"
    : /clinic|medical|dental|doctor|practice|therap|vet/.test(useType ?? "") || types.some((t) => t === "exam room" || t === "procedure room") ? "clinic"
    : "office";
  const area = Math.round(rooms.reduce((s, r) => s + r.w * r.h, 0));

  const frame = useCallback((its: Item[]) => {
    const el = canvas.current;
    if (el) setCam(fit(boxOf(its), el.clientWidth, el.clientHeight));
  }, []);
  const replace = useCallback((next: Item[]) => { setItems(next); setPast([]); setSel(null); frame(next); }, [frame]);

  // Chat (or anything outside) changed the layout: take it, without echoing it back through onChange.
  useEffect(() => {
    if (!initial || (!inline && !initial.length)) return;
    if (sig(initial) !== sig(current.current)) replace(norm(initial));
  }, [initial, inline, replace]);

  const commit = (next: Item[], before = items) => {
    setPast((p) => [...p.slice(-49), before]);
    setItems(next);
    onChange?.(next);
  };
  const undo = () => {
    const prev = past.at(-1);
    if (!prev) return;
    setPast((p) => p.slice(0, -1)); setItems(prev); setSel(null); onChange?.(prev);
  };
  const clear = () => { if (items.length) { commit([]); setSel(null); } };

  const inView = (b: Block) => {
    if (!vp.w) return true;
    return b.x >= cam.x && b.y >= cam.y && b.x + b.w <= cam.x + vp.w / cam.z && b.y + b.h <= cam.y + vp.h / cam.z;
  };
  const add = (type: string) => {
    const r = roomSpec(type);
    let it: Item;
    if (r) {
      it = { id: uid("room"), kind: "room", label: type, w: r.w, h: r.h, ...roomSpot(rooms, r.w, r.h) };
    } else {
      const o = objSpec(type) ?? { w: 3, h: 3 };
      const picked = items.find((i) => i.id === sel);
      const selRoom = picked?.kind === "room" ? picked : picked && rooms.find((rm) => overlaps(picked, rm));
      const wanted = HOME_ROOM[type] ?? [];
      const order = [
        ...(selRoom ? [selRoom] : []),
        ...rooms.filter((rm) => wanted.includes(typeOf(rm.label))),
        ...[...rooms].sort((a, b) => b.w * b.h - a.w * a.h),
      ];
      let spot: { x: number; y: number } | null = null;
      for (const rm of order) if ((spot = objectSpot(rm, objects, o.w, o.h))) break;
      const b = boxOf(rooms);
      it = { id: uid("object"), kind: "object", label: type, w: o.w, h: o.h, ...(spot ?? (b ? { x: Math.ceil(b.x2) + 2, y: Math.floor(b.y) } : { x: 4, y: 4 })) };
    }
    const next = [...items, it];
    commit(next);
    setSel(it.id);
    if (!inView(it)) frame(next);
  };

  const patch = (id: string, p: Partial<Item>) => commit(items.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const remove = (id: string) => { commit(items.filter((x) => x.id !== id)); setSel(null); };
  const rename = (id: string, label: string) => {
    const it = items.find((x) => x.id === id);
    const typed = label.trim();
    // Keep the user's words; icon, colour and tile set resolve the type via roomType().
    if (it && typed && typed !== it.label && typed !== nameOf(it)) patch(id, { label: typed });
  };

  const toFt = (clientX: number, clientY: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return toFeet(cam, clientX - r.left, clientY - r.top);
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.mode !== "pan" && d.moved && sig(d.before) !== sig(d.live)) { setPast((p) => [...p.slice(-49), d.before]); setItems(d.live); onChange?.(d.live); }
  };
  const zoomBy = (f: number) => setCam((c) => zoomAt(c, f, vp.w / 2, vp.h / 2));

  const onKey = (e: React.KeyboardEvent) => {
    if (view === "3d" || (e.target as HTMLElement).closest("input, select, textarea")) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    const it = items.find((x) => x.id === sel);
    if (it && svg.current?.contains(e.target as Node)) {
      const step = e.shiftKey ? 5 : 1;
      const moves: Record<string, Partial<Item>> = {
        ArrowLeft: { x: Math.max(0, it.x - step) }, ArrowRight: { x: it.x + step }, ArrowUp: { y: Math.max(0, it.y - step) }, ArrowDown: { y: it.y + step },
        "+": { w: it.w + 1, h: it.h + 1 }, "=": { w: it.w + 1, h: it.h + 1 }, "-": { w: Math.max(1, it.w - 1), h: Math.max(1, it.h - 1) },
      };
      if (moves[e.key]) { e.preventDefault(); patch(it.id, moves[e.key]); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(it.id); svg.current?.focus(); return; }
      if (e.key === "Escape") { e.stopPropagation(); setSel(null); svg.current?.focus(); return; }
    }
    if (e.target !== svg.current) return;
    const step = e.shiftKey ? 200 : 40;
    const pans: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (pans[e.key]) { e.preventDefault(); setCam((c) => pan(c, ...pans[e.key])); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.25); }
    else if (e.key === "-") { e.preventDefault(); zoomBy(0.8); }
    else if (e.key === "0") { e.preventDefault(); frame(items); }
  };

  // Viewport: track its size, frame the layout once it's known, and take trackpad scroll/pinch for the canvas.
  const framed = useRef(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (loaded && vp.w && !framed.current) { framed.current = true; frame(current.current); } }, [loaded, vp.w, frame]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Inline, a plain scroll belongs to the page; the plan zooms only on pinch or Ctrl/Cmd+scroll.
      if (inline && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const k = e.deltaMode === 1 ? 16 : 1;
      // Trackpad pinch arrives as ctrl+wheel in Chrome/Firefox; Cmd/Ctrl+scroll zooms with a mouse.
      if (e.ctrlKey || e.metaKey) setCam((c) => zoomAt(c, Math.exp(-e.deltaY * k * 0.01), e.clientX - r.left, e.clientY - r.top));
      else setCam((c) => pan(c, e.deltaX * k, e.deltaY * k));
    };
    // Safari reports trackpad pinch as gesture events instead.
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    let last = 1;
    const onStart = (e: Event) => { e.preventDefault(); last = 1; };
    const onGesture = (e: Event) => {
      e.preventDefault();
      const g = e as Gesture, r = el.getBoundingClientRect();
      setCam((c) => zoomAt(c, g.scale / last, g.clientX - r.left, g.clientY - r.top));
      last = g.scale;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onStart);
    el.addEventListener("gesturechange", onGesture);
    return () => { el.removeEventListener("wheel", onWheel); el.removeEventListener("gesturestart", onStart); el.removeEventListener("gesturechange", onGesture); };
  }, [inline]);

  const nameOf = (it: Item) => {
    if (it.kind === "object") return objSpec(it.label)?.label ?? it.label;
    const t = roomType(it.label);
    const base = t && (t === it.label || roomSpec(t)?.label.toLowerCase() === it.label) ? roomLabel(t, use)
      : it.label === it.label.toLowerCase() ? it.label.replace(/\b\w/g, (c) => c.toUpperCase()) : it.label;
    const same = rooms.filter((r) => r.label === it.label);
    return same.length > 1 ? `${base} ${same.indexOf(it) + 1}` : base;
  };
  const sqft = (it: Block) => Math.round(it.w * it.h);
  const selected = items.find((x) => x.id === sel);

  const solids: Solid[] = [
    ...rooms.map((r) => ({ id: r.id, label: nameOf(r), polygon: rectPoly(r), height: 9, fill: fillOf(r.label) })),
    ...objects.filter((o) => !["door", "window"].includes(o.label)).map((o) => ({ id: o.id, polygon: rectPoly(o), height: OBJECT_HEIGHT[o.label] ?? 2, fill: o.label === "plant" ? "#9bd18f" : "#fdeee2", cap: true })),
  ];

  const set = AMENITIES[use];
  const moreRooms = ROOM_TYPES.filter((r) => r.palette && !set.rooms.includes(r.type));
  const roomTile = (type: string) => {
    const Icon = ICONS[type] ?? SquarePlus;
    const label = roomLabel(type, use);
    return (
      <button key={type} type="button" className="ls-tile" onClick={() => add(type)} aria-label={`Add ${label}`}>
        <Icon aria-hidden="true" /><span>{label}</span>
      </button>
    );
  };

  // Modal-only: the saved-layouts library.
  const store = () => {
    const id = putLayout({ id: openId ?? undefined, name, items });
    const all = loadLayouts();
    const saved = all.find((l) => l.id === id);
    if (!saved) return setStatus("Couldn't save: this browser is blocking site storage.");
    setOpenId(id); setName(saved.name); setLibrary(all); save(KEYS.layoutOpen, id);
    setStatus(`Saved “${saved.name}”.`);
  };
  const openSaved = (l: SavedLayout) => { replace(norm(l.items)); setOpenId(l.id); setName(l.name); save(KEYS.layoutOpen, l.id); setStatus(`Opened “${l.name}”.`); };
  const removeSaved = (l: SavedLayout) => {
    removeLayout(l.id); setLibrary(loadLayouts());
    if (l.id === openId) { setOpenId(null); drop(KEYS.layoutOpen); }
    setStatus(`Deleted “${l.name}”.`);
  };

  return (
    <div className={`ls${inline ? " ls-inline" : ""}`} onKeyDown={onKey}>
      <div className="ls-palette" role="group" aria-label="Add to your layout">
        <div className="view-switch ls-tabs" role="group" aria-label="What to add">
          <button type="button" aria-pressed={tab === "rooms"} onClick={() => setTab("rooms")}>Rooms</button>
          <button type="button" aria-pressed={tab === "things"} onClick={() => setTab("things")}>Furniture</button>
        </div>
        <p className="ls-hint">Tap to add. Drag to move. Pull the corner to resize.</p>
        {tab === "rooms" ? (
          <>
            <div className="ls-tiles">{set.rooms.map(roomTile)}</div>
            {moreRooms.length > 0 && (
              <details className="ls-more">
                <summary>More rooms</summary>
                <div className="ls-tiles">{moreRooms.map((r) => roomTile(r.type))}</div>
              </details>
            )}
          </>
        ) : (
          <div className="ls-tiles">
            {set.things.map((t) => {
              const label = objSpec(t)?.label ?? t;
              return (
                <button key={t} type="button" className="ls-tile" onClick={() => add(t)} aria-label={`Add ${label}`}>
                  <svg viewBox="0 0 40 34" aria-hidden="true"><ObjectArt type={t} w={40} h={34} /></svg><span>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="ls-bar">
        <button type="button" className="btn small" onClick={undo} disabled={!past.length}><Undo2 aria-hidden="true" /> Undo</button>
        <button type="button" className="btn small" onClick={clear} disabled={!items.length}><Eraser aria-hidden="true" /> Clear</button>
        <div className="view-switch ls-view" role="group" aria-label="View">
          <button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>2D</button>
          <button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")}><Box aria-hidden="true" /> 3D</button>
        </div>
        <span className="ls-total" aria-live="polite">{area ? `About ${area.toLocaleString()} sq ft` : "No rooms yet"}</span>
      </div>

      {view === "3d" && <Plan3D solids={solids} label={`Your layout: ${rooms.length} rooms, about ${area.toLocaleString()} square feet`} height={inline ? 420 : 520} wallScale={0.45} />}
      <p className="sr-only" id={helpId}>Each room and piece of furniture is a button. Arrow keys move the selected one (Shift for 5 feet), plus and minus resize, Delete removes, Escape deselects. Drag with a mouse or finger to move; drag the corner square to resize.{inline ? " Drag empty space to look around; pinch or Ctrl/Cmd + scroll to zoom." : " Scroll or drag empty space to look around; pinch or Ctrl+scroll to zoom."}</p>
      <div className="canvas ls-canvas" ref={canvas} hidden={view === "3d"} style={{ backgroundSize: `${cam.z * 2}px ${cam.z * 2}px`, backgroundPosition: `${-cam.x * cam.z}px ${-cam.y * cam.z}px` }}>
        <svg ref={svg} className="plan" width="100%" height="100%" viewBox={`${cam.x} ${cam.y} ${Math.max(1, vp.w) / cam.z} ${Math.max(1, vp.h) / cam.z}`} preserveAspectRatio="xMinYMin meet"
          role="application" aria-describedby={helpId} tabIndex={0}
          aria-label={`Floor plan: ${rooms.length} rooms, about ${area.toLocaleString()} square feet`}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (d.mode === "pan") { setCam({ ...d.from, x: d.from.x - (e.clientX - d.sx) / d.from.z, y: d.from.y - (e.clientY - d.sy) / d.from.z }); return; }
            d.moved = true;
            const p = toFt(e.clientX, e.clientY);
            // The live result lives on the drag so pointer-up emits the last move even before it renders.
            d.live = d.live.map((x) => {
              if (x.id !== d.id) return x;
              // Rooms snap to whole feet, furniture to half feet.
              const q = (v: number) => (x.kind === "room" ? Math.round(v) : Math.round(v * 2) / 2);
              const min = x.kind === "room" ? 3 : 1;
              return d.mode === "move" ? { ...x, x: Math.max(0, q(p.x - d.dx)), y: Math.max(0, q(p.y - d.dy)) } : { ...x, w: Math.max(min, q(p.x - x.x)), h: Math.max(min, q(p.y - x.y)) };
            });
            setItems(d.live);
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerDown={(e) => {
            if (e.target !== svg.current) return;
            setSel(null);
            svg.current.setPointerCapture?.(e.pointerId);
            drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, from: cam };
          }}>
          {[...rooms, ...objects].map((it) => {
            const isSel = sel === it.id;
            const room = it.kind === "room";
            const Icon = room ? ICONS[typeOf(it.label)] : null;
            const fs = Math.max(0.9, Math.min(1.6, it.w / 7));
            const cy = it.y + it.h / 2;
            const hs = room ? 1.6 : Math.min(1, it.w / 2, it.h / 2);
            return (
              <g key={it.id} tabIndex={0} role="button" aria-pressed={isSel} aria-label={room ? `${nameOf(it)}, about ${sqft(it)} square feet` : nameOf(it)}
                className="ls-item" onFocus={() => setSel(it.id)}
                onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); const p = toFt(e.clientX, e.clientY); drag.current = { mode: "move", id: it.id, dx: p.x - it.x, dy: p.y - it.y, before: items, live: items, moved: false }; setSel(it.id); }}>
                {room ? (
                  <>
                    <rect x={it.x} y={it.y} width={it.w} height={it.h} rx={0.6} fill={fillOf(it.label)} stroke={isSel ? "#f26a4b" : "#6b4a3a"} strokeWidth={isSel ? 0.5 : 0.3} />
                    {Icon && it.h >= 7 && <g transform={`translate(${it.x + it.w / 2 - 1.2}, ${cy - fs - 3}) scale(0.1)`} color="#d9573c"><Icon width={24} height={24} strokeWidth={2} /></g>}
                    <text x={it.x + it.w / 2} y={cy} textAnchor="middle" fontSize={fs} fontWeight={800} fill="#3b2320" pointerEvents="none">{nameOf(it)}</text>
                    <text x={it.x + it.w / 2} y={cy + fs * 1.3} textAnchor="middle" fontSize={fs * 0.8} fill="#6b5751" pointerEvents="none">{sqft(it)} sq ft</text>
                  </>
                ) : (
                  <g transform={`translate(${it.x}, ${it.y})`}>
                    <rect x={0} y={0} width={it.w} height={it.h} fill="transparent" />
                    {isSel && <rect x={-0.3} y={-0.3} width={it.w + 0.6} height={it.h + 0.6} rx={0.4} fill="none" stroke="#f26a4b" strokeWidth={0.2} strokeDasharray="0.6 0.4" />}
                    <ObjectArt type={it.label} w={it.w} h={it.h} />
                  </g>
                )}
                {isSel && <rect x={it.x + it.w - hs * 0.75} y={it.y + it.h - hs * 0.75} width={hs} height={hs} rx={hs * 0.2} fill="#f26a4b" stroke="#fff" strokeWidth={0.15} style={{ cursor: "nwse-resize" }}
                  onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { mode: "resize", id: it.id, dx: 0, dy: 0, before: items, live: items, moved: false }; }} />}
              </g>
            );
          })}
        </svg>
        {!items.length && (
          <div className="ls-empty">
            <p><strong>Start your layout.</strong> Tap a room above, or begin with one of these:</p>
            <div>{STARTERS.map((s) => <button key={s.label} type="button" className="btn small" onClick={() => { commit(s.items); frame(s.items); }}>{s.label}</button>)}</div>
          </div>
        )}
        <div className="ls-zoom">
          <button type="button" className="icon-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in"><Plus aria-hidden="true" /></button>
          <button type="button" className="icon-btn" onClick={() => zoomBy(0.8)} aria-label="Zoom out"><Minus aria-hidden="true" /></button>
          <button type="button" className="icon-btn" onClick={() => frame(items)} aria-label="Fit the whole layout"><Maximize aria-hidden="true" /></button>
        </div>
      </div>

      {selected && view === "2d" && (
        <div className="ls-selected" role="group" aria-label={`Selected: ${nameOf(selected)}`}>
          {selected.kind === "room" ? (
            <>
              <label className="ls-name">Name
                <input key={`${selected.id}:${selected.label}`} className="control" defaultValue={nameOf(selected)} list={namesId} maxLength={40}
                  onBlur={(e) => rename(selected.id, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
              </label>
              <datalist id={namesId}>{ROOM_TYPES.map((r) => <option key={r.type} value={r.label} />)}</datalist>
              <span className="ls-size">{sqft(selected)} sq ft</span>
            </>
          ) : <strong>{nameOf(selected)}</strong>}
          <button type="button" className="btn small" onClick={() => { remove(selected.id); svg.current?.focus(); }}><Trash2 aria-hidden="true" /> Delete</button>
        </div>
      )}

      {!inline && (
        <>
          <div className="toolbar file-bar">
            <label className="sr-only" htmlFor="layout-name">Layout name</label>
            <input id="layout-name" className="control" placeholder="Untitled layout" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <button type="button" className="btn" onClick={store} disabled={!rooms.length}>Save layout</button>
            <p className="muted file-status" role="status">{status}</p>
          </div>
          {library.length > 0 && (
            <section className="card panel layout-library" aria-labelledby="library-title">
              <h2 id="library-title">Your layouts</h2>
              <ul className="layout-list">
                {library.map((l) => (
                  <li key={l.id} aria-current={l.id === openId ? "true" : undefined}>
                    <span><strong>{l.name}</strong></span>
                    <button type="button" className="btn small" onClick={() => openSaved(l)} aria-label={`Open ${l.name}`}>Open</button>
                    <button type="button" className="btn small" onClick={() => removeSaved(l)} aria-label={`Delete ${l.name}`}><Trash2 aria-hidden="true" /> Delete</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="layout-cta">
            <button type="button" className="cta" onClick={() => onDone(items)} disabled={!rooms.length}><Sparkles aria-hidden="true" /> {doneLabel} <ArrowRight aria-hidden="true" /></button>
          </div>
        </>
      )}
    </div>
  );
}
