"use client";
import { Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { savedShells, toggleSaved } from "@/lib/client/persist";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { isBuying, ParcelInfo } from "../ParcelInfo";
import { ResultsMap } from "../ResultsMap";
import { SpaceCard } from "../SpaceCard";

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
          return (
            <SpaceCard key={r.shellId} index={i} report={r} spec={spec} selected={i === selected} saved={!!saved[r.shellId]}
              onSelect={() => onSelect(i)}
              onSave={() => { const on = runId ? toggleSaved(r, runId) : false; setSaved((s) => ({ ...s, [r.shellId]: on })); }}
              onDetails={() => details(r)}
              onParcel={isBuying(spec, r) ? () => setParcelFor(r) : undefined}
              extra={
                <div className="space-crew">
                  <div className="space-verdict">
                    <p><strong>{r.verdict}.</strong> About <span className="num">{r.weeksToOpen[0]}–{r.weeksToOpen[1]}</span> weeks to open.</p>
                  </div>
                  {r.conflicts?.[0] && <p className="postcard-flag" role="note">Heads up: {r.conflicts[0].name} ({r.conflicts[0].what}) is {r.conflicts[0].where}. Possible exclusive.</p>}
                </div>
              } />
          );
        })}
      </div>
      {parcelFor && <ParcelInfo report={parcelFor} onClose={() => setParcelFor(null)} />}
    </section>
  );
}
