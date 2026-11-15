"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KEYS, load } from "@/lib/client/store";
import type { Furn } from "@/lib/spec/furnish";
import { sketchToBlocks } from "@/lib/spec/blocks";
import type { Block } from "@/lib/spec/parse";
import type { SketchRoom } from "@/lib/spec/sketch";
import { tourUrl } from "@/lib/viewer/matterport";
import { FitView } from "../FitView";
import { FurnishTour } from "../FurnishTour";
import { FloorPlan } from "./FloorPlan";
import { usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

// The 3D tour with the furniture bar under it, then the fit views; rooms on the side move the tour.
export function Inside({ report, use, furnish, fit, setFit }: ReportCtx) {
  const sid = report.inside?.sid;
  const g = report.floorplan;
  const [room, setRoom] = usePersisted<string | null>(`hermit:tour:${report.shellId}`, report.fit.assignment.find((a) => a.roomId)?.roomId ?? null);
  const [jump, setJump] = useState<number | undefined>();
  const [plain, setPlain] = useState(false); // the furnishing tour (SDK) failed to start: show the plain iframe
  const fail = useCallback(() => setPlain(true), []);
  // The layout drawn in Find a space, for "Your design vs this space".
  const [design, setDesign] = useState<Block[] | undefined>();
  useEffect(() => {
    const p = load<{ layout?: SketchRoom[]; furniture?: Furn[]; extras?: Block[] }>(KEYS.chat);
    if (p?.layout?.length) setDesign(sketchToBlocks(p.layout, p.furniture ?? [], p.extras ?? []));
  }, []);

  const names = useMemo(() => new Map(report.fit.assignment.filter((a) => a.roomId).map((a) => [a.roomId!, a.req])), [report]);
  const current = g?.rooms.find((r) => r.id === room);
  const label = (current?.panoId && g?.panos?.find((p) => p.id === current.panoId)?.label) || g?.panos?.find((p) => p.id === report.inside?.sweepId)?.label;
  const stop = jump ?? (label && /^\d+$/.test(label) ? Number(label) : undefined);
  const pick = (id: string | null) => { setJump(undefined); setRoom(id); };

  return (
    <div className="inside">
      <div className="inside-main">
        <div className="inside-tour" id="inside-tour">
          {!sid ? <p className="pad">No 3D scan for this space.</p>
            : plain ? <div className="inside-frame"><iframe key={stop ?? "start"} title={`Matterport 3D tour of ${report.name}`} src={tourUrl(sid, stop)} allow="xr-spatial-tracking; fullscreen" allowFullScreen /></div>
            : <FurnishTour report={report} use={use} stop={stop} onFail={fail} api={furnish} />}
        </div>
        <section className="card inside-fit" aria-labelledby="fit-title">
          <h2 id="fit-title">Check the fit</h2>
          <FitView report={report} design={design} proposal={fit} onKeep={() => fit && setFit({ ...fit, kept: true })} onUndo={() => setFit(null)} onShowInTour={sid ? (i) => { setJump(i); document.getElementById("inside-tour")?.scrollIntoView({ behavior: "smooth" }); } : undefined} />
        </section>
      </div>

      <aside className="inside-side" aria-label="Your rooms">
        <h2>Your rooms in this space</h2>
        {g && <FloorPlan graph={g} names={names} highlight={room} onRoom={pick} height={220} label={`Floor plan of ${report.name}; your matched room is highlighted`} />}
        <ol className="room-list">
          {report.fit.assignment.map((a) => (
            <li key={a.req}>
              {a.roomId ? <button type="button" aria-pressed={room === a.roomId} onClick={() => pick(a.roomId)}>
                <strong>{a.req}</strong> <span className="muted">{Math.round(g?.rooms.find((r) => r.id === a.roomId)?.areaSqft ?? 0)} sf</span>
              </button> : <span className="room-missing"><strong>{a.req}</strong> <span>not built here yet</span></span>}
            </li>
          ))}
        </ol>
        <p className="muted small">Room outlines come from the scan; the tour jumps to the nearest camera spot, which can be a room over.</p>
      </aside>
    </div>
  );
}
