"use client";
import { Accessibility, ArrowUpDown, Car, CircleCheck, CircleX, DollarSign, Eye, FileText, Flame, Gavel, LayoutGrid, Ruler, Search, Tag, TriangleAlert, Zap } from "lucide-react";
import type { thinkingSteps } from "@/lib/chat/present";

const ICONS: Record<string, typeof Search> = { search: Search, gavel: Gavel, bolt: Zap, flame: Flame, car: Car, accessible: Accessibility, tag: Tag, ruler: Ruler, layout: LayoutGrid, dollar: DollarSign, x: CircleX, eye: Eye, sort: ArrowUpDown, doc: FileText, check: CircleCheck, alert: TriangleAlert };

// The crab walks the shore as each check lands; "Here's what I checked" once the run is done.
export function Thinking({ steps, total, done }: { steps: ReturnType<typeof thinkingSteps>; total: number; done: boolean }) {
  const pct = done ? 100 : total ? Math.round((steps.length / Math.max(total, steps.length + 1)) * 100) : 8;
  return (
    <div className="bubble thinking" aria-label={done ? "Hermit finished checking" : "Hermit is thinking"}>
      <div className="thinking-head">{done ? "Here's what I checked" : <>Thinking <span className="dots" aria-hidden="true"><span /><span /><span /></span></>}</div>
      <div className="shore" aria-hidden="true">
        <div className="water" style={{ width: `${pct}%` }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="crab" src="/hermit-logo.svg" alt="" style={{ left: `calc(${pct}% - 30px)` }} />
      </div>
      {steps.map((s, i) => {
        const Icon = ICONS[s.icon] ?? Search;
        const active = !done && i === steps.length - 1;
        return (
          <div key={s.id} className={`think-step ${s.tone}${active ? " active" : ""}`}>
            <span className="ic"><Icon aria-hidden="true" /></span>
            <span>{s.label}</span>
            <span className="state">{active ? <span className="dots" aria-hidden="true"><span /><span /><span /></span> : <CircleCheck aria-hidden="true" />}</span>
          </div>
        );
      })}
    </div>
  );
}
