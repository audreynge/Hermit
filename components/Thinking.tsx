"use client";
import { Accessibility, ArrowUpDown, Car, ChevronDown, CircleCheck, CircleX, DollarSign, Eye, FileText, Flame, Gavel, LayoutGrid, Ruler, Search, Tag, TriangleAlert, Zap } from "lucide-react";
import type { Step } from "@/lib/chat/present";

const ICONS: Record<string, typeof Search> = { search: Search, gavel: Gavel, bolt: Zap, flame: Flame, car: Car, accessible: Accessibility, tag: Tag, ruler: Ruler, layout: LayoutGrid, dollar: DollarSign, x: CircleX, eye: Eye, sort: ArrowUpDown, doc: FileText, check: CircleCheck, alert: TriangleAlert };

// The crew's checks under the chat message that started the search.
export function Thinking({ steps, running }: { steps: Step[]; running: boolean }) {
  if (!steps.length && !running) return null;
  const list = (
    <ul>
      {steps.map((s, i) => {
        const Icon = ICONS[s.icon] ?? Search;
        const live = running && i === steps.length - 1;
        return <li key={s.id} className={`${s.tone} hermit-enter`} data-live={live || undefined}><Icon aria-hidden="true" /> {s.label}</li>;
      })}
    </ul>
  );
  // Live while the crew works; once done, folded into a dropdown the user can open.
  if (running) return <div className="think-list"><p className="think-head" role="status">Checking…<span className="sr-only"> {steps.at(-1)?.label ?? ""}</span></p>{list}</div>;
  return <details className="think-list"><summary className="think-head">Checked {steps.length} thing{steps.length === 1 ? "" : "s"}<ChevronDown aria-hidden="true" className="think-toggle" /></summary>{list}</details>;
}
