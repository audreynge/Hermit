"use client";
import { Aerial, AerialFinding } from "../Aerial";
import { FootHeatmap } from "../FootHeatmap";
import { Bus, Car, Store, Users } from "lucide-react";
import { useState } from "react";
import { esriTile, tileFor } from "@/lib/geometry/tiles";
import { competitors, customers, errands, gettingAround, neighbors, type Answer } from "@/lib/neighborhood/summarize";
import type { SiteFile } from "@/lib/neighborhood/types";
import type { ReportCtx } from "./ShellReportPage";

const Z = 15;
const COMP: Record<string, (t: Record<string, string>) => boolean> = {
  medical: (t) => /dentist|doctors|clinic/.test(t.amenity ?? ""), salon: (t) => /hairdresser|beauty/.test(t.shop ?? ""),
  restaurant: (t) => /restaurant|cafe|fast_food/.test(t.amenity ?? ""), retail: (t) => /clothes|boutique|gift|cosmetics/.test(t.shop ?? ""),
  fitness: (t) => /fitness_centre|sports_centre/.test(t.leisure ?? ""), office: (t) => !!t.office,
};
const transit = (t: Record<string, string>) => t.highway === "bus_stop" || /station|tram_stop/.test(t.railway ?? "") || t.public_transport === "platform" || t.public_transport === "station";

// A small map: your spot, competitors and transit stops within a 10-minute walk (OpenStreetMap on Esri imagery).
export function MiniMap({ site, use, label }: { site: SiteFile; use: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const c = tileFor(site.lat, site.lon, Z);
  const px = (lat: number, lon: number) => { const t = tileFor(lat, lon, Z); return { x: Math.round((t.x + t.fx - (c.x + c.fx)) * 256), y: Math.round((t.y + t.fy - (c.y + c.fy)) * 256) }; };
  const isComp = COMP[use];
  const pins = site.pois.filter((p) => (p.km ?? 9) <= 0.8 && (transit(p.tags) || isComp?.(p.tags)));
  if (failed) return <p className="pad muted">Map tiles couldn&apos;t load (offline?).</p>;
  return (
    <div className="minimap" role="img" aria-label={label}>
      <div className="minimap-inner">
        {[-2, -1, 0, 1, 2].flatMap((dy) => [-2, -1, 0, 1, 2].map((dx) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${dx}${dy}`} alt="" src={esriTile(Z, c.x + dx, c.y + dy)} width={256} height={256} onError={() => setFailed(true)}
            style={{ position: "absolute", left: `calc(50% + ${Math.round((dx - c.fx) * 256)}px)`, top: `calc(50% + ${Math.round((dy - c.fy) * 256)}px)` }} />
        )))}
        {pins.map((p, i) => { const q = px(p.lat, p.lon); const t = transit(p.tags); return <span key={i} className={`pin ${t ? "transit" : "rival"}`} style={{ left: `calc(50% + ${q.x}px)`, top: `calc(50% + ${q.y}px)` }} title={p.name ?? (t ? "transit stop" : "competitor")} />; })}
        <span className="pin you" style={{ left: "50%", top: "50%" }} title="This space" />
      </div>
      <ul className="legend"><li><span className="pin you static" /> this space</li><li><span className="pin rival static" /> competitors</li><li><span className="pin transit static" /> bus or rail stop</li></ul>
    </div>
  );
}

function AnswerCard({ title, a, Icon }: { title: string; a: Answer; Icon: typeof Car }) {
  return (
    <article className="q-card">
      <h3><Icon aria-hidden="true" className="inline-icon" /> {title}</h3>
      <p className="q-answer">{a.headline}</p>
      <ul>{a.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      {a.missing && <p className="muted small">{a.missing}.</p>}
      <p className="src small">Source: {a.source}{a.proxy ? " (a proxy, not a foot count)" : ""}</p>
    </article>
  );
}

export function Neighborhood({ site, use, report, spec }: ReportCtx) {
  const home = spec.mode === "home";
  const [provider, setProvider] = useState<"vexcel" | "esri">();
  // Vexcel aerial (top-down and four oblique angles) from the search page, shown whenever the space has coordinates.
  // The caption credits whoever's photo is actually showing: Vexcel, or Esri only when it's the real fallback.
  const above = report.above ? (
    <section className="card pad aerial-section" aria-labelledby="aerial-title">
      <h3 id="aerial-title">Aerial view</h3>
      <AerialFinding report={report} mode={spec.mode} />
      <div className="aerial-frame"><Aerial report={report} onProvider={setProvider} /></div>
      <p className="muted small">{provider === "esri" ? "Esri World Imagery photo of the building and lot (Vexcel has no photo of this spot)." : provider === "vexcel" ? "Vexcel aerial photos of the building and lot." : "Aerial photos of the building and lot."}</p>
    </section>
  ) : null;
  if (!site) return <div className="neighborhood"><p className="card pad">Hermit doesn&apos;t have neighborhood data for this space (no coordinates in the index).</p>{above}</div>;
  const busy = site.busyness?.hours;
  return (
    <div className="neighborhood">
      <div className="q-grid three">
        {home ? <>
          <AnswerCard title="What's the neighborhood like?" a={neighbors(site)} Icon={Users} />
          <AnswerCard title="How easy is it to get around?" a={gettingAround(site)} Icon={Car} />
          <AnswerCard title="Errands nearby?" a={errands(site)} Icon={Store} />
        </> : <>
          <AnswerCard title="Will customers come here?" a={customers(site)} Icon={Car} />
          <AnswerCard title="Who lives and works nearby?" a={neighbors(site)} Icon={Users} />
          <AnswerCard title="Who am I competing with?" a={competitors(site, use)} Icon={Store} />
        </>}
      </div>
      <FootHeatmap report={report} site={site} />
      <div className="nb-row">
        <MiniMap site={site} use={home ? "none" : use} label={`Map around ${report.name} showing ${home ? "" : "competitors and "}transit stops within a 10-minute walk`} />
        <article className="q-card">
          <h3><Bus aria-hidden="true" className="inline-icon" /> Busiest hours on this block</h3>
          {busy ? (
            <>
              <div className="bars" role="img" aria-label="Busyness by hour">
                {busy.map((v, h) => <span key={h} style={{ height: `${Math.max(4, v)}%` }} title={`${h}:00 · ${v}`} />)}
              </div>
              <div className="bar-axis" aria-hidden="true"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
              <p className="small">{site.busyness!.source}.</p>
            </>
          ) : <p className="muted">No BestTime forecast for this spot yet (free credits cover a handful of demo spaces). With one, Hermit shows how busy nearby venues are each hour, a proxy for foot traffic.</p>}
          <p className="muted small">Free public data today (TxDOT/Caltrans counts, OpenStreetMap, US Census). In production this plugs into Placer.ai or CoStar&apos;s own foot-traffic data.</p>
        </article>
      </div>
      {above}
    </div>
  );
}
