"use client";
import { Minus } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

type Saved = { fx: number; fy: number; open: boolean };
const KEY = "hermit:guide-card";
const read = (): Saved | null => { try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as Saved) : null; } catch { return null; } };
const write = (v: Saved) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked: position resets next time */ } };
const clamp = (v: number) => Math.min(1, Math.max(0, v));

// Hermit's tour guide floating over the 3D tour. Drag the crab to move it (arrow keys too), shrink it to just the
// crab, and it stays where you left it. Position is a fraction of the stage, so it survives resizing.
export function GuideCard({ text, children, label = "Hermit's guided tour" }: { text: string; children?: ReactNode; label?: string }) {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ fx: number; fy: number } | null>(null); // null: the default top-left corner
  const [open, setOpen] = useState(true);
  const drag = useRef<{ dx: number; dy: number; x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => { const s = read(); if (s) { setPos({ fx: s.fx, fy: s.fy }); setOpen(s.open); } }, []);
  const save = (p: { fx: number; fy: number } | null, o: boolean) => write({ fx: p?.fx ?? 0, fy: p?.fy ?? 0, open: o });

  // Fraction of the free space: left = fx * (stage - card), so the card never leaves the stage.
  const toFrac = (left: number, top: number) => {
    const el = card.current, stage = el?.offsetParent as HTMLElement | null;
    if (!el || !stage) return null;
    return { fx: clamp(left / Math.max(1, stage.clientWidth - el.offsetWidth)), fy: clamp(top / Math.max(1, stage.clientHeight - el.offsetHeight)) };
  };
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    const el = card.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop, x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    d.moved = true;
    const f = toFrac(e.clientX - d.dx, e.clientY - d.dy);
    if (f) setPos(f);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) save(pos, open);
    else if (!open) { setOpen(true); save(pos, true); } // a tap on the shrunken crab opens it again
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 48 : 16;
    const m = ({ ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] } as Record<string, [number, number]>)[e.key];
    const el = card.current;
    if (!m || !el) return;
    e.preventDefault();
    const f = toFrac(el.offsetLeft + m[0], el.offsetTop + m[1]);
    if (f) { setPos(f); save(f, open); }
  };
  const style = pos ? { left: `${pos.fx * 100}%`, top: `${pos.fy * 100}%`, transform: `translate(${-pos.fx * 100}%, ${-pos.fy * 100}%)` } : undefined;

  return (
    <div ref={card} className="guide-card" data-open={open} style={style} role="region" aria-label={label}>
      <button type="button" className="gc-crab" aria-label={open ? "Move Hermit: drag, or use the arrow keys" : "Show Hermit's tour notes (drag or arrow keys to move)"}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }} onKeyDown={onKey}
        onClick={(e) => { if (e.detail === 0 && !open) { setOpen(true); save(pos, true); } }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hermit-logo.svg" alt="" draggable={false} />
      </button>
      <div className="gc-bubble" hidden={!open}>
        <button type="button" className="gc-min icon-btn" aria-label="Shrink Hermit to just the crab" onClick={() => { setOpen(false); save(pos, false); }}><Minus aria-hidden="true" /></button>
        <p aria-hidden="true">{text}</p>
        {children && <div className="gc-nav">{children}</div>}
      </div>
      {/* Always mounted, so screen readers hear each stop even while the card is shrunk. */}
      <p className="sr-only" aria-live="polite">{text}</p>
    </div>
  );
}
