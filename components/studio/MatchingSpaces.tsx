"use client";
import { Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { savedShells, toggleSaved } from "@/lib/client/persist";
import type { Block } from "@/lib/spec/parse";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { isBuying, ParcelInfo } from "../ParcelInfo";
import { PropertyViewer } from "../PropertyViewer";
import { ResultsMap } from "../ResultsMap";
import { SpaceCard } from "../SpaceCard";

// Map + cards in rank order; the score stays internal, never shown.
export function MatchingSpaces({ reports, spec, runId, running, onOpen, selected, onSelect, design, viewIndex, onViewIndex }: {
  reports: ShellReport[]; spec: RequirementSpec; runId: string | null; running: boolean; onOpen: (r: ShellReport) => void;
  design?: Block[]; viewIndex?: number | null; onViewIndex?: (i: number | null) => void;
  selected: number; onSelect: (i: number) => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [ownView, setOwnView] = useState<number | null>(null);
  const [parcelFor, setParcelFor] = useState<ShellReport | null>(null);
  useEffect(() => {
    const load = () => setSaved(Object.fromEntries(savedShells().map((s) => [s.shellId, true])));
    load();
    window.addEventListener("hermit:saved", load);
    return () => window.removeEventListener("hermit:saved", load);
  }, [reports]);
  useEffect(() => { if (selected >= reports.length) onSelect(0); }, [reports.length, selected, onSelect]);

  const viewAt = onViewIndex ? viewIndex ?? null : ownView;
  const setView = onViewIndex ?? setOwnView;
  const viewing = viewAt != null ? reports[viewAt] : undefined;
  const details = (r: ShellReport) => (runId ? router.push(`/shell/${r.shellId}?run=${runId}&tab=overview`) : onOpen(r));

  return (
    <section className="card results-card" aria-labelledby="matches-title">
      <div className="results-head">
        <h2 id="matches-title"><Layers aria-hidden="true" /> Matching Spaces</h2>
        <span className="muted" role="status">{running ? "Searching…" : `${reports.length} result${reports.length === 1 ? "" : "s"}`}</span>
      </div>
      {reports.length > 0 && <ResultsMap reports={reports} selected={selected} onSelect={(i) => { onSelect(i); document.getElementById(`sp-${reports[i].shellId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }} />}
      <div className="results-list">
        {!reports.length && (
          <div style={{ padding: "40px 20px", textAlign: "center", gridColumn: "1 / -1" }} className="muted">
            {running ? "The crew is checking spaces. Matches will appear here." : "No shell passed every check. Try relaxing a requirement in the chat."}
          </div>
        )}
        {reports.map((r, i) => {
          const unverified = (r.buildout ?? []).filter((b) => b.status !== "seen");
          return (
            <SpaceCard key={r.shellId} index={i} report={r} spec={spec} selected={i === selected} saved={!!saved[r.shellId]}
              onSelect={() => onSelect(i)}
              onSave={() => { const on = runId ? toggleSaved(r, runId) : false; setSaved((s) => ({ ...s, [r.shellId]: on })); }}
              onDetails={() => details(r)} onView={() => setView(i)}
              onParcel={isBuying(spec, r) ? () => setParcelFor(r) : undefined}
              extra={
                <div className="space-crew">
                  <div className="space-verdict">
                    <p><strong>{r.verdict}.</strong> About <span className="num">{r.weeksToOpen[0]}–{r.weeksToOpen[1]}</span> weeks to open.</p>
                  </div>
                  {r.conflicts?.[0] && <p className="postcard-flag" role="note">Heads up: {r.conflicts[0].name} ({r.conflicts[0].what}) is {r.conflicts[0].where}. Possible exclusive.</p>}
                  {unverified.length > 0 && <p className="chips-line">{unverified.slice(0, 3).map((b) => <span key={b.item} className="chip-unv">{b.item}: unverified</span>)}</p>}
                </div>
              } />
          );
        })}
      </div>
      {viewing && <PropertyViewer key={viewing.shellId} report={viewing} use={spec.useType} design={design} onClose={() => setView(null)} />}
      {parcelFor && <ParcelInfo report={parcelFor} onClose={() => setParcelFor(null)} />}
    </section>
  );
}
