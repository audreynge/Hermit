"use client";
import type { RoomGraph } from "@/lib/types";
import { Furniture } from "../studio/Furniture";
import type { FurnType } from "@/lib/spec/furnish";
import type { PlacedItem } from "./shared";

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
export const isApproximate = (g: RoomGraph) => g.rooms.filter((r) => r.polygon.length >= 3).length < Math.max(1, g.rooms.length * 0.6);
export const mainFloor = (g: RoomGraph) => {
  const floors = [...new Set(g.rooms.map((r) => r.floorId))];
  const area = (f: string) => g.rooms.filter((r) => r.floorId === f).reduce((s, r) => s + r.areaSqft, 0);
  return floors.sort((a, b) => area(b) - area(a))[0];
};

// The measured floor plan from the scan (meters), with your room names and any furniture you placed.
export function FloorPlan({ graph, names, highlight, items = [], selected, onRoom, onItem, height = 420, label }: {
  graph: RoomGraph; names: Map<string, string>; highlight?: string | null; items?: PlacedItem[]; selected?: string | null;
  onRoom?: (id: string) => void; onItem?: (id: string) => void; height?: number; label: string;
}) {
  const floor = mainFloor(graph);
  const approx = isApproximate(graph);
  const rooms = roomsWithShape(graph).filter((r) => approx || r.floorId === floor);
  if (!rooms.length) return <p className="muted pad">This scan has no wall outlines, so Hermit can&apos;t draw it to scale.</p>;
  const xs = rooms.flatMap((r) => r.polygon.map((p) => p.x)), ys = rooms.flatMap((r) => r.polygon.map((p) => p.y));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 0.6, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  // Matterport y grows "north"; flip so north is up on screen.
  const tx = (x: number) => x - minX + pad, ty = (y: number) => maxY - y + pad;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxHeight: height }} role="img" aria-label={label} className="floorplan-svg">
      {rooms.map((r) => {
        const name = names.get(r.id);
        const on = highlight === r.id;
        const pts = r.polygon.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ");
        const cx = r.polygon.reduce((s, p) => s + tx(p.x), 0) / r.polygon.length, cy = r.polygon.reduce((s, p) => s + ty(p.y), 0) / r.polygon.length;
        const fs = Math.max(0.22, Math.min(0.45, Math.sqrt(r.areaSqft) / 40));
        return (
          <g key={r.id} onClick={onRoom ? () => onRoom(r.id) : undefined} style={onRoom ? { cursor: "pointer" } : undefined}>
            <polygon points={pts} fill={on ? "#f26a4b" : name ? "#fde3d4" : "#f3efe9"} fillOpacity={on ? 0.9 : 1} stroke="#3b2320" strokeWidth={0.06} />
            {r.areaSqft > 35 && <text x={cx} y={cy} textAnchor="middle" fontSize={fs} fill={on ? "#fff" : "#3b2320"} fontWeight={700}>
              <tspan x={cx}>{name ?? r.label}</tspan><tspan x={cx} dy={fs * 1.2} fontWeight={400}>{Math.round(r.areaSqft)} sf</tspan>
            </text>}
          </g>
        );
      })}
      {items.map((it) => (
        <g key={it.id} transform={`translate(${tx(it.x)} ${ty(it.y + it.h)}) scale(${FT})`} onClick={onItem ? (e) => { e.stopPropagation(); onItem(it.id); } : undefined} style={onItem ? { cursor: "pointer" } : undefined}>
          <Furniture type={it.type as FurnType} w={it.w / FT} h={it.h / FT} />
          {selected === it.id && <rect x={-0.3} y={-0.3} width={it.w / FT + 0.6} height={it.h / FT + 0.6} fill="none" stroke="#c2410c" strokeWidth={0.25} strokeDasharray="0.5 0.3" />}
        </g>
      ))}
    </svg>
  );
}
