"use client";
import { Box, Plane, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { roomStops, tourUrl } from "@/lib/viewer/matterport";
import type { ShellReport } from "@/lib/types";
import { Aerial } from "./Aerial";
import { FitView } from "./FitView";
import { Modal } from "./Modal";

type View = "3d" | "aerial" | "fit";

export function PropertyViewer({ report, onClose, initial = "3d" }: { report: ShellReport; onClose: () => void; initial?: View }) {
  const [view, setView] = useState<View>(report.inside ? initial : "aerial");
  const [stop, setStop] = useState<number | undefined>(undefined);
  const stops = roomStops(report);
  const tabs: [View, string, typeof Box][] = [["3d", "3D tour", Box], ["aerial", "Aerial", Plane], ["fit", "Fit", SlidersHorizontal]];
  return (
    <Modal title={report.name.split(" · ")[0]} onClose={onClose} wide>
      <p className="muted" style={{ marginBottom: 12 }}>{report.address}</p>
      <div className="tabs-pill" role="tablist" aria-label="Property views">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} data-active={view === k} disabled={k === "3d" && !report.inside} onClick={() => setView(k)}>
            <Icon aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <div className="viewer-body" role="tabpanel" aria-label={`${view} view`}>
        {view === "3d" && report.inside && (
          <div className="viewer-3d">
            <div className="viewer-frame">
              <iframe key={stop ?? "start"} title={`Matterport 3D tour of ${report.name}`} src={tourUrl(report.inside.sid, stop)} allow="xr-spatial-tracking; fullscreen" allowFullScreen />
            </div>
            {stops.length > 0 && (
              <nav aria-label="Jump to a room" className="room-stops">
                <h3>Jump to a room</h3>
                {stops.map((s) => (
                  <button key={`${s.label}-${s.index}`} type="button" className="btn small" aria-pressed={stop === s.index} onClick={() => setStop(s.index)}>{s.label}</button>
                ))}
              </nav>
            )}
          </div>
        )}
        {view === "aerial" && <div className="viewer-frame aerial"><Aerial report={report} /></div>}
        {view === "fit" && <FitView report={report} />}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
        {view === "3d" ? "3D tour from Matterport; needs an internet connection." : view === "aerial" ? "Aerial and oblique photos © Vexcel Imaging (Esri World Imagery where Vexcel has none). Centered on the record's coordinates, not a surveyed parcel." : "Your requested rooms mapped onto the measured floor plan."}
      </p>
    </Modal>
  );
}
