"use client";
import { Accessibility, ArrowUpDown, Car, ChevronRight, CircleCheck, CircleX, DollarSign, Eye, FileText, Flame, Gavel, LayoutGrid, Ruler, Search, Tag, TriangleAlert, Zap } from "lucide-react";
import type { Step } from "@/lib/chat/present";

const ICONS: Record<string, typeof Search> = { search: Search, gavel: Gavel, bolt: Zap, flame: Flame, car: Car, accessible: Accessibility, tag: Tag, ruler: Ruler, layout: LayoutGrid, dollar: DollarSign, x: CircleX, eye: Eye, sort: ArrowUpDown, doc: FileText, check: CircleCheck, alert: TriangleAlert };
const LIVE = 3; // while searching, only the newest few checks; the full story is in "How Hermit decided"

// Hermit's checks under the chat message that started the search. Once done, one line points to "How Hermit decided"
// (components/studio/CrewTrace.tsx), so the decisions live in one place instead of two lists.
export function Thinking({ steps, running, decided, onShow }: { steps: Step[]; running: boolean; decided?: string; onShow?: () => void }) {
  if (running) {
    if (!steps.length) return <div className="think-list"><p className="think-head" role="status">Checking…</p></div>;
    return (
      <div className="think-list">
        <p className="think-head" role="status">Checking…<span className="sr-only"> {steps.at(-1)?.label ?? ""}</span></p>
        <ul>
          {steps.slice(-LIVE).map((s, i, shown) => {
            const Icon = ICONS[s.icon] ?? Search;
            return <li key={s.id} className={`${s.tone} hermit-enter`} data-live={i === shown.length - 1 || undefined}><Icon aria-hidden="true" /> {s.label}</li>;
          })}
        </ul>
      </div>
    );
  }
  if (!steps.length || !onShow) return null;
  return (
    <button type="button" className="think-list think-jump" onClick={onShow}>
      <span className="think-head">How Hermit decided</span>
      <span className="think-jump-line">{decided || `Checked ${steps.length} thing${steps.length === 1 ? "" : "s"}.`} See each step.</span>
      <ChevronRight aria-hidden="true" className="think-toggle" />
    </button>
  );
}
