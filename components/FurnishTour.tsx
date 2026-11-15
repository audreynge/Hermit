"use client";
// The 3D tour as the stage, with a bottom tray (suggested / placed / search) and a toolbar for the selected item.
// Drag items to move them; drag cards from the tray into the room to place them. Falls back (onFail) to the plain
// iframe tour when the SDK can't start.
import type { MpSdk } from "@matterport/webcomponent";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info, Layers, Loader, LocateFixed, Palette, RefreshCw, Ruler, RotateCcw, RotateCw, Search, Send, Sofa, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { load, save } from "@/lib/client/store";
import { COLORS, ftIn, MATERIAL_NAMES, type FurnishItem, type Size } from "@/lib/furnish/catalog";
import { fitModel } from "@/lib/furnish/fit";
import { applyFurnishOps, dimensionLines, dims, fromMeasurement, hitItem, roomAt, settle, underCeiling, type Model, type Placed, type View, type Vec } from "@/lib/furnish/ops";
import { createScene, type FurnishScene, type LoadState } from "@/lib/furnish/scene";
import type { Rejected } from "@/lib/design/layout-ops";
import type { ShellReport } from "@/lib/types";
import { Mic } from "./Voice";

type Room = NonNullable<View["room"]>;
type Status = "searching" | "loading" | "ready" | "none" | "failed";
type Tab = "suggested" | "placed" | "search";
type Stop = { label: string; index: number };
type Card = { name: string; terms: string[]; size?: FurnishItem["size"]; model?: Model };
const SWATCHES = ["white", "black", "gray", "beige", "walnut", "oak", "navy", "sage green", "red", "gold"];
const STARTUP_MS = 25_000;
const MAX_TRIES = 3;
const NUDGE_M = 0.1;
const STATUS_TEXT: Record<Status, string> = { searching: "Finding a model…", loading: "Loading…", ready: "", none: "Box: no 3D model found", failed: "Box: model didn't load" };
const json = async <T,>(url: string, body?: unknown): Promise<T> => {
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
};
type Found = { models: Model[]; size?: Size; sizeSource?: "table" | "gemini" | "default" };
// Models ranked by how well they fit the item's real size (the server measures their files); with a name, its size too.
const lookup = (terms: string[], name?: string): Promise<Found> =>
  json<Found>(`/api/furniture/search?terms=${encodeURIComponent(terms.slice(0, 3).join(","))}${name ? `&name=${encodeURIComponent(name)}` : ""}`).catch(() => ({ models: [] }));
const findModels = (terms: string[], limit = 5, name?: string) => lookup(terms, name).then((r) => r.models.slice(0, limit));
const M_PER_FT = 0.3048;
const rejectedText = (r: Rejected[]) => r.map((x) => x.reason).join("; ");
const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

export function FurnishTour({ report, use, stop, stops, onFail }: { report: ShellReport; use: string; stop?: number; stops: Stop[]; onFail: () => void }) {
  const sid = report.inside!.sid;
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<MatterportViewer | null>(null);
  const sdk = useRef<MpSdk | null>(null);
  const scene = useRef<FurnishScene | null>(null);
  const strip = useRef<HTMLUListElement>(null);
  const floorY = useRef(0), pointer = useRef<Vec | undefined>(undefined); // last floor spot under the cursor ("here")
  const lookingUp = useRef(new Set<string>());
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<Placed[]>(() => load<Placed[]>(`hermit:furnish:${sid}`, "local") ?? []);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [candidates, setCandidates] = useState<Record<string, Model[]>>({});
  const [selected, setSelected] = useState<string | undefined>();
  const [room, setRoom] = useState<Room | undefined>();
  const [suggestions, setSuggestions] = useState<FurnishItem[]>([]);
  const [tab, setTab] = useState<Tab>("suggested");
  const [trayOpen, setTrayOpen] = useState(true);
  const [popover, setPopover] = useState<"color" | "material" | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Model[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState<string | undefined>(); // Search tab is choosing a new model for this item
  const [measuring, setMeasuring] = useState<string | undefined>(); // waiting for the user to draw a measurement for this item
  const sized = useRef(new Set<string>());
  // Every room outline on the plan (with its ceiling), so items stay inside whichever room they're in.
  const rooms = useMemo(() => (report.floorplan?.rooms ?? []).filter((r) => r.polygon.length >= 3)
    .map((r) => ({ id: r.id, label: r.label, polygon: r.polygon, ceiling: r.heightFt ? r.heightFt * M_PER_FT : undefined })), [report.floorplan]);
  const state = useRef({ items, selected, room, candidates, rooms, measuring });
  state.current = { items, selected, room, candidates, rooms, measuring };
  const sel = items.find((p) => p.id === selected);
  const statusOf = (p: Placed): Status => status[p.id] ?? (p.model === undefined ? "searching" : p.model === null ? "none" : "loading");

  const makeView = useCallback((point?: Vec, ahead?: Vec): View => {
    const cam = scene.current?.camera() ?? { pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, z: -1 } }, { selected, room, rooms } = state.current;
    return { camera: cam.pos, forward: cam.forward, floorY: floorY.current, point, ahead, room, rooms, selected };
  }, []);
  // Gives an item a model (and optionally a real size): the rendered size comes from the model's measured proportions,
  // and the item is re-seated so its new footprint stays inside its room.
  const withModel = useCallback((p: Placed, model: Model | null, size: Size = p.size, approxSize = p.approxSize): Placed => {
    const fitted = model?.bounds ? fitModel(model.bounds, size)?.fitted : undefined;
    return { ...p, model, size, approxSize, fitted, pos: settle(p.pos, fitted ?? size, p.rotY, makeView()) };
  }, [makeView]);

  // A model failed to load: try the item's next candidate, then settle on the box.
  const onLoad = useCallback((id: string, s: LoadState, fitted?: Size) => {
    if (s === "ready") {
      // Measured in the browser (no server bounds): record the rendered size so grabbing and walls use it.
      if (fitted) setItems((cur) => cur.map((x) => (x.id === id ? { ...x, fitted, pos: settle(x.pos, fitted, x.rotY, makeView()) } : x)));
      setStatus((m) => ({ ...m, [id]: m[id] === "none" || m[id] === "failed" ? m[id] : "ready" }));
      return;
    }
    const p = state.current.items.find((x) => x.id === id);
    const list = state.current.candidates[id] ?? [];
    const i = list.findIndex((m) => m.id === p?.model?.id);
    const next = i >= 0 && i + 1 < Math.min(list.length, MAX_TRIES) ? list[i + 1] : null;
    setItems((cur) => cur.map((x) => (x.id === id ? withModel(x, next) : x)));
    setStatus((m) => ({ ...m, [id]: next ? "loading" : "failed" }));
  }, [withModel, makeView]);

  // Start the SDK viewer once; any startup failure hands back to the iframe tour.
  useEffect(() => {
    let dead = false;
    const fail = (why: string) => { console.warn(`[hermit] 3D furnishing unavailable (${why}); showing the basic tour`); onFail(); };
    const timeout = setTimeout(() => { if (!sdk.current) fail("startup timed out"); }, STARTUP_MS);
    (async () => {
      const { key } = await json<{ key: string | null }>("/api/tour-key");
      if (!key) return fail("no SDK key");
      await import("@matterport/webcomponent");
      if (dead || !host.current) return;
      const el = document.createElement("matterport-viewer") as MatterportViewer;
      for (const [k, v] of Object.entries({ m: sid, "application-key": key, "asset-base": "mp", qs: "1", brand: "0", play: "1" })) el.setAttribute(k, v);
      el.addEventListener("mpViewerError", (e) => fail(e.detail.error.message));
      host.current.prepend(el);
      viewer.current = el;
      const s = await el.playingPromise;
      if (dead) return;
      sdk.current = s;
      scene.current = await createScene(s, onLoad);
      if (process.env.NODE_ENV !== "production") (window as unknown as { __furnish: unknown }).__furnish = scene.current; // for e2e tests
      s.Pointer.intersection.subscribe((i) => { if (i.position && Math.abs(i.position.y - floorY.current) < 0.15) pointer.current = { ...i.position }; });
      s.Sweep.current.subscribe((sw) => {
        if (sw.puckPosition) floorY.current = sw.puckPosition.y;
        const r = report.floorplan?.rooms.find((x) => x.id === sw.roomInfo?.id);
        setRoom(r ? { id: r.id, label: r.label, polygon: r.polygon, ceiling: r.heightFt ? r.heightFt * M_PER_FT : undefined } : undefined);
      });
      setReady(true);
    })().catch((e) => { if (!dead) fail(e instanceof Error ? e.message : String(e)); });
    return () => { dead = true; clearTimeout(timeout); scene.current?.destroy(); scene.current = null; viewer.current?.remove(); };
  }, [sid, report.floorplan, onFail, onLoad]);

  useEffect(() => { scene.current?.sync(items, selected); save(`hermit:furnish:${sid}`, items, "local"); }, [items, selected, sid, ready]);
  useEffect(() => { setPopover(null); }, [selected]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);
  const goTo = useCallback((index: number) => {
    const id = report.floorplan?.rooms.flatMap((r) => r.sweeps ?? []).find((s) => s.index === index)?.id;
    if (id) sdk.current?.Sweep.moveTo(id).catch(() => null);
  }, [report.floorplan]);
  useEffect(() => { if (ready && stop != null) goTo(stop); }, [stop, ready, goTo]);

  // Suggestions for the room the user is standing in (one cached Gemini call per use + room); "space" when unknown.
  const roomLabel = room?.label ?? "space", roomId = room?.id;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const areaSqm = (report.floorplan?.rooms.find((r) => r.id === roomId)?.areaSqft ?? 0) / 10.7639 || undefined;
    json<{ items: FurnishItem[] }>("/api/furniture/suggest", { use: use || "home", room: roomLabel, areaSqm }).then((r) => live && setSuggestions(r.items)).catch(() => live && setSuggestions([]));
    return () => { live = false; };
  }, [ready, roomLabel, roomId, use, report.floorplan]);

  // Find models for items that don't have one yet (ranked by fit to the item's real size; the rest are fallbacks),
  // and a real size for items that only have a guess.
  useEffect(() => {
    for (const p of items.filter((x) => x.model === undefined && !lookingUp.current.has(x.id))) {
      lookingUp.current.add(p.id);
      sized.current.add(p.id);
      setStatus((m) => ({ ...m, [p.id]: "searching" }));
      lookup(p.terms, p.approxSize ? p.name : undefined).then(({ models, size, sizeSource }) => {
        lookingUp.current.delete(p.id);
        const known = !!size && sizeSource !== "default";
        setCandidates((c) => ({ ...c, [p.id]: models }));
        setItems((cur) => cur.map((x) => (x.id === p.id && x.model === undefined
          ? withModel(x, models[0] ?? null, known ? underCeiling(size!, roomAt(x.pos, makeView())?.ceiling) : x.size, known ? false : x.approxSize) : x)));
        setStatus((m) => ({ ...m, [p.id]: models.length ? "loading" : "none" }));
      });
    }
    for (const p of items.filter((x) => x.model !== undefined && x.approxSize && !sized.current.has(x.id))) {
      sized.current.add(p.id);
      json<{ size: Size; source: string }>(`/api/furniture/size?name=${encodeURIComponent(p.name)}`).then(({ size, source }) => {
        if (source === "default") return;
        setItems((cur) => cur.map((x) => (x.id === p.id ? withModel(x, x.model ?? null, underCeiling(size, roomAt(x.pos, makeView())?.ceiling), false) : x)));
      }).catch(() => null);
    }
  }, [items, withModel, makeView]);

  // "In front of me" = the nearest floor the user can actually see: scan rows up from just above the tray (center
  // column first, then out to the sides) and take the first point where Matterport's own surface is the floor. A
  // floor-plane point could sit behind a wall, where the tour hides the item.
  const visibleAhead = useCallback(async (): Promise<Vec | undefined> => {
    const v = viewer.current?.getBoundingClientRect(), s = sdk.current;
    if (!v || !s) return undefined;
    const bottom = host.current?.querySelector(".furnish-tray")?.getBoundingClientRect().top ?? v.bottom;
    for (let y = bottom - 30; y > v.top + v.height * 0.45; y -= 25) {
      for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const hit = await s.Renderer.getWorldPositionData({ x: v.width * fx, y: y - v.top }).catch(() => null);
        if (hit?.position && Math.abs(hit.position.y - floorY.current) < 0.15) return { ...hit.position, y: floorY.current };
      }
    }
    setTrayOpen(false); // no floor visible above the tray: lower it so the default spot in front of you shows
    return undefined;
  }, []);

  const apply = useCallback((ops: object[], point?: Vec, ahead?: Vec) => {
    const r = applyFurnishOps(state.current.items, ops, makeView(point, ahead));
    setItems(r.value);
    setSelected(r.selected);
    return r;
  }, [makeView]);

  const placeCard = useCallback(async (c: Card, point?: Vec) => {
    const r = apply([{ op: "add", name: c.name, terms: c.terms, ...(c.size && { size: c.size }), at: point ? "point" : "front" }], point, point ? undefined : await visibleAhead());
    const id = r.selected;
    if (c.model && id && r.applied.length) { setItems((cur) => cur.map((x) => (x.id === id ? withModel(x, c.model!) : x))); setStatus((m) => ({ ...m, [id]: "loading" })); }
  }, [apply, visibleAhead, withModel]);

  // Press on an item to select and drag it (Matterport never sees that press); anything else is normal tour input.
  useEffect(() => {
    const el = viewer.current;
    if (!ready || !el) return;
    let drag: { id: string; x: number; y: number; moved: boolean; rotY: number; startRot: number; pos?: Vec } | null = null;
    const block = (e: Event) => { if (drag) { e.stopPropagation(); e.preventDefault(); } };
    // The floor under the cursor; with an item, kept fully inside whichever room it's in (rotated footprint).
    const floorPoint = (e: { clientX: number; clientY: number }, item?: { id: string; rotY: number }) => {
      const p = scene.current!.floorAt(e.clientX, e.clientY, el.getBoundingClientRect(), floorY.current);
      const it = item && state.current.items.find((x) => x.id === item.id);
      return p && it ? settle(p, dims(it), item!.rotY, makeView()) : p;
    };
    const onDown = (e: PointerEvent) => {
      if (state.current.measuring) return; // clicks belong to Matterport's measure tool
      const r = scene.current?.ray(e.clientX, e.clientY, el.getBoundingClientRect());
      const id = r && hitItem(r.origin, r.dir, state.current.items);
      const p = id && state.current.items.find((x) => x.id === id);
      if (!p) return;
      drag = { id: p.id, x: e.clientX, y: e.clientY, moved: false, rotY: p.rotY, startRot: p.rotY };
      setSelected(p.id);
      block(e);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      block(e);
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.moved = true;
      const pos = floorPoint(e, drag);
      if (pos) { drag.pos = pos; scene.current!.drag(drag.id, pos, drag.rotY); }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      block(e);
      const d = drag;
      // Keep blocking this press's trailing mouseup/click, then release.
      setTimeout(() => { if (drag === d) drag = null; }, 0);
      const ops: object[] = [];
      if (d.moved && d.pos) ops.push({ op: "move", id: d.id, at: "point" });
      if (d.rotY !== d.startRot) ops.push({ op: "rotate", id: d.id, degrees: d.rotY - d.startRot });
      if (ops.length) apply(ops, d.pos);
      scene.current!.drag(null);
    };
    const onWheel = (e: WheelEvent) => {
      if (!drag) return;
      block(e);
      drag.rotY = (drag.rotY + Math.sign(e.deltaY) * 15 + 360) % 360;
      const p = drag.pos ?? state.current.items.find((x) => x.id === drag!.id)?.pos;
      if (p) scene.current!.drag(drag.id, p, drag.rotY);
    };
    // Drop a tray card onto the floor to place it there.
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes("application/x-hermit-item")) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      const raw = e.dataTransfer?.getData("application/x-hermit-item");
      if (!raw) return;
      e.preventDefault();
      void placeCard(JSON.parse(raw) as Card, floorPoint(e) ?? undefined); // dropped above the horizon → in front of you
    };
    const cap = { capture: true };
    const mouse = ["mousedown", "mousemove", "mouseup", "click"] as const;
    el.addEventListener("pointerdown", onDown, cap);
    window.addEventListener("pointermove", onMove, cap);
    window.addEventListener("pointerup", onUp, cap);
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    for (const t of mouse) el.addEventListener(t, block, cap);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("pointerdown", onDown, cap);
      window.removeEventListener("pointermove", onMove, cap);
      window.removeEventListener("pointerup", onUp, cap);
      el.removeEventListener("wheel", onWheel, cap);
      for (const t of mouse) el.removeEventListener(t, block, cap);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
    };
  }, [ready, apply, placeCard, makeView]);

  // Keyboard: Esc closes a popover, then deselects; arrows nudge; R rotates; Delete removes; T toggles the tray.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (popover || state.current.selected)) { e.stopPropagation(); if (popover) setPopover(null); else setSelected(undefined); return; }
      if (typing(e) || !ready) return;
      if (e.key === "t" || e.key === "T") { setTrayOpen((o) => !o); return; }
      const p = state.current.items.find((x) => x.id === state.current.selected);
      if (!p) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); apply([{ op: "rotate", id: p.id, degrees: e.shiftKey ? -15 : 15 }]); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); apply([{ op: "remove", id: p.id }]); }
      const a = ({ ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>)[e.key];
      if (a) {
        e.preventDefault();
        const f = scene.current!.camera().forward; // nudge relative to where the user is looking
        apply([{ op: "move", id: p.id, at: "point" }], { x: p.pos.x + (f.x * a[0] - f.z * a[1]) * NUDGE_M, y: p.pos.y, z: p.pos.z + (f.z * a[0] + f.x * a[1]) * NUDGE_M });
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [popover, ready, apply]);

  // Dimension overlay: the selected item's width/depth/height and gap to the wall, plus the measurement being drawn,
  // projected every frame so the lines follow the camera. Labels in feet and inches.
  const overlay = useRef<SVGSVGElement>(null);
  const measure = useRef<{ start?: Vec; end?: Vec }>({});
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const svg = overlay.current, el = viewer.current, s = scene.current;
      if (!svg || !el || !s) return;
      const rect = el.getBoundingClientRect(), stage = host.current!.getBoundingClientRect();
      const p = state.current.items.find((x) => x.id === state.current.selected);
      const m = measure.current;
      const lines = [
        ...(p && !state.current.measuring ? dimensionLines(p, makeView()) : []),
        ...(m.start && m.end ? [{ points: [m.start, m.end], label: ftIn(Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z)), measure: true }] : []),
      ] as { points: Vec[]; label: string; measure?: boolean }[];
      const groups = svg.querySelectorAll<SVGGElement>("g");
      groups.forEach((g, i) => {
        const l = lines[i], a = l && s.screenOf(l.points[0], rect), b = l && s.screenOf(l.points[1], rect);
        if (!l || !a || !b || a.behind || b.behind) { g.style.display = "none"; return; }
        g.style.display = "";
        g.dataset.kind = l.measure ? "measure" : "dim";
        const [x1, y1, x2, y2] = [a.x - stage.left, a.y - stage.top, b.x - stage.left, b.y - stage.top];
        const line = g.querySelector("line")!, text = g.querySelector("text")!;
        line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1)); line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2));
        text.setAttribute("x", String((x1 + x2) / 2)); text.setAttribute("y", String((y1 + y2) / 2 - 6));
        text.textContent = l.label;
      });
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [ready, makeView]);

  // Measuring: two clicks on the tour, each snapped to the real scanned surface; the item then matches the line.
  useEffect(() => {
    const el = viewer.current, s = sdk.current;
    if (!ready || !el || !s || !measuring) return;
    measure.current = {};
    const surface = async (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return (await s.Renderer.getWorldPositionData({ x: e.clientX - r.left, y: e.clientY - r.top }).catch(() => null))?.position ?? null;
    };
    const stopIt = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
    let busy = false;
    const onMove = async (e: PointerEvent) => {
      if (!measure.current.start || busy) return;
      busy = true;
      const q = await surface(e);
      busy = false;
      if (q && measuring) measure.current.end = q;
    };
    const onUp = async (e: PointerEvent) => {
      stopIt(e);
      const q = await surface(e);
      if (!q) return;
      if (!measure.current.start) { measure.current = { start: q, end: q }; return; }
      const p = state.current.items.find((x) => x.id === measuring);
      const r = p && fromMeasurement(p, measure.current.start, q, makeView());
      const length = Math.hypot(q.x - measure.current.start.x, q.y - measure.current.start.y, q.z - measure.current.start.z);
      if (r) { apply(r.ops, r.point); setToast(`Matched the ${p!.name} to your ${ftIn(length)} measurement.`); }
      measure.current = {};
      setMeasuring(undefined);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); measure.current = {}; setMeasuring(undefined); } };
    const cap = { capture: true };
    const kinds = ["pointerdown", "mousedown", "mouseup", "click"] as const;
    for (const t of kinds) el.addEventListener(t, stopIt, cap);
    el.addEventListener("pointerup", onUp, cap);
    el.addEventListener("pointermove", onMove, cap);
    window.addEventListener("keydown", onKey, cap);
    return () => {
      for (const t of kinds) el.removeEventListener(t, stopIt, cap);
      el.removeEventListener("pointerup", onUp, cap);
      el.removeEventListener("pointermove", onMove, cap);
      window.removeEventListener("keydown", onKey, cap);
      measure.current = {};
    };
  }, [ready, measuring, apply, makeView]);

  async function send(t = text) {
    const message = t.trim();
    if (!message || busy || !ready) return;
    setText(""); setBusy(true);
    try {
      const out = await json<{ ops: object[]; reply: string }>("/api/furniture/edit", {
        text: message, items: items.map(({ id, name }) => ({ id, name })), selected, room: room?.label, suggestions,
      });
      const r = out.ops.length ? apply(out.ops, pointer.current, await visibleAhead()) : null;
      setToast(!r?.rejected.length ? out.reply : !r.applied.length ? `I couldn't do that: ${rejectedText(r.rejected)}.` : `${out.reply} I couldn't do part of that: ${rejectedText(r.rejected)}.`);
    } catch {
      setToast("Something went wrong reaching the assistant. Try again, or use the tray.");
    } finally { setBusy(false); }
  }

  async function runSearch(terms: string[], name: string) {
    setTab("search"); setTrayOpen(true); setResults(null);
    setResults(await findModels(terms, 12, name));
  }
  const target = items.find((p) => p.id === replacing);
  // In "replacing" mode a card swaps the item's model; otherwise it adds a new item.
  function useModel(m: Model) {
    if (target) { setItems((cur) => cur.map((x) => (x.id === target.id ? withModel(x, m) : x))); setStatus((s) => ({ ...s, [target.id]: "loading" })); }
    else void placeCard({ name: query.trim() || m.title, terms: [query.trim() || m.title], model: m });
  }
  async function bringHere(p: Placed) {
    const at = await visibleAhead();
    if (at) apply([{ op: "move", id: p.id, at: "point" }], at); else setToast("Look toward some open floor, then try again.");
  }
  const scrollStrip = (dir: number) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: "smooth" });
  const dragData = (c: Card) => (e: React.DragEvent) => { e.dataTransfer.setData("application/x-hermit-item", JSON.stringify(c)); e.dataTransfer.effectAllowed = "copy"; };
  const credits = [...new Map(items.filter((p) => p.model).map((p) => [p.model!.id, p.model!])).values()];
  const label = room && !["other", "open", "hallway"].includes(room.label) ? room.label : "space";
  const selStatus = sel ? statusOf(sel) : null;

  return (
    <div className="furnish-tour">
      <div className="furnish-stage" ref={host} role="application" aria-label={`Matterport 3D tour of ${report.name}. Drag furniture to move it.`}>
        <svg className="furnish-overlay" ref={overlay} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <g key={i} style={{ display: "none" }}><line /><text textAnchor="middle" /></g>)}
        </svg>
        {measuring && <p className="furnish-banner" role="status">Click where the measurement starts, then where it ends. Esc to cancel.</p>}
        {!ready && <p className="furnish-loading"><Loader aria-hidden="true" /> Loading the 3D tour… <button type="button" className="btn small" onClick={onFail}>Open the basic tour instead</button></p>}

        {sel && (
          <div className="furnish-toolbar" role="toolbar" aria-label={`Edit ${sel.name}`}>
            <strong>{sel.name}</strong>
            <span className="dims" aria-label={`${sel.approxSize ? "about " : ""}${ftIn(dims(sel).w)} wide, ${ftIn(dims(sel).d)} deep, ${ftIn(dims(sel).h)} tall`} title={sel.approxSize ? "Approximate size" : "Typical size"}>
              {sel.approxSize ? "~" : ""}{ftIn(dims(sel).w)} W × {ftIn(dims(sel).d)} D × {ftIn(dims(sel).h)} H
            </span>
            {selStatus && STATUS_TEXT[selStatus] && <span className="badge" data-status={selStatus}>{STATUS_TEXT[selStatus]}</span>}
            <button type="button" className="icon-btn" aria-label="Rotate left 15 degrees" onClick={() => apply([{ op: "rotate", id: sel.id, degrees: -15 }])}><RotateCcw aria-hidden="true" /></button>
            <button type="button" className="icon-btn" aria-label="Rotate right 15 degrees" onClick={() => apply([{ op: "rotate", id: sel.id, degrees: 15 }])}><RotateCw aria-hidden="true" /></button>
            <div className="pop-wrap">
              <button type="button" className="icon-btn" aria-label="Color" aria-expanded={popover === "color"} onClick={() => setPopover(popover === "color" ? null : "color")}><Palette aria-hidden="true" /></button>
              {popover === "color" && (
                <div className="furnish-pop" role="group" aria-label="Colors">
                  {SWATCHES.map((c) => <button key={c} type="button" className="swatch" style={{ background: COLORS[c] }} aria-label={c} aria-pressed={sel.color === COLORS[c]} onClick={() => apply([{ op: "recolor", id: sel.id, color: c }])} />)}
                  <input type="color" aria-label="Custom color" value={sel.color ?? "#888888"} onChange={(e) => apply([{ op: "recolor", id: sel.id, color: e.target.value }])} />
                </div>
              )}
            </div>
            <div className="pop-wrap">
              <button type="button" className="icon-btn" aria-label="Material" aria-expanded={popover === "material"} onClick={() => setPopover(popover === "material" ? null : "material")}><Layers aria-hidden="true" /></button>
              {popover === "material" && (
                <div className="furnish-pop materials" role="group" aria-label="Materials">
                  {MATERIAL_NAMES.map((m) => <button key={m} type="button" className="btn small" aria-pressed={sel.material === m} onClick={() => apply([{ op: "recolor", id: sel.id, material: m }])}>{m}</button>)}
                </div>
              )}
            </div>
            <button type="button" className="icon-btn" aria-label="Size from a measurement" title="Size from a measurement" aria-pressed={measuring === sel.id} onClick={() => { setMeasuring(measuring === sel.id ? undefined : sel.id); }}><Ruler aria-hidden="true" /></button>
            <button type="button" className="icon-btn" aria-label="Bring it here" title="Bring it here" onClick={() => void bringHere(sel)}><LocateFixed aria-hidden="true" /></button>
            <button type="button" className="btn small" onClick={() => { setQuery(sel.name); setReplacing(sel.id); void runSearch(sel.terms, sel.name); }}><RefreshCw aria-hidden="true" /> Other models</button>
            <button type="button" className="icon-btn" aria-label={`Remove ${sel.name}`} onClick={() => apply([{ op: "remove", id: sel.id }])}><Trash2 aria-hidden="true" /></button>
            <button type="button" className="icon-btn" aria-label="Deselect" onClick={() => setSelected(undefined)}><X aria-hidden="true" /></button>
          </div>
        )}

        <div className="furnish-tray" data-open={trayOpen}>
          {toast && <p className="furnish-toast" role="status">{toast}</p>}
          <form className="furnish-chat" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <button type="button" className="icon-btn" aria-label={trayOpen ? "Hide the furniture tray" : "Show the furniture tray"} aria-expanded={trayOpen} onClick={() => setTrayOpen(!trayOpen)}>{trayOpen ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}</button>
            <label className="sr-only" htmlFor="furnish-text">Tell me what to place</label>
            <input id="furnish-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Furnish this ${label}: "put a stove here", "make it navy"…`} maxLength={500} disabled={!ready} />
            <Mic disabled={!ready || busy} onText={(t) => void send(t)} />
            <button type="submit" className="icon-btn" aria-label="Send" disabled={!ready || busy || !text.trim()}>{busy ? <Loader aria-hidden="true" /> : <Send aria-hidden="true" />}</button>
          </form>
          {trayOpen && (
            <div className="furnish-shelf">
              <div className="furnish-tabs">
                <div role="tablist" aria-label="Furniture">
                  {(["suggested", "placed", "search"] as const).map((t) => (
                    <button key={t} type="button" role="tab" id={`furnish-tab-${t}`} aria-controls="furnish-panel" aria-selected={tab === t} onClick={() => { setTab(t); if (t !== "search") setReplacing(undefined); }}>
                      {t === "suggested" ? "Suggested" : t === "placed" ? `Placed (${items.length})` : "Search"}
                    </button>
                  ))}
                </div>
                {tab === "search" && target && (
                  <span className="replacing">Replacing the {target.name}
                    <button type="button" className="icon-btn" aria-label="Stop replacing; cards add new items" onClick={() => setReplacing(undefined)}><X aria-hidden="true" /></button>
                  </span>
                )}
                {tab === "search" && (
                  <form className="furnish-search" role="search" onSubmit={(e) => { e.preventDefault(); if (query.trim().length >= 2) void runSearch([query.trim()], target?.name ?? query.trim()); }}>
                    <label className="sr-only" htmlFor="furnish-q">Search 3D models</label>
                    <input id="furnish-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. piano" maxLength={40} />
                    <button type="submit" className="icon-btn" aria-label="Search models"><Search aria-hidden="true" /></button>
                  </form>
                )}
                <div className="furnish-extras">
                  {stops.length > 0 && (
            <label className="furnish-room">
              <span className="sr-only">Jump to a room</span>
              <select defaultValue="" onChange={(e) => goTo(Number(e.target.value))} disabled={!ready}>
                <option value="" disabled>Jump to a room…</option>
                {stops.map((s) => <option key={`${s.label}-${s.index}`} value={s.index}>{s.label}</option>)}
              </select>
            </label>
          )}
                  <span className="furnish-hint" title="Furniture sizes are typical, not measured. Nothing here changes the property."><Info aria-hidden="true" /> Visualization only</span>
                {credits.length > 0 && <details className="credits"><summary>Credits</summary><ul>{credits.map((m) => <li key={m.id}>{m.attribution}</li>)}</ul></details>}
                </div>
              </div>
              <div className="furnish-strip-wrap" role="tabpanel" id="furnish-panel" aria-labelledby={`furnish-tab-${tab}`}>
                <button type="button" className="icon-btn strip-nav" aria-label="Scroll left" onClick={() => scrollStrip(-1)}><ChevronLeft aria-hidden="true" /></button>
                <ul className="furnish-strip" ref={strip}>
                  {tab === "suggested" && (suggestions.length ? suggestions.map((s) => (
                    <li key={s.name}>
                      <button type="button" className="furnish-card" draggable onDragStart={dragData(s)} disabled={!ready} onClick={() => void placeCard(s)} aria-label={`Add ${s.name}`}>
                        <span className="thumb"><Sofa aria-hidden="true" /></span><span className="name">{s.name}</span><span className="sub">Click or drag in</span>
                      </button>
                    </li>
                  )) : <li className="muted empty">Finding ideas for this {label}…</li>)}
                  {tab === "placed" && (items.length ? items.map((p) => {
                    const st = statusOf(p);
                    return (
                      <li key={p.id}>
                        <button type="button" className="furnish-card" aria-pressed={p.id === selected} data-status={st} onClick={() => setSelected(p.id === selected ? undefined : p.id)} aria-label={`${p.name}${STATUS_TEXT[st] ? `, ${STATUS_TEXT[st]}` : ""}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <span className="thumb">{p.model?.thumb ? <img src={p.model.thumb} alt="" /> : st === "searching" || st === "loading" ? <Loader aria-hidden="true" /> : <Sofa aria-hidden="true" />}</span>
                          <span className="name">{p.name}</span><span className="sub">{STATUS_TEXT[st] || p.model?.source || ""}</span>
                        </button>
                      </li>
                    );
                  }) : <li className="muted empty">Nothing placed yet. Add something from Suggested or type above.</li>)}
                  {tab === "search" && (results === null ? <li className="muted empty">{query ? "Searching…" : "Search Sketchfab and Poly Pizza models."}</li>
                    : results.length ? results.map((m) => (
                      <li key={m.id}>
                        <button type="button" className="furnish-card" draggable onDragStart={dragData({ name: query.trim() || m.title, terms: [query.trim() || m.title], model: m })} aria-pressed={target?.model?.id === m.id} onClick={() => useModel(m)} aria-label={target ? `Use ${m.title} for the ${target.name}` : `Add ${m.title}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <span className="thumb">{m.thumb ? <img src={m.thumb} alt="" /> : <Sofa aria-hidden="true" />}</span><span className="name">{m.title}</span><span className="sub">{m.source}</span>
                        </button>
                      </li>
                    )) : <li className="muted empty">No models found. Try a simpler word.</li>)}
                </ul>
                <button type="button" className="icon-btn strip-nav" aria-label="Scroll right" onClick={() => scrollStrip(1)}><ChevronRight aria-hidden="true" /></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
