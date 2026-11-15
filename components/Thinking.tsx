"use client";
import { Accessibility, ArrowUpDown, Car, CircleCheck, CircleX, DollarSign, Eye, FileText, Flame, Gavel, LayoutGrid, Ruler, Search, Tag, TriangleAlert, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { Step } from "@/lib/chat/present";

const ICONS: Record<string, typeof Search> = { search: Search, gavel: Gavel, bolt: Zap, flame: Flame, car: Car, accessible: Accessibility, tag: Tag, ruler: Ruler, layout: LayoutGrid, dollar: DollarSign, x: CircleX, eye: Eye, sort: ArrowUpDown, doc: FileText, check: CircleCheck, alert: TriangleAlert };
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// The crew's checks: while running, the crab scuttles along the shore and each check rises in one at a time;
// when done, a collapsed list so finished chats stay compact.
export function Thinking({ steps, running }: { steps: Step[]; running: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= steps.length) return;
    const t = setTimeout(() => setShown((n) => Math.min(steps.length, n + 1)), reduceMotion() ? 0 : 520);
    return () => clearTimeout(t);
  }, [shown, steps.length]);

  const revealing = running || shown < steps.length;
  if (revealing) {
    const visible = steps.slice(0, shown);
    const pct = steps.length ? Math.round((visible.length / Math.max(steps.length, visible.length + 1)) * 100) : 8;
    return (
      <div className="bubble thinking" role="status" aria-label="Hermit is thinking">
        <div className="thinking-head">Thinking <span className="dots" aria-hidden="true"><span /><span /><span /></span></div>
        <div className="shore" aria-hidden="true">
          <div className="water" style={{ width: `${Math.max(8, pct)}%` }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="crab" src="/hermit-logo.svg" alt="" style={{ left: `calc(${Math.max(8, pct)}% - 30px)` }} />
        </div>
        {visible.map((s, i) => {
          const Icon = ICONS[s.icon] ?? Search;
          const active = i === visible.length - 1;
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
