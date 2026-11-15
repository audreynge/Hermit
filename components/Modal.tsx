"use client";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "a[href], button:not([disabled]), input, textarea, select, summary, [tabindex]:not([tabindex='-1'])";

export function Modal({ title, onClose, children, wide = false, className = "" }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass inline arrows; keep the latest in a ref so parent re-renders don't re-run the focus effect.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key !== "Tab" || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = els[0], last = els.at(-1);
      if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, []);
  // Portal to <body>: inside <main> the dialog shares main's stacking context and the site header paints over it.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close.current(); }}>
      <div ref={ref} className={`card modal${wide ? " wide" : ""}${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header>
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
