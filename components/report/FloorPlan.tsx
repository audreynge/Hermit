"use client";
import { useId, useMemo, useState } from "react";
import { ghost, ghostText } from "@/lib/geometry/ghost";
import { nearestOnBoundary, pointInPolygon, type Pt } from "@/lib/geometry/polygon";
import type { RoomGraph, ShellReport } from "@/lib/types";
import { Furniture } from "../studio/Furniture";
import type { PlacedItem } from "./shared";
import s from "./FloorPlan.module.css";

const FT = 0.3048;
const SQFT_M2 = 10.7639;
// Rooms with an outline. When a scan has no wall geometry, rooms become squares of their measured area laid out
// in rows, so furniture can still be checked against real floor area (marked as approximate).
export function roomsWithShape(g: RoomGraph): RoomGraph["rooms"] {
  const real = g.rooms.filter((r) => r.polygon.length >= 3);
  if (real.length >= Math.max(1, g.rooms.length * 0.6)) return real;
  const out: RoomGraph["rooms"] = [];
  let x = 0, y = 0, rowH = 0;
  const rowW = Math.sqrt(g.rooms.reduce((s, r) => s + r.areaSqft, 0) / SQFT_M2) * 1.6;
  for (const r of g.rooms.filter((r) => r.areaSqft > 4).sort((a, b) => b.areaSqft - a.areaSqft)) {
    const side = Math.sqrt(r.areaSqft / SQFT_M2);
    if (x + side > rowW && x > 0) { x = 0; y += rowH + 0.3; rowH = 0; }
    out.push({ ...r, polygon: [{ x, y }, { x: x + side, y }, { x: x + side, y: y + side }, { x, y: y + side }] });
    x += side + 0.3; rowH = Math.max(rowH, side);
  }
  return out;
}
/**
 * Where a room's label goes: the vertex average when it's comfortably inside, else the inside point farthest from the
 * walls (an L-shaped hallway's average can land in another room, hiding its label). `width` is the free run across
 * the room at that height, so the label can be sized to fit.
 */
export function labelSpot(poly: Pt[], others: Pt[][] = []): Pt & { width: number; clear: number } {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Scanned outlines can overlap (a hallway drawn under the rooms off it): keep clear of the other rooms too.
  const near = others.filter((o) => o.some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) || o.some((p) => pointInPolygon(p, poly)));
  const clear = (p: Pt) => {
    if (!pointInPolygon(p, poly) || near.some((o) => pointInPolygon(p, o))) return -1;
    return Math.min(nearestOnBoundary(p, poly).dist, ...near.map((o) => nearestOnBoundary(p, o).dist));
  };
  const avg = { x: xs.reduce((s, v) => s + v, 0) / poly.length, y: ys.reduce((s, v) => s + v, 0) / poly.length };
  let best = avg, bestR = clear(avg);
  const avgR = bestR;
  const N = 16;
  for (let i = 0.5; i < N; i++) for (let j = 0.5; j < N; j++) {
    const p = { x: x0 + ((x1 - x0) * i) / N, y: y0 + ((y1 - y0) * j) / N }, r = clear(p);
    if (r > bestR) { best = p; bestR = r; }
  }
  if (avgR > 0 && avgR >= bestR * 0.75) { best = avg; bestR = avgR; }
  // Free width: the stretch of the horizontal line through the spot that lies inside the room.
  const cuts: number[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    if ((a.y <= best.y) !== (b.y <= best.y)) cuts.push(a.x + ((best.y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  cuts.sort((a, b) => a - b);
  let width = x1 - x0;
  for (let k = 0; k + 1 < cuts.length; k += 2) if (cuts[k] <= best.x && best.x <= cuts[k + 1]) width = cuts[k + 1] - cuts[k];
  return { ...best, width, clear: Math.max(0, bestR) };
}
/** A room's label lines: its name, "983 sq ft", and what it is now when your layout reuses it. */
export const labelLines = (name: string, sqft: number, convert?: string) => [name, `${Math.round(sqft)} sq ft`, ...(convert ? [`now ${convert}`] : [])];
export const isApproximate =(g: RoomGraph) => g.rooms.filter((r) => r.polygon.length >= 3).length < Math.max(1, g.rooms.length * 0.6);
export const mainFloor = (g: RoomGraph) => {
  const floors = [...new Set(g.rooms.map((r) => r.floorId))];
  const area = (f: string) => g.rooms.filter((r) => r.floorId === f).reduce((s, r) => s + r.areaSqft, 0);
  return floors.sort((a, b) => area(b) - area(a))[0];
};

// Plan colors sit on the plan's own white paper (.floorplan-svg), so they stay fixed in dark mode.
const INK = "#3b2320", SOFT_INK = "#5c4a45";
const MINE_FILL = "#fde3d4", MINE_HATCH = "#ee9f80", OTHER_FILL = "#f6f3ef", PICKED = "#b83d1f";
const VAGUE = new Set(["other", "open"]);

// Tiny legend swatches, drawn with the same fills and patterns as the plan.
function Swatch({ kind, hatch }: { kind: "mine" | "other" | "build"; hatch: string }) {
  return (
    <svg viewBox="0 0 1.2 0.8" width={22} height={15} aria-hidden="true" className={s.swatch}>
      {kind === "build"
        ? <rect x={0.05} y={0.05} width={1.1} height={0.7} rx={0.08} fill="none" stroke="currentColor" strokeWidth={0.07} strokeDasharray="0.16 0.1" />
        : <rect x={0.05} y={0.05} width={1.1} height={0.7} fill={kind === "mine" ? MINE_FILL : OTHER_FILL} stroke={INK} strokeWidth={kind === "mine" ? 0.09 : 0.04} />}
      {kind === "mine" && <rect x={0.05} y={0.05} width={1.1} height={0.7} fill={`url(#${hatch})`} />}
    </svg>
  );
}

// The measured floor plan from the scan (meters), with your layout laid over it: rooms that already serve your rooms
// are hatched and carry your room name; rooms you want that the scan doesn't have are listed under it as "To build".
// `report` gives the fit (and drawn layout); without it, matched rooms are read from `names` and nothing is "to build".
export function FloorPlan({ graph, names, highlight, items = [], selected, onRoom, onItem, height = 420, label, report }: {
  graph: RoomGraph; names: Map<string, string>; highlight?: string | null; items?: PlacedItem[]; selected?: string | null;
  onRoom?: (id: string) => void; onItem?: (id: string) => void; height?: number; label: string;
  report?: Pick<ShellReport, "fit" | "similarity">;
}) {
  const uid = useId().replace(/:/g, "");
  const hatch = `hatch-${uid}`;
  const [mine, setMine] = useState(true);
  const layout = useMemo(() => {
    const fit = report?.fit ?? {
      score: 0, edits: [], breakdown: {}, hardFails: [], unknowns: [],
      assignment: [...names].filter(([, n]) => !/^Room \d+$/.test(n)).map(([roomId, req]) => ({ req, roomId, cost: 0 })),
    };
    return ghost(fit, graph, { similarity: report?.similarity });
  }, [report, names, graph]);
  const matchOf = useMemo(() => new Map(layout.matched.map((m) => [m.roomId, m])), [layout]);

  const floor = mainFloor(graph);
  const approx = isApproximate(graph);
  const rooms = roomsWithShape(graph).filter((r) => approx || r.floorId === floor);
  if (!rooms.length) return <p className="muted pad">This scan has no wall outlines, so Hermit can&apos;t draw it to scale.</p>;
  const xs = rooms.flatMap((r) => r.polygon.map((p) => p.x)), ys = rooms.flatMap((r) => r.polygon.map((p) => p.y));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 0.6, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  // Matterport y grows "north"; flip so north is up on screen.
  const tx = (x: number) => x - minX + pad, ty = (y: number) => maxY - y + pad;

  const hasLayout = layout.matched.length > 0 || layout.toBuild.length > 0;
  const showMine = hasLayout && mine;
  const drawn = new Set(rooms.map((r) => r.id));
  const offPlan = layout.matched.filter((m) => !drawn.has(m.roomId)); // matched on another floor
  const roomName = (id: string) => {
    const r = graph.rooms.find((x) => x.id === id);
    const where = r && !drawn.has(id) ? " on another floor" : "";
    return r && !VAGUE.has(r.label) ? `scanned ${r.label}${where}` : `scanned room${where}`;
  };
  const build = layout.toBuild.filter((b) => !b.unsure), unsure = layout.toBuild.filter((b) => b.unsure);

  return (
    <div className={s.wrap}>
      {hasLayout && (
        <div className={s.bar}>
          <label className={s.toggle}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Show my layout
          </label>
          {showMine && (
            <ul className={s.legend} aria-label="Legend">
              <li><Swatch kind="mine" hatch={hatch} /> Your rooms</li>
              <li><Swatch kind="other" hatch={hatch} /> Other rooms in the scan</li>
              {layout.toBuild.length > 0 && <li><Swatch kind="build" hatch={hatch} /> To build</li>}
            </ul>
          )}
        </div>
      )}
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxHeight: height }} role="img" aria-label={label} className="floorplan-svg">
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width={0.35} height={0.35} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={0.35} stroke={MINE_HATCH} strokeWidth={0.07} />
          </pattern>
        </defs>
        {rooms.map((r) => {
          const m = showMine ? matchOf.get(r.id) : undefined;
          const on = highlight === r.id;
          const pts = r.polygon.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ");
          return (
            <g key={r.id} onClick={onRoom ? () => onRoom(r.id) : undefined} style={onRoom ? { cursor: "pointer" } : undefined}>
              <polygon points={pts} fill={on ? PICKED : m ? MINE_FILL : OTHER_FILL} stroke={INK} strokeWidth={on || m ? 0.1 : 0.05} />
              {m && !on && <polygon points={pts} fill={`url(#${hatch})`} pointerEvents="none" />}
            </g>
          );
        })}
        {/* Labels after every room, so a big room's label is never painted over by its neighbours. Name and size are
            separate lines; the " · " between them isn't drawn but keeps copied text readable ("Room 1 · 983 sq ft"). */}
        <g pointerEvents="none">
          {rooms.filter((r) => r.areaSqft > 35).map((r) => {
            const m = showMine ? matchOf.get(r.id) : undefined;
            const on = highlight === r.id;
            const stacked = labelLines((m ? m.label : names.get(r.id)) ?? r.label, r.areaSqft, m?.convert);
            const spot = labelSpot(r.polygon, rooms.filter((o) => o.id !== r.id).map((o) => o.polygon));
            // Larger labels, shrunk only when the longest line wouldn't fit across the room (~0.62 em per character)
            // or the lines wouldn't fit between the walls above and below. A long narrow hallway reads better on one
            // line ("Room 1 · 983 sq ft").
            const size = (ls: string[]) => Math.min(0.5, Math.sqrt(r.areaSqft) / 28,
              (spot.width * 0.85) / (0.62 * Math.max(6, ...ls.map((l) => l.length))), (spot.clear * 1.8) / (1.2 * ls.length));
            const single = [stacked.join(" · ")];
            const lines = size(single) > size(stacked) * 1.15 ? single : stacked;
            const fs = Math.max(0.2, size(lines));
            const ink = on ? "#fff" : m || !showMine ? INK : SOFT_INK;
            const x = tx(spot.x), top = ty(spot.y) - (fs * 1.2 * (lines.length - 1)) / 2 + fs * 0.35; // block centered on the spot
            const halo = { stroke: on ? "none" : m ? MINE_FILL : OTHER_FILL, strokeWidth: fs * 0.28, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
            return (
              <g key={r.id}>
                {lines.map((l, i) => [
                  i > 0 && " · ",
                  <text key={i} x={x} y={top + i * fs * 1.2} textAnchor="middle" fontSize={fs} fill={ink} fontWeight={m && i === 0 ? 700 : 400} {...halo}>{l}</text>,
                ])}
              </g>
            );
          })}
        </g>
        {items.map((it) => (
          <g key={it.id} transform={`translate(${tx(it.x)} ${ty(it.y + it.h)}) scale(${FT})`} onClick={onItem ? (e) => { e.stopPropagation(); onItem(it.id); } : undefined} style={onItem ? { cursor: "pointer" } : undefined}>
            <Furniture type={it.type} w={it.w / FT} h={it.h / FT} />
            {selected === it.id && <rect x={-0.3} y={-0.3} width={it.w / FT + 0.6} height={it.h / FT + 0.6} fill="none" stroke="#c2410c" strokeWidth={0.25} strokeDasharray="0.5 0.3" />}
          </g>
        ))}
      </svg>
      {showMine && (layout.toBuild.length > 0 || offPlan.length > 0) && (
        <div className={s.below} aria-hidden="true">
          {(build.length > 0 || unsure.length > 0) && (
            <ul className={s.chips}>
              {build.map((b) => <li key={b.label} className={s.chip}><span>To build:</span> <strong>{b.label}</strong>{b.sf ? <span className={s.sf}> · about {b.sf} sq ft</span> : null}</li>)}
              {unsure.map((b) => <li key={b.label} className={`${s.chip} ${s.unsure}`}><span>Not sure yet:</span> <strong>{b.label}</strong>{b.sf ? <span className={s.sf}> · about {b.sf} sq ft</span> : null}</li>)}
            </ul>
          )}
          {unsure.length > 0 && <p className={s.note}>The scan doesn&apos;t say what every room is, so Hermit couldn&apos;t tell if {unsure.length === 1 ? "this one is" : "these are"} already here. Worth asking the landlord.</p>}
          {offPlan.length > 0 && <p className={s.note}>On another floor: {offPlan.map((m) => m.label).join(", ")}.</p>}
        </div>
      )}
      {hasLayout && (
        <div className="sr-only">
          <h3>Your layout on this plan</h3>
          <ul>{ghostText(layout, roomName).map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
