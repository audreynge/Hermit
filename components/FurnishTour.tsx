"use client";
// The 3D tour as the stage, with a bottom tray (suggested / placed / search) and a toolbar for the selected item.
// Drag items to move them; drag cards from the tray into the room to place them. Falls back (onFail) to the plain
// iframe tour when the SDK can't start.
import type { MpSdk } from "@matterport/webcomponent";
import { Box, ChevronLeft, ChevronRight, Footprints, Info, Layers, Loader, LocateFixed, Map as MapIcon, Palette, RefreshCw, Ruler, RotateCcw, RotateCw, Search, Sofa, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hermitContext, noteToHermit } from "@/lib/client/session";
import { load, save } from "@/lib/client/store";
import { COLORS, ftIn, MATERIAL_NAMES, type FurnishItem, type Size } from "@/lib/furnish/catalog";
import { fitModel } from "@/lib/furnish/fit";
import { applyFurnishOps, dimensionLines, dims, fromMeasurement, hitItem, roomAt, settle, toPlan, underCeiling, type FurnishResult, type Model, type Placed, type View, type Vec } from "@/lib/furnish/ops";
import { planRooms } from "@/lib/furnish/layout";
import { dropBlocked } from "@/lib/furnish/probe";
import { pointInPolygon } from "@/lib/geometry/polygon";
import { createScene, type FurnishScene, type LoadState } from "@/lib/furnish/scene";
import type { Rejected } from "@/lib/design/layout-ops";
import type { ShellReport } from "@/lib/types";

type Room = NonNullable<View["room"]>;
type Status = "searching" | "loading" | "ready" | "none" | "failed";
type Tab = "suggested" | "placed" | "search";
// What the floating Hermit chat uses to furnish: send a request, get Hermit's reply back.
export type FurnishApi = { ready: boolean; send: (text: string) => Promise<string> };
type Card = { name: string; terms: string[]; size?: FurnishItem["size"]; model?: Model };
const SWATCHES = ["white", "black", "gray", "beige", "walnut", "oak", "navy", "sage green", "red", "gold"];
const STARTUP_MS = 25_000;
// ponytail: fixed settle after the start pano is current (8/8 clean in tests at 600 ms); the SDK exposes no "pano textures ready" event.
const SETTLE_MS = 600;
const MAX_TRIES = 3;
const NUDGE_M = 0.1;
const NUDGE_MERGE_MS = 1000;
const MAX_UNDO = 20;
const PROBE_MS = 2_500; // budget for checking planned pieces against built-in counters
const STATUS_TEXT: Record<Status, string> = { searching: "Finding a model…", loading: "Loading…", ready: "", none: "Box: no 3D model found", failed: "Box: model didn't load" };
const json = async <T,>(url: string, body?: unknown): Promise<T> => {
  const res = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
};
type Found = { models: Model[]; size?: Size; sizeSource?: "table" | "gemini" | "default" };
// Models ranked by how well they fit the item's real size (the server measures their files); with a name, its size too.
// One request per distinct query in flight: a furnish can add 20 identical chairs at once.
const lookups = new Map<string, Promise<Found>>();
const lookup = (terms: string[], name?: string): Promise<Found> => {
  const url = `/api/furniture/search?terms=${encodeURIComponent(terms.slice(0, 3).join(","))}${name ? `&name=${encodeURIComponent(name)}` : ""}`;
  let p = lookups.get(url);
  if (!p) lookups.set(url, p = json<Found>(url).catch(() => ({ models: [] })).finally(() => lookups.delete(url)));
  return p;
};
type ViewMode = "inside" | "dollhouse" | "floorplan";
const MODES: [ViewMode, string, typeof Box][] = [["inside", "Walk", Footprints], ["dollhouse", "Dollhouse", Box], ["floorplan", "Floor plan", MapIcon]];
const ALL = "all";
const OPEN_SQFT = 430; // ~40 m²
const findModels = (terms: string[], limit = 5, name?: string) => lookup(terms, name).then((r) => r.models.slice(0, limit));
const M_PER_FT = 0.3048;
type FurnishRequest = { op: "furnish"; scope: "room" | "all"; room?: string };
const rejectedText = (r: Rejected[]) => r.map((x) => x.reason).join("; ");
const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

export function FurnishTour({ report, use, chairIn, stop, onFail, api }: { report: ShellReport; use: string; chairIn?: number; stop?: number; onFail: () => void; api?: React.MutableRefObject<FurnishApi | null> }) {
  const sid = report.inside!.sid;
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<MatterportViewer | null>(null);
  const sdk = useRef<MpSdk | null>(null);
  const moved = useRef(false);
  // Every camera move (tour stop, room pick, view switch) runs through this queue: a move that starts while a pano is
  // still activating blacks out the tour ("Texture for sweep not activated"), so moves wait for the start pano and each other.
  const nav = useRef<Promise<unknown>>(Promise.resolve());
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
  const [popover, setPopover] = useState<"color" | "material" | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Model[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState<string | undefined>(); // Search tab is choosing a new model for this item
  const [measuring, setMeasuring] = useState<string | undefined>(); // waiting for the user to draw a measurement for this item
  const [mode, setModeState] = useState<ViewMode>("inside");
  const [picked, setPicked] = useState<string | undefined>(); // a room id or ALL chosen with the select tool / picker
  const [undoText, setUndoText] = useState<string | null>(null); // the furnish message that offers an Undo button
  const sized = useRef(new Set<string>());
  // Every room outline on the plan (with its ceiling), so items stay inside whichever room they're in. Each gets a
  // readable name: the scan labels many rooms "other", so those become "Room 1", "Room 2"…
  const rooms = useMemo(() => {
    const list = (report.floorplan?.rooms ?? []).filter((r) => r.polygon.length >= 3).sort((a, b) => b.areaSqft - a.areaSqft);
    // Scans often label an open-plan area (with its corridors) "hallway"; a big one is an open area, not a corridor.
    const kind = (r: { label: string; areaSqft: number }) => (r.label === "hallway" && r.areaSqft > OPEN_SQFT ? "open area" : r.label);
    const base = (l: string) => (["other", "open"].includes(l) ? "Room" : l.charAt(0).toUpperCase() + l.slice(1));
    const total: Record<string, number> = {}, seen: Record<string, number> = {};
    for (const r of list) total[base(kind(r))] = (total[base(kind(r))] ?? 0) + 1;
    return list.map((r) => {
      const b = base(kind(r)), n = (seen[b] = (seen[b] ?? 0) + 1);
      return { id: r.id, label: kind(r), polygon: r.polygon, ceiling: r.heightFt ? r.heightFt * M_PER_FT : undefined, floorId: r.floorId, areaSqft: r.areaSqft, name: total[b] > 1 || b === "Room" ? `${b} ${n}` : b };
    });
  }, [report.floorplan]);
  const here = rooms.find((r) => r.id === room?.id);
  const floorRooms = rooms.filter((r) => r.floorId === (here ?? rooms[0])?.floorId);
  const furnishable = floorRooms.filter((r) => !["hallway", "bathroom"].includes(r.label)); // "everything" skips corridors and restrooms
  const targetRoom = picked === ALL ? undefined : rooms.find((r) => r.id === picked) ?? here;
  const state = useRef({ items, selected, room, candidates, rooms, measuring, mode, outline: targetRoom?.polygon });
  state.current = { items, selected, room, candidates, rooms, measuring, mode, outline: picked === ALL ? undefined : targetRoom?.polygon };
  const sel = items.find((p) => p.id === selected);
  const statusOf = (p: Placed): Status => status[p.id] ?? (p.model === undefined ? "searching" : p.model === null ? "none" : "loading");

  const makeView = useCallback((point?: Vec, ahead?: Vec): View => {
    const cam = scene.current?.camera() ?? { pos: { x: 0, y: 0, z: 0 }, forward: { x: 0, z: -1 } }, { selected, room, rooms } = state.current;
    return { camera: cam.pos, forward: cam.forward, floorY: floorY.current, point, ahead, room, rooms, selected };
  }, []);
  // Gives an item a model (and optionally a real size): the rendered size comes from the model's measured proportions,
  // and the item is re-seated so its new footprint stays inside its room.
  const withModel = useCallback((p: Placed, model: Model | null, size: Size = p.size, approxSize = p.approxSize): Placed => {
    const fitted = model?.bounds ? fitModel(model.bounds, size, p.planned)?.fitted : undefined;
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
    moved.current = false;
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
      let settle!: () => void;
      nav.current = new Promise<void>((r) => (settle = r)).then(() => new Promise((r) => setTimeout(r, SETTLE_MS)));
      setTimeout(() => settle(), 5000); // never block navigation if no start pano is reported (e.g. a dollhouse start)
      scene.current = await createScene(s, onLoad);
      if (process.env.NODE_ENV !== "production") (window as unknown as { __furnish: unknown }).__furnish = scene.current; // for e2e tests
      s.Pointer.intersection.subscribe((i) => { if (i.position && Math.abs(i.position.y - floorY.current) < 0.15) pointer.current = { ...i.position }; });
      s.Sweep.current.subscribe((sw) => {
        if (sw.sid) settle();
        if (sw.puckPosition) floorY.current = sw.puckPosition.y;
        const r = report.floorplan?.rooms.find((x) => x.id === sw.roomInfo?.id);
        setRoom(r ? { id: r.id, label: r.label, polygon: r.polygon, ceiling: r.heightFt ? r.heightFt * M_PER_FT : undefined } : undefined);
      });
      // Matterport's own controls can change the view too; mirror them (transitions are skipped).
      s.Mode.current.subscribe((m) => {
        const next = m === s.Mode.Mode.DOLLHOUSE ? "dollhouse" : m === s.Mode.Mode.FLOORPLAN ? "floorplan" : m === s.Mode.Mode.INSIDE ? "inside" : null;
        if (next) setModeState(next);
      });
      setReady(true);
    })().catch((e) => { if (!dead) fail(e instanceof Error ? e.message : String(e)); });
    return () => { dead = true; clearTimeout(timeout); scene.current?.destroy(); scene.current = null; viewer.current?.remove(); };
  }, [sid, report.floorplan, onFail, onLoad]);

  useEffect(() => { scene.current?.sync(items, selected); save(`hermit:furnish:${sid}`, items, "local"); }, [items, selected, sid, ready]);
  useEffect(() => { setPopover(null); }, [selected]);
  useEffect(() => {
    if (!toast || (undoText && toast !== undoText)) setUndoText(null);
    if (!toast) return;
    const t = setTimeout(() => setToast(null), undoText ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [toast, undoText]);
  const navigate = useCallback((move: (s: MpSdk) => Promise<unknown>) => {
    const s = sdk.current;
    if (!s) return Promise.resolve();
    return (nav.current = nav.current.then(() => move(s)).catch(() => null));
  }, []);
  const goTo = useCallback((index: number) => {
    const id = report.floorplan?.rooms.flatMap((r) => r.sweeps ?? []).find((s) => s.index === index)?.id;
    if (!id) return;
    void navigate((s) => {
      const first = !moved.current; // the first move jumps, so there's no fly-through over a half-loaded start pano
      moved.current = true;
      return s.Sweep.moveTo(id, first ? { transition: s.Sweep.Transition.INSTANT } : {});
    });
  }, [report.floorplan, navigate]);
  useEffect(() => { if (ready && stop != null) goTo(stop); }, [stop, ready, goTo]);

  // Matterport refuses a switch while the camera is still moving, so retry briefly; the Mode subscription updates the buttons.
  const setMode = useCallback((m: ViewMode) => navigate(async (s) => {
    const to = { inside: s.Mode.Mode.INSIDE, dollhouse: s.Mode.Mode.DOLLHOUSE, floorplan: s.Mode.Mode.FLOORPLAN }[m];
    for (let i = 0; i < 5; i++) {
      if (await s.Mode.moveTo(to).then(() => true, () => false)) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  }), [navigate]);
  // Picking a room: walking, go stand in it; from above, just outline it.
  const pickRoom = useCallback((id: string | undefined) => {
    setPicked(id);
    const r = rooms.find((x) => x.id === id);
    const sweep = r && report.floorplan?.rooms.find((x) => x.id === r.id)?.sweeps?.[0];
    if (sweep && state.current.mode === "inside") void navigate((s) => s.Sweep.moveTo(sweep.id));
  }, [rooms, report.floorplan, navigate]);
  // Walking into another room makes it the target again.
  useEffect(() => { if (state.current.mode === "inside") setPicked((p) => (p === room?.id ? p : undefined)); }, [room?.id]);

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
        setItems((cur) => cur.map((x) => (x.id === p.id && x.terms === p.terms && x.model === undefined
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
    return undefined;
  }, []);

  // The item list before each change made through apply or furnish, newest last; undo restores the last one.
  const history = useRef<Placed[][]>([]);
  // A run of key nudges to one item (each within NUDGE_MERGE_MS of the last) is one undo step.
  const lastNudge = useRef<{ id: string; at: number } | null>(null);
  const commit = useCallback((before: Placed[], r: FurnishResult, nudge?: string) => {
    if (r.value !== before) {
      const now = Date.now(), merge = !!nudge && lastNudge.current?.id === nudge && now - lastNudge.current.at < NUDGE_MERGE_MS;
      if (!merge) history.current = [...history.current.slice(-(MAX_UNDO - 1)), before];
      lastNudge.current = nudge ? { id: nudge, at: now } : null;
    }
    setItems(r.value);
    setUndoText(null); // a later edit makes the furnish Undo button stale
    setSelected(r.selected);
    return r;
  }, []);
  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return "Nothing to undo.";
    lastNudge.current = null;
    // Ids are max+1, so an undone item's id comes back on the next add; forget its model lookups so that item gets its own.
    const ids = new Set(prev.map((p) => p.id));
    for (const refs of [sized.current, lookingUp.current]) for (const id of refs) if (!ids.has(id)) refs.delete(id);
    setItems(prev);
    setSelected((s) => (prev.some((p) => p.id === s) ? s : undefined));
    return "Undid the last change.";
  }, []);
  const apply = useCallback((ops: object[], point?: Vec, ahead?: Vec, max?: number, nudge?: string) => {
    const before = state.current.items;
    return commit(before, applyFurnishOps(before, ops, makeView(point, ahead), max), nudge);
  }, [makeView, commit]);

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
    let press: { x: number; y: number } | null = null; // a click on the floor from above selects that room
    const block = (e: Event) => { if (drag) { e.stopPropagation(); e.preventDefault(); } };
    // The floor under the cursor; with an item, kept fully inside whichever room it's in (rotated footprint) and at its
    // own height, so a TV dragged off its stand stays TV-high (it follows the floor point, not the furniture under it).
    const floorPoint = (e: { clientX: number; clientY: number }, item?: { id: string; rotY: number }) => {
      const p = scene.current!.floorAt(e.clientX, e.clientY, el.getBoundingClientRect(), floorY.current);
      const it = item && state.current.items.find((x) => x.id === item.id);
      return p && it ? settle({ ...p, y: it.pos.y }, dims(it), item!.rotY, makeView()) : p;
    };
    const onDown = (e: PointerEvent) => {
      if (state.current.measuring) return; // clicks belong to Matterport's measure tool
      const r = scene.current?.ray(e.clientX, e.clientY, el.getBoundingClientRect());
      const id = r && hitItem(r.origin, r.dir, state.current.items);
      const p = id && state.current.items.find((x) => x.id === id);
      if (!p) { press = state.current.mode === "inside" ? null : { x: e.clientX, y: e.clientY }; return; }
      drag ={ id: p.id, x: e.clientX, y: e.clientY, moved: false, rotY: p.rotY, startRot: p.rotY };
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
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) {
        const at = scene.current?.floorAt(e.clientX, e.clientY, el.getBoundingClientRect(), floorY.current);
        const hit = at && state.current.rooms.find((r) => pointInPolygon(toPlan(at), r.polygon));
        if (hit) { setPicked(hit.id); setSelected(undefined); }
      }
      press = null;
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

  // Keyboard: Esc closes a popover, then deselects; arrows nudge; R rotates; Delete removes; T toggles the tray; Ctrl/Cmd+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (popover || state.current.selected)) { e.stopPropagation(); if (popover) setPopover(null); else setSelected(undefined); return; }
      if (typing(e) || !ready) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); setToast(undo()); return; }
      const p = state.current.items.find((x) => x.id === state.current.selected);
      if (!p) return;
      if (e.key === "r" || e.key === "R") { e.preventDefault(); apply([{ op: "rotate", id: p.id, degrees: e.shiftKey ? -15 : 15 }], undefined, undefined, undefined, p.id); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); apply([{ op: "remove", id: p.id }]); }
      const a = ({ ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>)[e.key];
      if (a) {
        e.preventDefault();
        const f = scene.current!.camera().forward; // nudge relative to where the user is looking
        apply([{ op: "move", id: p.id, at: "point" }], { x: p.pos.x + (f.x * a[0] - f.z * a[1]) * NUDGE_M, y: p.pos.y, z: p.pos.z + (f.z * a[0] + f.x * a[1]) * NUDGE_M }, undefined, undefined, p.id);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [popover, ready, apply, undo]);

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
      const outline = svg.querySelector("polygon")!, ring = state.current.outline;
      const pts = ring?.map((q) => s.screenOf({ x: q.x, y: floorY.current + 0.02, z: -q.y }, rect));
      if (pts?.length && pts.every((q) => q && !q.behind)) {
        outline.setAttribute("points", pts.map((q) => `${q!.x - stage.left},${q!.y - stage.top}`).join(" "));
        outline.style.display = "";
      } else outline.style.display = "none";
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

  /** The current floor's rooms with an outline, and a matcher for a room the user named ("bedroom" matches "bedroom 2"). */
  function roomsNamed(name?: string) {
    const g = report.floorplan, here = g?.rooms.find((r) => r.id === room?.id);
    const floor = g && here ? g.rooms.filter((r) => r.floorId === here.floorId && r.polygon.length >= 3) : [];
    const want = name?.toLowerCase().replace(/\s+room$/, "");
    const named = (r: { label: string }) => !!want && (r.label === want || r.label.startsWith(want));
    return { g, here, floor, want, named };
  }

  /** "Furnish this place": the layout planner picks items for the user's use and places them in the target rooms. Only
   *  rooms on the current floor: the floor height is only known where the user stands. With `clear` (refurnish) the
   *  target rooms, or everything, are emptied first so pieces don't stack; one undo restores the old layout. Returns the reply to show. */
  async function furnish(req: FurnishRequest, message: string, clear?: "room" | "all"): Promise<string> {
    const { g, here, floor, want, named } = roomsNamed(req.room);
    if (!g || !here) return "Walk into a room that's on the floor plan first, then ask again.";
    // Without a named room, "this room" is the one picked in the room select (or the one the user stands in).
    const pick = floor.find((r) => r.id === targetRoom?.id) ?? here;
    const targets = req.scope === "all" || (!want && picked === ALL) ? floor : want ? floor.filter(named) : [pick];
    if (!targets.length) return g.rooms.some(named) ? `The ${want} is on another floor. Go there and ask again.` : `I couldn't find a ${want} on the floor plan.`;
    setToast(`Planning ${targets.length === 1 ? `the ${targets[0].label}` : `${targets.length} rooms`}…`);
    const ordered = [...targets].sort((a, b) => Number(b.id === here.id) - Number(a.id === here.id)); // this room gets first pick of the item budget
    // Clears the furnish targets (a named room isn't necessarily the one the camera is in).
    const keep = (list: Placed[]) => clear === "all" ? [] : clear === "room"
      ? targets.reduce((cur, t) => applyFurnishOps(cur, [{ op: "clear", scope: "room" }], { ...makeView(), room: t }).value, list) : list;
    const ctx = hermitContext();
    const out = await json<{ ops: object[]; reply: string }>("/api/furniture/plan", {
      text: [message, ctx && `What the client told Hermit: ${ctx}`].filter(Boolean).join(". ").slice(0, 500),
      use: use.slice(0, 80), rooms: planRooms(g, ordered.slice(0, 12).map((r) => r.id)),
      placed: keep(state.current.items).slice(0, 60).map((p) => ({ name: p.name, pos: { x: p.pos.x, z: p.pos.z, y: p.pos.y - floorY.current }, size: dims(p), rotY: p.rotY })),
      ...(chairIn && { access: { chairWidthIn: chairIn } }), ...(clear && { fresh: true }),
    });
    if (clear && !out.ops.length) return "I couldn't fit a new layout, so I left the room as it was.";
    // The outlines carry no fixtures: probe each new piece against the tour's surfaces (only what's in view, within
    // PROBE_MS) and drop the ones that would sit on a built-in counter, with what depends on them. Unchecked pieces stay.
    const base = keep(state.current.items), blocked = new Set<number>();
    const rect = viewer.current?.getBoundingClientRect(), end = Date.now() + PROBE_MS;
    for (const [i, op] of out.ops.entries()) {
      if (!scene.current || !rect || Date.now() > end) break;
      const p = applyFurnishOps(base, [op], makeView()).value[base.length]; // the piece this op adds, if valid
      if (p && (await scene.current.probe({ pos: p.pos, size: dims(p), rotY: p.rotY }, floorY.current, rect)).blocked) blocked.add(i);
    }
    const { keep: ops, skipped } = dropBlocked(out.ops, blocked);
    if (clear && !ops.length) return "I couldn't fit a new layout, so I left the room as it was.";
    // Re-read the items: models may have loaded while the planner and the probe ran.
    const before = state.current.items, r = commit(before, applyFurnishOps(keep(before), ops, makeView(), ops.length));
    const note = skipped ? ` Skipped ${skipped} piece${skipped > 1 ? "s" : ""} that would sit on built-in counters or fixtures (checked what's in view).` : "";
    const msg = (r.rejected.length ? `${out.reply} I couldn't place part of it: ${rejectedText(r.rejected)}.` : out.reply) + note;
    if (r.applied.length) {
      setUndoText(msg); setTab("placed");
      if (targets.length > 1 && state.current.mode === "inside") void setMode("dollhouse"); // see the whole result at once
      noteToHermit({ role: "hermit", agent: "furnish", text: `In the 3D tour of ${report.name.split(" · ")[0]}: ${msg}` });
    }
    return msg;
  }
  // The "Furnish this room / everything" button.
  async function furnishPicked() {
    if (busy || !ready) return;
    const all = picked === ALL, message = all ? "furnish everything" : "furnish this room";
    setBusy(true);
    try { setToast(await furnish({ op: "furnish", scope: all ? "all" : "room" }, message)); }
    catch { setToast("I couldn't plan that just now. Try again in a moment."); }
    finally { setBusy(false); }
  }

  // A request from the floating Hermit chat; returns the reply for the chat to show.
  async function send(t: string): Promise<string> {
    const message = t.trim();
    if (!message) return "";
    if (!ready) return "The 3D tour is still loading. Try again in a moment.";
    setBusy(true);
    try {
      const out = await json<{ ops: object[]; reply: string }>("/api/furniture/edit", {
        text: message, items: items.map(({ id, name }) => ({ id, name })), selected, room: picked === ALL ? "whole space" : targetRoom?.name ?? room?.label, suggestions,
      });
      const kind = (o: object) => (o as { op?: string }).op;
      if (out.ops.some((o) => kind(o) === "undo")) return undo();
      const i = out.ops.findIndex((o) => kind(o) === "furnish");
      if (i >= 0) {
        noteToHermit({ role: "user", text: message });
        const clear = out.ops.slice(0, i).find((o) => kind(o) === "clear") as { scope: "room" | "all" } | undefined; // refurnish
        return await furnish(out.ops[i] as FurnishRequest, message, clear?.scope);
      }
      // "Empty the bedroom" clears the named room on this floor, not the one the camera is in.
      const clearIn = (out.ops.find((o) => kind(o) === "clear") as { room?: string } | undefined)?.room;
      const f = roomsNamed(clearIn), named = clearIn ? f.floor.find(f.named) : undefined;
      if (clearIn && !named) return `I couldn't find a ${f.want} on this floor.`;
      const before = state.current.items;
      const r = !out.ops.length ? null : named ? commit(before, applyFurnishOps(before, out.ops, { ...makeView(), room: named }))
        : apply(out.ops, pointer.current, await visibleAhead());
      return !r?.rejected.length ? out.reply : !r.applied.length ? `I couldn't do that: ${rejectedText(r.rejected)}.` : `${out.reply} I couldn't do part of that: ${rejectedText(r.rejected)}.`;
    } catch {
      return "Something went wrong reaching the assistant. Try again, or use the furniture bar.";
    } finally { setBusy(false); }
  }
  useEffect(() => { if (api) api.current = { ready, send }; });
  useEffect(() => () => { if (api) api.current = null; }, [api]);

  async function runSearch(terms: string[], name: string) {
    setTab("search"); setResults(null);
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
          <polygon className="room-outline" style={{ display: "none" }} />
          {Array.from({ length: 6 }, (_, i) => <g key={i} style={{ display: "none" }}><line /><text textAnchor="middle" /></g>)}
        </svg>
        {ready && (
          <div className="furnish-bar" role="toolbar" aria-label="Views and rooms">
            <div className="seg" role="group" aria-label="View">
              {MODES.map(([m, l, Icon]) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => void setMode(m)} title={l}><Icon aria-hidden="true" /><span>{l}</span></button>
              ))}
            </div>
            {rooms.length > 0 && <>
              <label className="furnish-room">
                <span className="sr-only">Room to work on</span>
                <select value={picked === ALL ? ALL : targetRoom?.id ?? ""} onChange={(e) => pickRoom(e.target.value || undefined)}>
                  {!targetRoom && picked !== ALL && <option value="">Pick a room</option>}
                  <option value={ALL}>Whole space ({furnishable.length} rooms)</option>
                  {floorRooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.id === here?.id ? " (you're here)" : ""}</option>)}
                </select>
              </label>
              <button type="button" className="btn small primary" disabled={busy} onClick={() => void furnishPicked()}>
                {busy ? <Loader aria-hidden="true" /> : <Sparkles aria-hidden="true" />} {picked === ALL ? "Furnish everything" : "Furnish this room"}
              </button>
            </>}
          </div>
        )}
        {ready && mode !== "inside" && rooms.length > 0 && !measuring && !sel && <p className="furnish-tip">Click a room to work on it</p>}
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

        {toast && (
          <p className="furnish-toast" role="status">{toast}
            {undoText === toast && <button type="button" className="btn small" onClick={() => { setUndoText(null); setToast(undo()); }}><Undo2 aria-hidden="true" /> Undo</button>}
          </p>
        )}
        {busy && <p className="furnish-busy" role="status"><Loader aria-hidden="true" /> Hermit is arranging…</p>}
      </div>

      <div className="furnish-tray" aria-label="Furniture">
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
      </div>
    </div>
  );
}
