"use client";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Block } from "@/lib/spec/parse";
import { LayoutStudio } from "./LayoutStudio";

export function DesignSheet({ onDone, onClose, initial, doneLabel = "Use this layout" }: { onDone: (blocks: Block[]) => void; onClose: () => void; initial?: Block[]; doneLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    // Escape closes only the topmost dialog: leave it to a pop-up opened from inside the sheet.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && document.querySelectorAll('[role="dialog"]').length < 2) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);
  // Portal to <body> like Modal: inside <main> the site header paints over the sheet's backdrop.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="card modal sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <header>
          <div>
            <h2 id="sheet-title">Build your layout</h2>
            <p className="muted">Drag and drop room blocks to sketch the space you need.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>
        </header>
        <LayoutStudio onDone={onDone} doneLabel={doneLabel} initial={initial} />
      </div>
    </div>,
    document.body,
  );
}
