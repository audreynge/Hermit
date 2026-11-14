"use client";
import { useState } from "react";
import { FitView } from "./FitView";
import { esriTile, tileFor } from "@/lib/geometry/tiles";
import type { ShellReport } from "@/lib/types";

type Tab = "inside" | "above" | "fit";

export function Viewer({ report }: { report: ShellReport }) {
  const [tab, setTab] = useState<Tab>(report.inside ? "fit" : "above");
  const [tourFor, setTourFor] = useState<string | null>(null);
  const tabs: [Tab, string][] = [["inside", "Inside"], ["above", "Above"], ["fit", "Fit"]];

  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex(([t]) => t === tab);
    const next = e.key === "ArrowRight" ? (i + 1) % 3 : e.key === "ArrowLeft" ? (i + 2) % 3 : -1;
    if (next >= 0) { setTab(tabs[next][0]); document.getElementById(`vtab-${tabs[next][0]}`)?.focus(); }
  };

  return (
    <section className="card" aria-label="Evidence viewer">
      <div className="tabs" role="tablist" aria-label="Evidence" onKeyDown={onKey}>
        {tabs.map(([t, label]) => (
          <button key={t} id={`vtab-${t}`} role="tab" aria-selected={tab === t} aria-controls={`vpanel-${t}`} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`vpanel-${tab}`} aria-labelledby={`vtab-${tab}`}>
        {tab === "inside" && (report.inside ? (
          <div className="stack">
            <div className="viewer">
              {tourFor === report.inside.sid ? (
                <iframe title={`Matterport 3D tour of ${report.name}`} src={`https://my.matterport.com/show/?m=${report.inside.sid}&play=1&qs=1&brand=0`} allow="xr-spatial-tracking; fullscreen" allowFullScreen />
              ) : (
                <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 16, textAlign: "center" }}>
                  <div className="stack">
                    <p>3D tour from Matterport scan <span className="num">{report.inside.sid}</span>.</p>
                    <button className="btn" onClick={() => setTourFor(report.inside!.sid)}>Load 3D tour</button>
                  </div>
                </div>
              )}
            </div>
            <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
              The tour loads from Matterport and needs a network connection. If it doesn&apos;t load,{" "}
              <a href={`https://my.matterport.com/show/?m=${report.inside.sid}`} target="_blank" rel="noreferrer">open it in a new tab</a> or use the Fit tab&apos;s measured floor plan.
            </p>
          </div>
        ) : <p className="muted">No Matterport scan for this candidate. Its evidence comes from CoStar records only.</p>)}
        {tab === "above" && <Above report={report} />}
        {tab === "fit" && <FitView report={report} />}
      </div>
    </section>
  );
}

function Above({ report }: { report: ShellReport }) {
  const [failed, setFailed] = useState(false);
  const a = report.above;
  if (!a) return <p className="muted">No coordinates on record for this property.</p>;
  const z = 19;
  const t = tileFor(a.lat, a.lon, z);
  const offX = (1 + t.fx) * 256, offY = (1 + t.fy) * 256;
  return (
    <figure style={{ margin: 0 }}>
      <div className="viewer" role="img" aria-label={`Aerial image centered on ${report.address}`}>
        {failed ? (
          <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 16, textAlign: "center" }}>
            <p>Aerial imagery couldn&apos;t load (offline?). Location: <span className="num">{a.lat.toFixed(5)}, {a.lon.toFixed(5)}</span>.</p>
          </div>
        ) : (
          <div style={{ position: "absolute", left: "50%", top: "50%", width: 768, height: 768, transform: `translate(${-offX}px, ${-offY}px)` }}>
            {[-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${dx}${dy}`} alt="" src={esriTile(z, t.x + dx, t.y + dy)} width={256} height={256} onError={() => setFailed(true)}
                style={{ position: "absolute", left: (dx + 1) * 256, top: (dy + 1) * 256 }} />
            )))}
            <svg width={36} height={36} viewBox="0 0 24 24" aria-hidden="true" style={{ position: "absolute", left: offX - 18, top: offY - 34 }}>
              <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#f4a99a" stroke="#14213d" strokeWidth={1.5} />
              <circle cx={12} cy={9} r={2.5} fill="#14213d" />
            </svg>
          </div>
        )}
      </div>
      <figcaption className="muted" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>
        Imagery: {a.provider} (Esri, Maxar, Earthstar Geographics). Vexcel imagery isn&apos;t connected yet, so roof and parking aren&apos;t counted from the air.
      </figcaption>
    </figure>
  );
}
