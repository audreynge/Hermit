"use client";
import { Bookmark, BookmarkCheck, Box, Check, FileText, Grid2x2, Mail, MapPin, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { accessLine, areaOf, highlights } from "@/lib/chat/present";
import type { RequirementSpec, ShellReport } from "@/lib/types";

const cityOf = (address: string) => address.split(", ").slice(-2).join(", ");

export function BuildingArt({ kind }: { kind?: string }) {
  const home = kind === "home";
  return (
    <svg viewBox="0 0 172 160" role="img" aria-label="Illustration (no photo on record)" style={{ width: "100%", height: "100%", borderRadius: 14, background: "linear-gradient(#cdeefa, #eaf8fd)" }}>
      <circle cx="140" cy="30" r="14" fill="#ffd9a0" />
      <rect x="0" y="122" width="172" height="38" fill="#cfe9b8" />
      {home ? (
        <g><path d="M46 84 L86 52 L126 84 Z" fill="#f58a6b" /><rect x="54" y="84" width="64" height="44" fill="#fff6ee" stroke="#e8c4b0" /><rect x="78" y="100" width="16" height="28" fill="#f2c8b2" /><rect x="60" y="92" width="12" height="12" fill="#bfe3f2" /><rect x="100" y="92" width="12" height="12" fill="#bfe3f2" /></g>
      ) : (
        <g><rect x="34" y="58" width="104" height="70" rx="4" fill="#fff6ee" stroke="#e8c4b0" /><rect x="34" y="52" width="104" height="10" rx="3" fill="#f58a6b" />
          {[0, 1, 2, 3].map((i) => <rect key={i} x={44 + i * 23} y="70" width="16" height="18" rx="2" fill="#bfe3f2" />)}
          <rect x="74" y="98" width="24" height="30" rx="2" fill="#bfe3f2" stroke="#8cc7de" /></g>
      )}
      <circle cx="24" cy="118" r="12" fill="#8fd07c" /><rect x="22" y="118" width="4" height="12" fill="#a77b5a" />
    </svg>
  );
}

export function Thumb({ report }: { report: ShellReport }) {
  const [failed, setFailed] = useState(false);
  if (!report.inside || failed) return <div className="thumb"><BuildingArt kind={report.useTags?.[0]} /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="thumb" src={`/api/asset/${report.inside.sid}`} alt={`Inside ${report.name.split(" · ")[0]}`} onError={() => setFailed(true)} />;
}

export function SpaceCard({ report, spec, selected, saved, onSelect, onEmail, onDetails, onSave, onView }: {
  report: ShellReport; spec: RequirementSpec; selected: boolean; saved: boolean;
  onSelect: () => void; onEmail: () => void; onDetails: () => void; onSave: () => void; onView: () => void;
}) {
  const area = areaOf(report);
  const access = accessLine(report, spec);
  return (
    <article className="space" data-selected={selected} onClick={onSelect} aria-labelledby={`sp-${report.shellId}`}>
      <Thumb report={report} />
      <div style={{ minWidth: 0 }}>
        <h3 id={`sp-${report.shellId}`}>
          <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(); }} style={{ all: "unset", cursor: "pointer" }} aria-pressed={selected}>{report.name.split(" · ")[0]}</button>
        </h3>
        <span className="fit-badge">{report.rank === 1 && <Sparkles aria-hidden="true" />}{report.matchScore}% Fit</span>
        <div className="meta"><MapPin aria-hidden="true" /> {cityOf(report.address)}</div>
        {area && <div className="meta"><Grid2x2 aria-hidden="true" /> <span className="num">{Math.round(area).toLocaleString()} sq ft</span> <span className={`badge-src ${report.badge === "scan-verified" ? "verified" : "record"}`}>{report.badge === "scan-verified" ? "measured" : "record only"}</span></div>}
        <ul>{highlights(report, spec).map((h) => {
          const concern = h === access?.text && !access.ok; // a door problem must not wear a checkmark
          return <li key={h}>{concern ? <TriangleAlert aria-hidden="true" style={{ color: "var(--warn)" }} /> : <Check aria-hidden="true" />} {concern && <span className="sr-only">Concern: </span>}{h}</li>;
        })}</ul>
        <div className="space-actions">
          <button type="button" className="btn small primary" onClick={(e) => { e.stopPropagation(); onEmail(); }}><Mail aria-hidden="true" /> Email manager</button>
          <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); onView(); }}><Box aria-hidden="true" /> View property</button>
          <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); onDetails(); }}><FileText aria-hidden="true" /> Full report</button>
          <button type="button" className="btn small" aria-pressed={saved} onClick={(e) => { e.stopPropagation(); onSave(); }}>
            {saved ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />} {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
    </article>
  );
}
