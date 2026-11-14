"use client";
import { useState } from "react";
import { esriStreetTile, esriTile, tileFor } from "@/lib/geometry/tiles";
import type { ShellReport } from "@/lib/types";

const VIEWS = [["ortho", "Top-down"], ["oblique-north", "Looking north"], ["oblique-east", "Looking east"], ["oblique-south", "Looking south"], ["oblique-west", "Looking west"]] as const;

const HEADING: Record<string, number | undefined> = { "oblique-north": 0, "oblique-east": 90, "oblique-south": 180, "oblique-west": 270 };

// Street-map locator so first-time viewers know where the photo is; the arrow shows which way an angled photo faces.
function MiniMap({ lat, lon, facing }: { lat: number; lon: number; facing?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const z = 15, S = 150;
  const t = tileFor(lat, lon, z);
  const offX = (1 + t.fx) * 256, offY = (1 + t.fy) * 256;
  return (
    <div className="minimap" role="img" aria-label={`Street map locating the property${facing !== undefined ? `; photo faces ${["north", "east", "south", "west"][facing / 90]}` : ""}`}>
      <div style={{ position: "absolute", left: `calc(50% - ${offX}px)`, top: `calc(50% - ${offY}px)`, width: 768, height: 768 }}>
        {[-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${dx}${dy}`} alt="" src={esriStreetTile(z, t.x + dx, t.y + dy)} width={256} height={256} onError={() => setFailed(true)} style={{ position: "absolute", left: (dx + 1) * 256, top: (dy + 1) * 256 }} />
        )))}
      </div>
      <svg width="100%" height="100%" viewBox={`0 0 ${S} ${S}`} aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
        {facing !== undefined && (
          <g transform={`rotate(${facing} ${S / 2} ${S / 2})`}>
            <path d={`M${S / 2} ${S / 2 - 34} L${S / 2 - 16} ${S / 2 + 4} L${S / 2 + 16} ${S / 2 + 4} Z`} fill="#111" fillOpacity={0.28} />
          </g>
        )}
        <circle cx={S / 2} cy={S / 2} r={7} fill="#f26a4b" stroke="#fff" strokeWidth={2.5} />
      </svg>
      <span className="minimap-n" aria-hidden="true">N ↑</span>
      <span className="minimap-credit">Esri</span>
    </div>
  );
}

// Vexcel aerial + oblique photos; falls back to Esri tiles when Vexcel has no top-down image here.
export function Aerial({ report }: { report: ShellReport }) {
  const [view, setView] = useState<(typeof VIEWS)[number][0]>("ortho");
  const [missing, setMissing] = useState<Set<string>>(new Set());
  if (!report.above) return <p className="muted" style={{ padding: 16 }}>No coordinates on record for this property.</p>;
  if (missing.has("ortho")) return <EsriAerial report={report} />;
  const label = VIEWS.find(([k]) => k === view)![1];
  return (
    <div className="aerial-view">
      <div role="group" aria-label="Vexcel camera angle" className="angles">
        {VIEWS.filter(([k]) => !missing.has(k)).map(([k, l]) => (
          <button key={k} type="button" className="btn small" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={view} src={`/api/vexcel/${encodeURIComponent(report.shellId)}?view=${view}`} alt={`Vexcel ${label.toLowerCase()} aerial photo of ${report.address}`}
        onError={() => { setMissing((m) => new Set(m).add(view)); setView("ortho"); }} />
      <MiniMap lat={report.above.lat} lon={report.above.lon} facing={HEADING[view]} />
    </div>
  );
}

function EsriAerial({ report }: { report: ShellReport }) {
  const [failed, setFailed] = useState(false);
  const a = report.above;
  if (!a) return <p className="muted" style={{ padding: 16 }}>No coordinates on record for this property.</p>;
  const z = 19;
  const t = tileFor(a.lat, a.lon, z);
  const offX = (1 + t.fx) * 256, offY = (1 + t.fy) * 256;
  if (failed) return <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 16, textAlign: "center" }}><p>Aerial imagery couldn&apos;t load (offline?). Location: <span className="num">{a.lat.toFixed(5)}, {a.lon.toFixed(5)}</span>.</p></div>;
  return (
    <div role="img" aria-label={`Aerial image centered on ${report.address}`} style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 768, height: 768, transform: `translate(${-offX}px, ${-offY}px)` }}>
        {[-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${dx}${dy}`} alt="" src={esriTile(z, t.x + dx, t.y + dy)} width={256} height={256} onError={() => setFailed(true)} style={{ position: "absolute", left: (dx + 1) * 256, top: (dy + 1) * 256 }} />
        )))}
        <svg width={40} height={40} viewBox="0 0 24 24" aria-hidden="true" style={{ position: "absolute", left: offX - 20, top: offY - 38 }}>
          <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#f26a4b" stroke="#fff" strokeWidth={1.5} />
          <circle cx={12} cy={9} r={2.6} fill="#fff" />
        </svg>
      </div>
    </div>
  );
}
