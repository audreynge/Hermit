"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KEYS, load } from "@/lib/client/store";
import { chairFor } from "@/lib/reason/access";
import type { Furn } from "@/lib/spec/furnish";
import { sketchToBlocks } from "@/lib/spec/blocks";
import type { Block } from "@/lib/spec/parse";
import type { SketchRoom } from "@/lib/spec/sketch";
import { tourUrl } from "@/lib/viewer/matterport";
import { SeenPhoto, listWords } from "../Evidence";
import { FitView } from "../FitView";
import { FurnishTour } from "../FurnishTour";
import { FloorPlan } from "./FloorPlan";
import { usePersisted } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The 3D tour with the furniture bar under it, then the fit views; rooms on the side move the tour.
export function Inside({ report, spec, use, furnish, fit, setFit }: ReportCtx) {
  const sid = report.inside?.sid;
  const g = report.floorplan;
  const [room, setRoom] = usePersisted<string | null>(`hermit:tour:${report.shellId}`, report.fit.assignment.find((a) => a.roomId)?.roomId ?? null);
  const [jump, setJump] = useState<number | undefined>();
  const [plain, setPlain] = useState(false); // the furnishing tour (SDK) failed to start: show the plain iframe
  const fail = useCallback(() => setPlain(true), []);
  // With the basic tour showing, tell the chat right away instead of letting it wait for a tour that won't load.
  useEffect(() => {
    if (!plain) return;
    furnish.current = { ready: false, failed: true, send: async () => "", describe: () => "Basic 3D tour (furniture can't be placed in it)." };
    return () => { furnish.current = null; };
  }, [plain, furnish]);
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
  // Scan-photo checks for one of your rooms: every result for the fixtures you asked for in that room type
  // (seen, not seen, couldn't tell); with none asked for, only what was seen. null when there is nothing to show.
  const roomChecks = (roomId: string, req: string) => {
    const mine = (report.checks ?? []).filter((c) => c.roomId === roomId && (!sid || c.sid === sid));
    const asked = spec.rooms.find((r) => r.label.toLowerCase() === req.replace(/\s*#\d+$/, "").toLowerCase())?.fixtures?.map((f) => f.toLowerCase());
    const rel = asked?.length ? mine.filter((c) => asked.includes(c.feature.toLowerCase())) : mine.filter((c) => c.result === "seen");
    const out = { seen: rel.filter((c) => c.result === "seen"), notSeen: rel.filter((c) => c.result === "not_seen"), unclear: rel.filter((c) => c.result === "unclear") };
    return out.seen.length || out.notSeen.length || out.unclear.length ? out : null;
  };

  return (
    <div className="inside">
      <div className="inside-main">
        <div className="inside-tour" id="inside-tour">
          {!sid ? <p className="pad">No 3D scan for this space.</p>
            : plain ? <div className="inside-frame"><iframe key={stop ?? "start"} title={`Matterport 3D tour of ${report.name}`} src={tourUrl(sid, stop)} allow="xr-spatial-tracking; fullscreen" allowFullScreen /></div>
            : <FurnishTour report={report} use={use} chairIn={spec.needs.wheelchair ? chairFor(spec.needs)[0] : undefined} stop={stop} onFail={fail} api={furnish} />}
        </div>
        <section className="card inside-fit" aria-labelledby="fit-title">
          <h2 id="fit-title">Check the fit</h2>
          <FitView report={report} design={design} proposal={fit} onKeep={() => fit && setFit({ ...fit, kept: true })} onUndo={() => setFit(null)} onShowInTour={sid ? (i) => { setJump(i); document.getElementById("inside-tour")?.scrollIntoView({ behavior: "smooth" }); } : undefined} />
        </section>
      </div>

      <aside className="inside-side" aria-label="Your rooms">
        <h2>Your rooms in this space</h2>
        {g && <FloorPlan graph={g} names={names} highlight={room} onRoom={pick} height={220} report={report} label={`Floor plan of ${report.name}; your matched room is highlighted`} />}
        <ol className="room-list">
          {report.fit.assignment.map((a) => {
            const c = a.roomId ? roomChecks(a.roomId, a.req) : null;
            return (
              <li key={a.req}>
                {a.roomId ? <button type="button" aria-pressed={room === a.roomId} onClick={() => pick(a.roomId)}>
                  <strong>{a.req}</strong> <span className="muted">{Math.round(g?.rooms.find((r) => r.id === a.roomId)?.areaSqft ?? 0)} sf</span>
                </button> : <span className="room-missing"><strong>{a.req}</strong> <span>not built here yet</span></span>}
                {c && (
                  <div className="room-check">
                    {c.seen.length > 0 && (
                      <SeenPhoto checks={c.seen} title={`${cap(a.req)}: ${listWords(c.seen.map((x) => x.feature))} seen`} alt={`${listWords(c.seen.map((x) => x.feature))} in ${a.req}`}>
                        <span>{cap(listWords(c.seen.map((x) => x.feature)))} seen</span>
                      </SeenPhoto>
                    )}
                    {c.notSeen.length > 0 && <span className="rc-note">No {listWords(c.notSeen.map((x) => x.feature), "or")} seen in the photos</span>}
                    {c.unclear.length > 0 && <span className="rc-note">Couldn&apos;t tell from the photos ({listWords(c.unclear.map((x) => x.feature))})</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <p className="muted small">Room outlines come from the scan; the tour jumps to the nearest camera spot, which can be a room over.</p>
      </aside>
    </div>
  );
}
