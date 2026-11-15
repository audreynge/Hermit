"use client";
import { DoorOpen, Plane, Ruler } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { Block } from "@/lib/spec/parse";
import type { ShellReport } from "@/lib/types";
import { tourSteps, tourUrl } from "@/lib/viewer/matterport";
import { Aerial } from "./Aerial";
import { FitView } from "./FitView";
import { FurnishTour } from "./FurnishTour";
import { Modal } from "./Modal";

type View = "fit" | "inside" | "above";

export function PropertyViewer({ report, use = "", chairIn, onClose, initial = "fit", design, furniture }: {
  report: ShellReport; use?: string; chairIn?: number; onClose: () => void; initial?: View; design?: Block[]; furniture?: Record<string, string[]>;
}) {
  const sid = report.inside?.sid;
  const [view, setView] = useState<View>(initial === "inside" && !sid ? "fit" : initial);
  const [step, setStep] = useState(0);
  const [jump, setJump] = useState<number | undefined>(undefined);
  const steps = useMemo(() => tourSteps(report, furniture), [report, furniture]);
  // The tour only reloads when the step points at a different sweep.
  const sweep = useMemo(() => { if (jump != null) return jump; for (let i = step; i >= 0; i--) if (steps[i].sweep != null) return steps[i].sweep; return undefined; }, [jump, step, steps]);
  const go = (i: number) => { setJump(undefined); setStep(i); };
  const [plain, setPlain] = useState(false); // the furnishing tour (SDK) failed to start: show the plain iframe
  const fail = useCallback(() => setPlain(true), []);
  const tabs: [View, string, typeof Ruler][] = [["fit", "Check the fit", Ruler], ...(sid ? [["inside", "Step inside", DoorOpen] as [View, string, typeof Ruler]] : []), ["above", "From above", Plane]];

  return (
    <Modal title={report.name.split(" · ")[0]} onClose={onClose} wide className="pv">
      <p className="muted pv-address">{report.address}</p>
      <div className="tabs-pill" role="tablist" aria-label="Property views">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} id={`pv-tab-${k}`} type="button" role="tab" aria-selected={view === k} aria-controls="pv-panel" data-active={view === k} onClick={() => setView(k)}>
            <Icon aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      <div id="pv-panel" className="viewer-body pv-body" role="tabpanel" aria-labelledby={`pv-tab-${view}`}>
        {view === "fit" && (
          <FitView report={report} onShowInTour={sid ? (i) => { setJump(i); setView("inside"); } : undefined} design={design} />
        )}
        {view === "inside" && sid && (
          <div className="pv-tour">
            {plain ? (
              <div className="pv-frame">
                <iframe key={sweep ?? "start"} title={`3D tour of ${report.name.split(" · ")[0]}`} src={tourUrl(sid, sweep)} allow="xr-spatial-tracking; fullscreen" allowFullScreen />
              </div>
            ) : <FurnishTour report={report} use={use} chairIn={chairIn} stop={sweep} stops={[]} onFail={fail} />}
            <div className="pv-guide" role="region" aria-label="Hermit's guided tour">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hermit-logo.svg" alt="" />
              <p aria-live="polite">{steps[step].text}</p>
              <div className="pv-guide-nav">
                <button type="button" className="btn" onClick={() => go(step - 1)} disabled={step === 0}>Back</button>
                <span className="muted num" aria-label={`Stop ${step + 1} of ${steps.length}`}>{step + 1} / {steps.length}</span>
                {step < steps.length - 1
                  ? <button type="button" className="btn primary" onClick={() => go(step + 1)}>Next room</button>
                  : <button type="button" className="btn" onClick={() => go(0)}>Start over</button>}
              </div>
            </div>
          </div>
        )}
        {view === "above" && (
          <>
            <div className="viewer-frame aerial"><Aerial report={report} /></div>
            <p className="muted pv-cap">Photos © Vexcel Imaging (Esri World Imagery where Vexcel has none), centered on the record&apos;s coordinates.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
