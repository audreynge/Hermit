"use client";
/* eslint-disable @next/next/no-img-element -- decorative SVG */
import { Check } from "lucide-react";
import type { TraceEvent } from "@/lib/types";

// Each step completes on a real trace event, so the bar shows measured progress, never a timer.
const STEPS: { label: string; done: (e: TraceEvent) => boolean }[] = [
  { label: "Scanning listings", done: (e) => e.type === "tool" && e.tool === "search_shells" },
  { label: "Checking space fit & layout", done: (e) => e.type === "report" },
  { label: "Ranking best matches", done: (e) => e.type === "done" },
];

export function SearchProgress({ events }: { events: TraceEvent[] }) {
  const done = STEPS.map((s) => events.some(s.done));
  const active = done.indexOf(false);
  const pct = Math.round((done.filter(Boolean).length / STEPS.length) * 100);
  return (
    <div className="search-progress" role="status" aria-label="Finding matching spaces">
      {/* The crab scuttles sideways between little sand puffs while the crew works. */}
      <div className="run-track" aria-hidden="true">
        <span className="run-dust">{Array.from({ length: 8 }, (_, i) => <span key={i} />)}</span>
        <img className="run-crab" src="/hermit-assets/beach/crab.webp" width={420} height={318} alt="" />
      </div>
      <strong>Finding matching spaces<span className="hermit-loading-dots" aria-hidden="true"><span /><span /><span /></span></strong>
      <div className="hermit-progress-track" aria-hidden="true"><div className="hermit-progress-fill" style={{ width: `${Math.max(pct, 6)}%` }} /></div>
      <ol className="search-steps">
        {STEPS.map((s, i) => (
          <li key={s.label} data-state={done[i] ? "done" : i === active ? "active" : "todo"}>
            <span className="search-step-dot" aria-hidden="true">{done[i] && <Check strokeWidth={3} />}</span>
            {s.label}<span className="sr-only">{done[i] ? " (done)" : i === active ? " (in progress)" : ""}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
