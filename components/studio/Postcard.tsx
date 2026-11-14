"use client";
import { BadgeCheck, FileQuestion } from "lucide-react";
import type { ShellReport } from "@/lib/types";
import { Aerial } from "../Aerial";

export function ScoreRing({ value, size = 56 }: { value: number; size?: number }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" role="img" aria-label={`${value}% match`}>
      <circle cx={28} cy={28} r={r} fill="var(--card)" stroke="var(--line-strong)" strokeWidth={5} />
      <circle cx={28} cy={28} r={r} fill="none" stroke="var(--accent-text)" strokeWidth={5} strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 28 28)" strokeLinecap="round" />
      <text x={28} y={33} textAnchor="middle" fontSize={15} fontWeight={800} fill="var(--ink)">{value}</text>
    </svg>
  );
}

export function Postcard({ report, onOpen, vetoedBy }: { report: ShellReport; onOpen: () => void; vetoedBy?: string }) {
  const verified = report.badge === "scan-verified";
  const built = report.fit.assignment.filter((a) => a.roomId).length;
  return (
    <article className="postcard">
      <div className="postcard-photo">
        {report.above ? <Aerial report={report} /> : <div className="postcard-nophoto">No coordinates on record</div>}
        <span className={`stamp ${verified ? "ok" : "rec"}`}>{verified ? <BadgeCheck aria-hidden="true" /> : <FileQuestion aria-hidden="true" />}{verified ? "Scan-verified" : "Record-only"}</span>
        <span className="postcard-rank">#{report.rank}</span>
        <span className="postcard-cap">From above · Esri imagery (Vexcel pending)</span>
      </div>
      <div className="postcard-body">
        <div className="postcard-title">
          <div>
            <h3>{report.name}</h3>
            <p className="muted">{report.address || "Address not in the index"}{report.sqft ? ` · ${report.sqft.toLocaleString()} sf` : ""}</p>
          </div>
          <ScoreRing value={report.matchScore} />
        </div>
        <p className="postcard-verdict"><strong>{report.verdict}.</strong> {built} of {report.fit.assignment.length} rooms already built · {report.work.length ? `${report.work.length} work items` : "no build-out found"} · <span className="num">{report.weeksToOpen[0]}–{report.weeksToOpen[1]}</span> weeks to open</p>
        {vetoedBy && <p className="postcard-veto">{vetoedBy}</p>}
        <button type="button" className="btn primary" onClick={onOpen}>Step inside</button>
      </div>
    </article>
  );
}
