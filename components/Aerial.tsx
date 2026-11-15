"use client";
import { Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useCoords } from "@/lib/neighborhood/heat";
import { esriStreetTile, esriTile, tileFor } from "@/lib/geometry/tiles";
import type { ShellReport } from "@/lib/types";

const VIEWS = [["ortho", "Top-down"], ["oblique-north", "Looking north"], ["oblique-east", "Looking east"], ["oblique-south", "Looking south"], ["oblique-west", "Looking west"]] as const;
type ViewKey = (typeof VIEWS)[number][0];

const FACES: Record<string, string> = { ortho: "Straight down", "oblique-north": "North", "oblique-east": "East", "oblique-south": "South", "oblique-west": "West" };

function siteFacts(r: ShellReport, lotSqft?: number) {
  const hit = r.rules.find((h) => h.rule === "parking" || h.rule === "onsite_parking");
  const stalls = hit?.detail.match(/^(\d+) (?:recorded|on-site) stalls/)?.[1];
  const lot = lotSqft;
  return { parking: stalls ? Number(stalls).toLocaleString() : "Not on record", space: r.sqft ? `${r.sqft.toLocaleString()} sf` : "Not on record", lot: lot ? `${lot.toLocaleString()} sf` : null };
}

const HEADING: Record<string, number | undefined> = { "oblique-north": 0, "oblique-east": 90, "oblique-south": 180, "oblique-west": 270 };

// Street map centered on the property, sized to fill its box; the cone shows which way an angled photo faces.
// `small` is the corner-inset version (fewer, lower-zoom tiles).
function StreetMap({ address, lat, lon, facing, small }: { address: string; lat: number; lon: number; facing?: number; small?: boolean }) {
  const cols = small ? 3 : 9, rows = small ? 3 : 5, z = small ? 15 : 17;
  const { pt, byAddress, fail, dead } = useCoords(address, lat, lon, cols * rows);
  if (dead) return <p className="aerial-msg">The street map couldn&apos;t load (offline?).</p>;
  if (!pt) return <p className="aerial-msg">Finding the location...</p>;
  const t = tileFor(pt.lat, pt.lon, z);
  const hx = Math.floor(cols / 2), hy = Math.floor(rows / 2);
  const offX = (hx + t.fx) * 256, offY = (hy + t.fy) * 256;
  const cone = small ? 34 : 70, pin = small ? 7 : 10;
  return (
    <div className="aerial-map" role="img" aria-label={`Street map locating ${address || "the property"}${facing !== undefined ? `; the photo faces ${["north", "east", "south", "west"][facing / 90]}` : ""}`}>
      <div style={{ position: "absolute", left: `calc(50% - ${offX}px)`, top: `calc(50% - ${offY}px)`, width: cols * 256, height: rows * 256 }}>
        {Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${c}-${r}`} alt="" src={esriStreetTile(z, t.x + c - hx, t.y + r - hy)} width={256} height={256} onError={fail} style={{ position: "absolute", left: c * 256, top: r * 256 }} />
        )))}
      </div>
      <svg className="aerial-pin" width={cone * 2} height={cone * 2} viewBox={`0 0 ${cone * 2} ${cone * 2}`} aria-hidden="true">
        {facing !== undefined && (
          <g transform={`rotate(${facing} ${cone} ${cone})`}>
            <path d={`M${cone} ${cone} L${cone - cone * 0.5} ${0} L${cone + cone * 0.5} ${0} Z`} fill="#f26a4b" fillOpacity={0.28} />
          </g>
        )}
        <circle cx={cone} cy={cone} r={pin} fill="#f26a4b" stroke="#fff" strokeWidth={small ? 2.5 : 3} />
      </svg>
      <span className="aerial-map-n" aria-hidden="true">N ↑</span>
      <span className="aerial-map-credit">{byAddress ? "Located by address · " : ""}Esri</span>
    </div>
  );
}

// The street map fills the panel so first-time viewers know where they are; the Vexcel photo for the chosen angle
// sits in the corner and swaps to full size on click. Falls back to Esri imagery when Vexcel has no top-down photo.
export function Aerial({ report }: { report: ShellReport }) {
  const [view, setView] = useState<ViewKey>("ortho");
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [photoBig, setPhotoBig] = useState(false);
  const [lotSqft, setLotSqft] = useState<number>();
  useEffect(() => {
    fetch(`/api/parcel/${encodeURIComponent(report.shellId)}`).then((r) => (r.ok ? r.json() : null)).then((d) => setLotSqft(d?.shell?.parcel?.lotSqft)).catch(() => {});
  }, [report.shellId]);
  if (!report.above) return <p className="muted" style={{ padding: 16 }}>No coordinates on record for this property.</p>;
  if (missing.has("ortho")) return <EsriAerial report={report} />;
  const f = siteFacts(report, lotSqft);
  const label = VIEWS.find(([k]) => k === view)![1];
  const photo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={view} className="aerial-photo" src={`/api/vexcel/${encodeURIComponent(report.shellId)}?view=${view}`} alt={`Vexcel ${label.toLowerCase()} aerial photo of ${report.address}`}
      onError={() => { setMissing((m) => new Set(m).add(view)); setView("ortho"); }} />
  );
  const map = <StreetMap address={report.address} lat={report.above.lat} lon={report.above.lon} facing={HEADING[view]} small={photoBig} />;
  return (
    <div className="aerial-view">
      <div role="group" aria-label="Vexcel camera angle" className="angles">
        {VIEWS.filter(([k]) => !missing.has(k)).map(([k, l]) => (
          <button key={k} type="button" className="btn small" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      <dl className="aerial-facts" aria-label="Site facts">
        <div><dt>Parking spaces</dt><dd>{f.parking}</dd></div>
        <div><dt>Space size</dt><dd>{f.space}</dd></div>
        {f.lot && <div><dt>Lot size</dt><dd>{f.lot}</dd></div>}
        <div><dt>Photo faces</dt><dd>{FACES[view]}</dd></div>
      </dl>
      <div className="aerial-stage">
        <div className="aerial-main">{photoBig ? photo : map}</div>
        <button type="button" className="aerial-inset" onClick={() => setPhotoBig((b) => !b)} aria-label={photoBig ? "Show the street map full size" : `Show the ${label.toLowerCase()} Vexcel photo full size`}>
          {photoBig ? map : photo}
          <span className="aerial-inset-tag"><Maximize2 aria-hidden="true" /> {photoBig ? "Map" : "Photo"}</span>
        </button>
      </div>
    </div>
  );
}

function EsriAerial({ report }: { report: ShellReport }) {
  const a = report.above;
  const { pt, fail, dead } = useCoords(report.address, a?.lat, a?.lon);
  if (pt === undefined) return <p className="muted" style={{ padding: 16 }}>Finding the location...</p>;
  if (!pt) return <p className="muted" style={{ padding: 16 }}>No coordinates on record for this property.</p>;
  const z = 19;
  const t = tileFor(pt.lat, pt.lon, z);
  const offX = (1 + t.fx) * 256, offY = (1 + t.fy) * 256;
  if (dead) return <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 16, textAlign: "center" }}><p>Aerial imagery couldn&apos;t load (offline?). Location: <span className="num">{pt.lat.toFixed(5)}, {pt.lon.toFixed(5)}</span>.</p></div>;
  return (
    <div role="img" aria-label={`Aerial image centered on ${report.address}`} style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 768, height: 768, transform: `translate(${-offX}px, ${-offY}px)` }}>
        {[-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${dx}${dy}`} alt="" src={esriTile(z, t.x + dx, t.y + dy)} width={256} height={256} onError={fail} style={{ position: "absolute", left: (dx + 1) * 256, top: (dy + 1) * 256 }} />
        )))}
        <svg width={40} height={40} viewBox="0 0 24 24" aria-hidden="true" style={{ position: "absolute", left: offX - 20, top: offY - 38 }}>
          <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#f26a4b" stroke="#fff" strokeWidth={1.5} />
          <circle cx={12} cy={9} r={2.6} fill="#fff" />
        </svg>
      </div>
    </div>
  );
}
