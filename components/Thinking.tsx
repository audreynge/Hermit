"use client";
import { Accessibility, ArrowUpDown, Car, CircleCheck, CircleX, DollarSign, Eye, FileText, Flame, Gavel, LayoutGrid, Ruler, Search, Tag, TriangleAlert, Zap } from "lucide-react";
import type { Step } from "@/lib/chat/present";

const ICONS: Record<string, typeof Search> = { search: Search, gavel: Gavel, bolt: Zap, flame: Flame, car: Car, accessible: Accessibility, tag: Tag, ruler: Ruler, layout: LayoutGrid, dollar: DollarSign, x: CircleX, eye: Eye, sort: ArrowUpDown, doc: FileText, check: CircleCheck, alert: TriangleAlert };

// The crew's checks as a small line under a chat message: the current step while running, a collapsed list when done.
export function Thinking({ steps, running }: { steps: Step[]; running: boolean }) {
  if (running) {
    return (
      <p className="think-now" role="status">
        <span className="dots" aria-hidden="true"><span /><span /><span /></span>
        Checking… {steps.at(-1)?.label ?? ""}
      </p>
    );
  }
  if (!steps.length) return null;
  return (
    <details className="think-done">
      <summary>Checked {steps.length} thing{steps.length === 1 ? "" : "s"}</summary>
      <ul>
        {steps.map((s) => {
          const Icon = ICONS[s.icon] ?? Search;
          return <li key={s.id} className={s.tone}><Icon aria-hidden="true" /> {s.label}</li>;
        })}
      </ul>
    </details>
  );
}
