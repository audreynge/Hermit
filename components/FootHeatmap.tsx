"use client";
import { useEffect, useId, useRef, useState } from "react";
import { esriStreetTile, tileFor } from "@/lib/geometry/tiles";
import { DEFAULT_HOURS, useCoords } from "@/lib/neighborhood/heat";
import type { SiteFile } from "@/lib/neighborhood/types";
import type { ShellReport } from "@/lib/types";

const CHIPS = [["Morning", 8], ["Midday", 12], ["Evening", 18], ["Night", 22]] as const;
const Z = 16, SPAN = 5 * 256;
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const world = (lat: number, lon: number) => { const t = tileFor(lat, lon, Z); return { x: (t.x + t.fx) * 256, y: (t.y + t.fy) * 256 }; };

// `heat` false: the plain address map (homes, warehouses, offices don't depend on walk-ins).
export function FootHeatmap({ report, site, heat = true }: { report: ShellReport; site: SiteFile | null; heat?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState(12);
  const expandBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const { pt, byAddress, fail, dead: lost } = useCoords(report.address, report.above?.lat ?? site?.lat, report.above?.lon ?? site?.lon, 25);
  useEffect(() => {
    if (!open) return;
    const prev = expandBtn.current;
    closeBtn.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); prev?.focus(); };
  }, [open]);
  const hours = site?.busyness?.hours?.length === 24 ? site.busyness.hours : DEFAULT_HOURS;
  const busy = hours[hour] / 100;
  const dead = pt === null || lost;
  const t = pt ? tileFor(pt.lat, pt.lon, Z) : null;
  const c = pt ? world(pt.lat, pt.lon) : null;
  const ox = t ? 2 * 256 + t.fx * 256 : 0, oy = t ? 2 * 256 + t.fy * 256 : 0;
  // Heat sources come from the server (places + job blocks); older payloads only have places.
  const spots = heat ? (site?.heat ?? (site?.pois ?? []).map((p) => ({ lat: p.lat, lon: p.lon, w: 0.8 }))) : [];
  const fed = site?.heatSources?.length ? site.heatSources : site?.pois?.length ? ["nearby places (OpenStreetMap)"] : [];
  const why = !site ? "No coordinates or neighborhood data for this space, so no heat is shown." : "No nearby places or job blocks in the cached city data, so no heat is shown.";

  return (
    <>
    {open && <div className="heat-backdrop" onClick={() => setOpen(false)} />}
    <section className={`heat-card${open ? " open" : ""}`} aria-label={heat ? "Estimated foot traffic map" : "Street map of the location"} role={open ? "dialog" : undefined} aria-modal={open || undefined}>
      <header className="heat-head">
        <div>
          <h3>{heat ? "Foot traffic by time of day" : "Location"}</h3>
          <p className="muted">{heat ? `Proxy, not a foot count: ${fed.length ? fed.join(" + ") : "nearby activity"} + typical busyness by hour.` : "Street map around the address."}</p>
        </div>
        {open && <button ref={closeBtn} type="button" className="btn small" onClick={() => setOpen(false)}>Close</button>}
        <button ref={expandBtn} type="button" className="btn small" hidden={open} aria-expanded={open} onClick={() => setOpen(true)}>Expand</button>
      </header>
      <div className="heat-map">
        {dead ? (
          <p className="heat-empty">We couldn&apos;t place this address on a map right now. Try again later.</p>
        ) : !pt || !t || !c ? (
          <p className="heat-empty">Finding the location...</p>
        ) : (
          <>
            <div className="heat-world" style={{ width: SPAN, height: SPAN, marginLeft: -ox, marginTop: -oy }} role="img" aria-label={heat ? `Street map near ${report.address} with estimated foot traffic at ${hourLabel(hour)}` : `Street map near ${report.address}`}>
              {Array.from({ length: 25 }, (_, i) => {
                const dx = (i % 5) - 2, dy = Math.floor(i / 5) - 2;
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} alt="" width={256} height={256} src={esriStreetTile(Z, t.x + dx, t.y + dy)} style={{ left: (dx + 2) * 256, top: (dy + 2) * 256 }}
                    onError={fail} />
                );
              })}
              <svg width={SPAN} height={SPAN} aria-hidden="true">
                <defs>
                  <radialGradient id={`${id}-g`}>
                    <stop offset="0" stopColor="#f26a4b" stopOpacity="0.9" />
                    <stop offset="0.5" stopColor="#f2a44b" stopOpacity="0.4" />
                    <stop offset="1" stopColor="#f2a44b" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <g opacity={0.15 + 0.85 * busy}>
                  {spots.map((p, i) => {
                    const w = world(p.lat, p.lon);
                    return <circle key={i} cx={ox + w.x - c.x} cy={oy + w.y - c.y} r={(30 + 40 * busy) * (0.6 + 0.4 * p.w)} opacity={Math.min(1, p.w)} fill={`url(#${id}-g)`} />;
                  })}
                </g>
                <g transform={`translate(${ox - 16} ${oy - 40}) scale(1.35)`}>
                  <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#f26a4b" stroke="#fff" strokeWidth={1.5} />
                  <circle cx={12} cy={9} r={2.6} fill="#fff" />
                </g>
              </svg>
            </div>
            <span className="heat-note">Approximate location{byAddress ? " · Location checked by address" : ""}</span>
            {heat && !spots.length && <span className="heat-note heat-note-b">{why}</span>}
          </>
        )}
      </div>
      {heat && <div className="heat-controls">
        <div role="group" aria-label="Time of day" className="heat-chips">
          {CHIPS.map(([l, h]) => <button key={l} type="button" className="btn small" aria-pressed={hour === h} onClick={() => setHour(h)}>{l}</button>)}
        </div>
        <label className="heat-slider">
          <span>{hourLabel(hour)}: <b>{busy < 0.34 ? "Quiet" : busy < 0.67 ? "Steady" : "Busy"}</b></span>
          <input type="range" min={0} max={23} step={1} value={hour} aria-valuetext={hourLabel(hour)} onChange={(e) => setHour(Number(e.target.value))} />
        </label>
      </div>}
    </section>
    </>
  );
}
