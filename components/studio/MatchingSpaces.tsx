"use client";
import { Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { savedShells, toggleSaved } from "@/lib/client/persist";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { openingWeeks, openLine } from "@/lib/uses/rooms";
import { isBuying, ParcelInfo } from "../ParcelInfo";
import { ResultsMap } from "../ResultsMap";
import { SpaceCard } from "../SpaceCard";
import { PropertySkeleton } from "../coastal/PropertySkeleton";

const PLACE: Record<string, string> = { houston: "Houston, TX", los_angeles: "Los Angeles, CA" };

// Map + cards in rank order; the score stays internal, never shown.
export function MatchingSpaces({ reports, spec, runId, running, onOpen, selected, onSelect }: {
  reports: ShellReport[]; spec: RequirementSpec; runId: string | null; running: boolean; onOpen: (r: ShellReport) => void;
  selected: number; onSelect: (i: number) => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [parcelFor, setParcelFor] = useState<ShellReport | null>(null);
  useEffect(() => {
    const load = () => setSaved(Object.fromEntries(savedShells().map((s) => [s.shellId, true])));
    load();
    window.addEventListener("hermit:saved", load);
    return () => window.removeEventListener("hermit:saved", load);
  }, [reports]);
  useEffect(() => { if (selected >= reports.length) onSelect(0); }, [reports.length, selected, onSelect]);

  // Carousel paging: one dot per screenful of cards, read from the scroller so it follows the breakpoint.
  const list = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState({ page: 0, count: 1 });
  const measure = useCallback(() => {
    const el = list.current;
    if (el) setPages({ page: Math.round(el.scrollLeft / el.clientWidth), count: Math.max(1, Math.ceil((el.scrollWidth - 4) / el.clientWidth)) });
  }, []);
  useEffect(() => { measure(); window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, [measure, reports.length]);
  const toPage = (i: number) => list.current?.scrollTo({ left: i * list.current.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

  const details = (r: ShellReport) => (runId ? router.push(`/shell/${r.shellId}?run=${runId}&tab=overview`) : onOpen(r));

  return (
    <section className="card results-card" aria-labelledby="matches-title">
      <div className="results-head">
        <h2 id="matches-title"><Layers aria-hidden="true" /> Matching Spaces</h2>
        <span className="muted" role="status">{running ? "Searching…" : `${reports.length} result${reports.length === 1 ? "" : "s"}`}</span>
      </div>
      {reports.length > 0 && <ResultsMap reports={reports} place={PLACE[spec.city]} selected={selected} onSelect={(i) => { onSelect(i); document.getElementById(`sp-${reports[i].shellId}`)?.closest("article")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }} />}
      {!reports.length && (running
        ? <PropertySkeleton count={2} />
        : <p className="muted results-empty">No shell passed every check. Try relaxing a requirement in the chat.</p>)}
      <div className="results-list" ref={list} onScroll={measure} aria-busy={running}>
        {reports.map((r, i) => {
          return (
            <SpaceCard key={r.shellId} index={i} enterDelay={Math.min(i * 70, 350)} report={r} spec={spec} selected={i === selected} saved={!!saved[r.shellId]}
              onSelect={() => onSelect(i)}
              onSave={() => { const on = runId ? toggleSaved(r, runId) : false; setSaved((s) => ({ ...s, [r.shellId]: on })); }}
              onDetails={() => details(r)}
              onParcel={isBuying(spec, r) ? () => setParcelFor(r) : undefined}
              extra={
                <div className="space-crew">
                  <div className="space-verdict">
                    <p><strong>{r.verdict}.</strong> {openLine(openingWeeks(r, spec), spec.mode === "home")}</p>
                  </div>
                  {r.conflicts?.[0] && <p className="postcard-flag" role="note">Heads up: {r.conflicts[0].name} ({r.conflicts[0].what}) is {r.conflicts[0].where}. Possible exclusive.</p>}
                </div>
              } />
          );
        })}
      </div>
      {pages.count > 1 && (
        <div className="results-dots" role="group" aria-label="Result pages">
          {Array.from({ length: pages.count }, (_, i) => (
            <button key={i} type="button" aria-label={`Page ${i + 1} of ${pages.count}`} aria-current={i === pages.page || undefined} onClick={() => toPage(i)} />
          ))}
        </div>
      )}
      {parcelFor && <ParcelInfo report={parcelFor} onClose={() => setParcelFor(null)} />}
    </section>
  );
}
