"use client";
import { Bookmark, BookmarkCheck, Box, Check, FileText, LandPlot, Mail, MapPin, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { accessLine, areaOf, highlights } from "@/lib/chat/present";
import type { RequirementSpec, ShellReport } from "@/lib/types";

const cityOf = (address: string) => address.split(", ").slice(-2).join(", ");

export function BuildingArt({ kind }: { kind?: string }) {
  const home = kind === "home";
  return (
    <svg viewBox="0 0 172 160" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustration (no photo on record)" style={{ width: "100%", height: "100%", borderRadius: 14, background: "linear-gradient(#cdeefa, #eaf8fd)" }}>
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

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

// Zillow-style headline: the asking price when the listing has one, otherwise the size.
function headline(r: ShellReport, area?: number): { text: string; priced: boolean } | null {
  const l = r.listing;
  if (l?.askingRate) return { text: `${money(l.askingRate)}/sf/yr`, priced: true };
  if (l?.price) return { text: l.kind === "lease" ? `${money(l.price)}/mo` : money(l.price), priced: true };
  return area ? { text: `${Math.round(area).toLocaleString()} sq ft`, priced: false } : null;
}

// Listing evidence first (never claim "listed" without it), then measured vs record-only.
function status(r: ShellReport) {
  const evidence = r.badge === "scan-verified" ? { label: "measured", cls: "verified" } : { label: "record only", cls: "record" };
  const listed = r.listing?.status === "active" ? { label: r.listing.kind === "sale" ? "For sale" : "For lease", cls: "listed" } : null;
  return { listed, evidence };
}

function facts(r: ShellReport, area: number | undefined, price?: string): string[] {
  const out: string[] = [];
  if (price) out.push(price);
  if (area) out.push(`${Math.round(area).toLocaleString()} sq ft`);
  const a = r.fit?.assignment ?? [];
  if (a.length) out.push(`${a.filter((x) => x.roomId).length}/${a.length} rooms matched`);
  const stalls = r.rules.find((h) => h.rule === "parking")?.detail.match(/^(\d+) recorded stalls/)?.[1];
  if (stalls) out.push(`${stalls} parking`);
  return out;
}

export function SpaceCard({ report, spec, selected, saved, index, onSelect, onEmail, onDetails, onSave, onView, onParcel, extra, emailLabel = "Email manager" }: {
  report: ShellReport; spec: RequirementSpec; selected: boolean; saved: boolean; index?: number;
  onSelect: () => void; onEmail: () => void; onDetails: () => void; onSave: () => void; onView: () => void; onParcel?: () => void;
  extra?: React.ReactNode; emailLabel?: string; // extra: the studio's score, verdict and crew flags
}) {
  const area = areaOf(report);
  const head = headline(report, area);
  const { listed, evidence } = status(report);
  const access = accessLine(report, spec);
  return (
    <article className="space" data-selected={selected} onClick={onSelect} aria-labelledby={`sp-${report.shellId}`}>
      <div className="space-photo">
        <Thumb report={report} />
        {index !== undefined && <span className="space-pin" aria-hidden="true">{index + 1}</span>}
        <span className="space-badges">
          {listed && <span className={`badge-src ${listed.cls}`}>{listed.label}</span>}
          <span className={`badge-src ${evidence.cls}`}>{evidence.label}</span>
        </span>
        <button type="button" className="space-save" aria-pressed={saved} onClick={(e) => { e.stopPropagation(); onSave(); }}>
          {saved ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />} {saved ? "Saved" : "Save"}
        </button>
      </div>
      <div className="space-body">
        <h3 id={`sp-${report.shellId}`}>
          <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(); }} aria-pressed={selected}>{report.name.split(" · ")[0]}</button>
        </h3>
        <p className="space-facts num">{facts(report, area, head?.priced ? head.text : undefined).join(" · ")}</p>
        <div className="meta"><MapPin aria-hidden="true" /> {cityOf(report.address)}</div>
        <ul>{highlights(report, spec).map((h) => {
          const concern = h === access?.text && !access.ok; // a door problem must not wear a checkmark
          return <li key={h}>{concern ? <TriangleAlert aria-hidden="true" style={{ color: "var(--warn)" }} /> : <Check aria-hidden="true" />} {concern && <span className="sr-only">Concern: </span>}{h}</li>;
        })}</ul>
        {extra}
        <div className="space-actions">
          <button type="button" className="btn small primary" onClick={(e) => { e.stopPropagation(); onEmail(); }}><Mail aria-hidden="true" /> {emailLabel}</button>
          <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); onView(); }}><Box aria-hidden="true" /> View property</button>
          <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); onDetails(); }}><FileText aria-hidden="true" /> Full report</button>
          {onParcel && <button type="button" className="btn small" onClick={(e) => { e.stopPropagation(); onParcel(); }}><LandPlot aria-hidden="true" /> Parcel info</button>}
        </div>
      </div>
    </article>
  );
}
