"use client";
import { RotateCcw, RotateCw } from "lucide-react";
import { useRef, useState } from "react";

export type Solid = { id: string; label?: string; polygon: { x: number; y: number }[]; height: number; fill: string; stroke?: string; dashed?: boolean; cap?: boolean }; // cap: a solid box (furniture) with a lid, kept at true height

const D = Math.PI / 180;
const VIEW = { yaw: -35, pitch: 38 };

// Dependency-free extruded view: painter's-sorted SVG faces under a yaw/pitch orbit. Units are feet, z up.
export function Plan3D({ solids, label, height = 380, wallScale = 1 }: { solids: Solid[]; label: string; height?: number; wallScale?: number }) {
  const [view, setView] = useState(VIEW);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const pts = solids.flatMap((s) => s.polygon);
  if (!pts.length) return <p className="muted" style={{ padding: 16 }}>Nothing to build in 3D yet.</p>;

  const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2;
  const cy = (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2;
  const hOf = (s: Solid) => (s.cap ? s.height : s.height * wallScale);
  const maxH = Math.max(...solids.map(hOf));
  const R = Math.max(10, ...pts.map((p) => Math.hypot(p.x - cx, p.y - cy))) * 0.9 + maxH * 0.35;
  const [cs, sn, cp, sp] = [Math.cos(view.yaw * D), Math.sin(view.yaw * D), Math.cos(view.pitch * D), Math.sin(view.pitch * D)];
  const proj = (x: number, y: number, z: number) => {
    const xr = (x - cx) * cs - (y - cy) * sn, yr = (x - cx) * sn + (y - cy) * cs;
    return { sx: xr, sy: yr * sp - z * cp, depth: yr };
  };
  const path = (ps: { sx: number; sy: number }[]) => `M${ps.map((p) => `${p.sx.toFixed(2)},${p.sy.toFixed(2)}`).join("L")}Z`;

  const floors = solids.map((s) => ({ s, d: path(s.polygon.map((p) => proj(p.x, p.y, 0))) }));
  const walls = solids.flatMap((s) => {
    const h = hOf(s);
    const sides = s.polygon.map((a, i) => {
      const b = s.polygon[(i + 1) % s.polygon.length];
      const q = [proj(a.x, a.y, 0), proj(b.x, b.y, 0), proj(b.x, b.y, h), proj(a.x, a.y, h)];
      // Shade by how squarely the wall faces a fixed light from the upper left of the screen.
      const nx = (b.y - a.y), ny = -(b.x - a.x), len = Math.hypot(nx, ny) || 1;
      const lit = Math.abs(((nx * cs - ny * sn) * -0.6 + (nx * sn + ny * cs) * 0.8) / len);
      return { s, key: `${s.id}-${i}`, d: path(q), depth: (q[0].depth + q[1].depth) / 2, shade: 0.06 + 0.22 * (1 - lit) };
    });
    if (!s.cap) return sides;
    const lid = s.polygon.map((p) => proj(p.x, p.y, h));
    return [...sides, { s, key: `${s.id}-lid`, d: path(lid), depth: Math.max(...lid.map((p) => p.depth)) + 0.01, shade: 0 }];
  }).sort((a, b) => a.depth - b.depth);
  const tops = solids.filter((s) => s.label).map((s) => {
    const n = s.polygon.length;
    const c = proj(s.polygon.reduce((t, p) => t + p.x, 0) / n, s.polygon.reduce((t, p) => t + p.y, 0) / n, 0);
    return { s, c };
  });

  const nudge = (dy: number, dp: number) => setView((v) => ({ yaw: (v.yaw + dy) % 360, pitch: Math.min(88, Math.max(12, v.pitch + dp)) }));
  return (
    <div className="plan3d">
      <svg viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} height={height} width="100%" role="img" tabIndex={0}
        aria-label={`${label}. 3D view, rotated ${Math.round(((view.yaw % 360) + 360) % 360)} degrees. Drag or use arrow keys to orbit.`}
        onKeyDown={(e) => {
          const k: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, 6], ArrowDown: [0, -6] };
          if (k[e.key]) { e.preventDefault(); nudge(...k[e.key]); }
        }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ...view }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setView({ yaw: d.yaw + (e.clientX - d.x) * 0.5, pitch: Math.min(88, Math.max(12, d.pitch + (e.clientY - d.y) * 0.3)) }); }}
        onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}
        style={{ touchAction: "none", cursor: "grab" }}>
        {floors.map(({ s, d }) => <path key={s.id} d={d} fill={s.fill} stroke={s.stroke ?? "#6b4a3a"} strokeWidth={R / 260} strokeDasharray={s.dashed ? `${R / 60} ${R / 90}` : undefined} />)}
        {walls.map((w) => (
          <g key={w.key}>
            <path d={w.d} fill={w.s.fill} fillOpacity={w.s.dashed ? 0.35 : 0.92} stroke={w.s.stroke ?? "#6b4a3a"} strokeWidth={R / 320} strokeLinejoin="round" />
            <path d={w.d} fill="#3b2320" fillOpacity={w.shade} pointerEvents="none" />
          </g>
        ))}
        {tops.map(({ s, c }) => (
          <text key={s.id} x={c.sx} y={c.sy} textAnchor="middle" fontSize={R / 17} fontWeight={800} fill="#3b2320" stroke="#fffaf5" strokeWidth={R / 120} paintOrder="stroke" pointerEvents="none">{s.label}</text>
        ))}
      </svg>
      <div className="plan3d-controls">
        <button type="button" className="btn small" onClick={() => nudge(-30, 0)} aria-label="Rotate left"><RotateCcw aria-hidden="true" /></button>
        <button type="button" className="btn small" onClick={() => nudge(30, 0)} aria-label="Rotate right"><RotateCw aria-hidden="true" /></button>
        <button type="button" className="btn small" onClick={() => setView((v) => ({ ...v, pitch: v.pitch > 70 ? VIEW.pitch : 88 }))}>{view.pitch > 70 ? "Tilt" : "Top down"}</button>
        <button type="button" className="btn small" onClick={() => setView(VIEW)}>Reset</button>
      </div>
    </div>
  );
}

// Shared converters so the drawn layout and a Matterport scan render on the same footing.
export const M_TO_FT = 3.28084;
// ponytail: older bundles stored heightFt already in ft×3.28; anything over 16 ft in a suite is treated as that unit bug.
export const roomHeight = (h?: number) => (!h ? 9 : h > 16 ? h / M_TO_FT : h);
export const rectPoly = (b: { x: number; y: number; w: number; h: number }) => [
  { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h },
];
export const PAIR_COLORS = ["#f58a6b", "#8ecae6", "#9bd18f", "#f6c35b", "#c7a6f0", "#f29fc0", "#7fd1c7", "#e6a57e", "#a7b8f2", "#d4c06a"];
