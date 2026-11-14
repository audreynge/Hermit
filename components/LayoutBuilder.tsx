"use client";
import { useRef, useState } from "react";
import type { Block } from "@/lib/spec/parse";

const W = 60, H = 40, PX = 10;
const PRESETS: { label: string; w: number; h: number }[] = [
  { label: "office", w: 10, h: 12 }, { label: "exam room", w: 10, h: 12 }, { label: "bathroom", w: 7, h: 8 },
  { label: "reception", w: 14, h: 12 }, { label: "conference", w: 14, h: 16 }, { label: "kitchen", w: 10, h: 10 },
  { label: "storage", w: 6, h: 8 }, { label: "open", w: 20, h: 20 },
];

export function LayoutBuilder({ blocks, onChange }: { blocks: Block[]; onChange: (b: Block[]) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [custom, setCustom] = useState("");

  const update = (id: string, patch: Partial<Block>) =>
    onChange(blocks.map((b) => (b.id === id ? clamp({ ...b, ...patch }) : b)));

  const add = (label: string, w: number, h: number) => {
    let x = 0, y = 0;
    outer: for (y = 0; y <= H - h; y += 2) for (x = 0; x <= W - w; x += 2)
      if (!blocks.some((b) => x < b.x + b.w && b.x < x + w && y < b.y + b.h && b.y < y + h)) break outer;
    const b = clamp({ id: `b${Date.now().toString(36)}${blocks.length}`, label, x, y, w, h });
    onChange([...blocks, b]);
    setSel(b.id);
  };

  const pt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onKey = (e: React.KeyboardEvent, b: Block) => {
    const step = e.shiftKey ? 5 : 1;
    const moves: Record<string, Partial<Block>> = {
      ArrowLeft: { x: b.x - step }, ArrowRight: { x: b.x + step }, ArrowUp: { y: b.y - step }, ArrowDown: { y: b.y + step },
      "+": { w: b.w + 1, h: b.h + 1 }, "=": { w: b.w + 1, h: b.h + 1 }, "-": { w: b.w - 1, h: b.h - 1 },
    };
    if (moves[e.key]) { e.preventDefault(); update(b.id, moves[e.key]); }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onChange(blocks.filter((x) => x.id !== b.id)); setSel(null); }
  };

  const area = blocks.reduce((s, b) => s + b.w * b.h, 0);

  return (
    <div className="stack">
      <div className="row" role="group" aria-label="Add a room">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="btn ghost small" onClick={() => add(p.label, p.w, p.h)}>+ {p.label}</button>
        ))}
        <span className="row">
          <label className="sr-only" htmlFor="custom-room">Custom room name</label>
          <input id="custom-room" style={{ width: 160 }} placeholder="custom room" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button type="button" className="btn ghost small" disabled={!custom.trim()} onClick={() => { add(custom.trim(), 10, 10); setCustom(""); }}>Add</button>
        </span>
      </div>
      <p className="muted" id="layout-help">
        Drag rooms, or focus one and use arrow keys to move (Shift for 5 ft), + / − to resize, Delete to remove. Grid squares are 5 ft.
      </p>
      <svg
        ref={svg} viewBox={`0 0 ${W * PX} ${H * PX}`} width="100%" role="application" aria-describedby="layout-help"
        aria-label={`Layout canvas, ${blocks.length} rooms, ${area} square feet`}
        style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, touchAction: "none", maxWidth: 720 }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = pt(e);
          update(drag.current.id, { x: Math.round(p.x - drag.current.dx), y: Math.round(p.y - drag.current.dy) });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        {Array.from({ length: W / 5 + 1 }, (_, i) => <line key={`v${i}`} x1={i * 50} x2={i * 50} y1={0} y2={H * PX} stroke="var(--line)" strokeWidth={0.5} />)}
        {Array.from({ length: H / 5 + 1 }, (_, i) => <line key={`h${i}`} y1={i * 50} y2={i * 50} x1={0} x2={W * PX} stroke="var(--line)" strokeWidth={0.5} />)}
        {blocks.map((b) => (
          <g
            key={b.id} tabIndex={0} role="button" aria-pressed={sel === b.id}
            aria-label={`${b.label}, ${b.w} by ${b.h} feet at ${b.x}, ${b.y}`}
            onFocus={() => setSel(b.id)} onKeyDown={(e) => onKey(e, b)}
            onPointerDown={(e) => { const p = pt(e); drag.current = { id: b.id, dx: p.x - b.x, dy: p.y - b.y }; setSel(b.id); }}
            style={{ cursor: "grab", outline: "none" }}
          >
            <rect x={b.x * PX} y={b.y * PX} width={b.w * PX} height={b.h * PX} rx={4}
              fill={sel === b.id ? "var(--highlight)" : "var(--surface-2)"} stroke={sel === b.id ? "var(--ink)" : "var(--action)"} strokeWidth={sel === b.id ? 3 : 1.5} />
            <text x={b.x * PX + 6} y={b.y * PX + 18} fontSize={13} fill="var(--ink)">{b.label}</text>
            <text x={b.x * PX + 6} y={b.y * PX + 34} fontSize={11} fill="var(--ink-soft)">{b.w}×{b.h} ft</text>
          </g>
        ))}
      </svg>
      {blocks.length > 0 && <p className="num">{blocks.length} rooms · {area.toLocaleString()} sf drawn</p>}
    </div>
  );
}

function clamp(b: Block): Block {
  const w = Math.max(3, Math.min(W, b.w)), h = Math.max(3, Math.min(H, b.h));
  return { ...b, w, h, x: Math.max(0, Math.min(W - w, b.x)), y: Math.max(0, Math.min(H - h, b.y)) };
}
