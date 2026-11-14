"use client";
import { Locate, MapPin, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { esriStreetTile, tileFor } from "@/lib/geometry/tiles";
import type { ShellReport } from "@/lib/types";

const PAD = 36;

// World-pixel position of a point at zoom z (256px Web Mercator tiles).
const px = (lat: number, lon: number, z: number) => { const t = tileFor(lat, lon, z); return { x: (t.x + t.fx) * 256, y: (t.y + t.fy) * 256 }; };

// Street map of the results with numbered pins in card order. Zoom auto-fits the pins to the box.
export function ResultsMap({ reports, selected, onSelect }: { reports: ShellReport[]; selected: number; onSelect: (i: number) => void }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  // User zoom (whole steps on top of the auto-fit) and pan (screen px). A new result set re-fits.
  const [view, setView] = useState({ dz: 0, x: 0, y: 0 });
  const ids = reports.map((r) => r.shellId).join();
  useEffect(() => setView({ dz: 0, x: 0, y: 0 }), [ids]);
  // Zooming keeps the map's centre: pan offsets scale with the zoom change.
  const zoom = (d: number) => setView((v) => { const dz = Math.max(-12, Math.min(6, v.dz + d)); const k = 2 ** (dz - v.dz); return { dz, x: v.x * k, y: v.y * k }; });
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!el) return;
    // Pinch (ctrl+wheel) or Cmd/Ctrl+scroll zooms; plain scrolling still scrolls the results list.
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) > 60) { zoom(acc < 0 ? 1 : -1); acc = 0; }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [el]);

  const pins = reports.flatMap((r, i) => (r.above ? [{ i, r, lat: r.above.lat, lon: r.above.lon }] : []));
  if (!pins.length) return null;

  const { w, h } = size;
  // Largest zoom (capped at street level) where every pin fits inside the padded box.
  let fitZ = 16;
  while (fitZ > 3 && w) {
    const ps = pins.map((p) => px(p.lat, p.lon, fitZ));
    const spanX = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
    const spanY = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
    if (spanX <= w - PAD * 2 && spanY <= h - PAD * 2) break;
    fitZ--;
  }
  const z = Math.max(2, Math.min(19, fitZ + view.dz));
  const ps = pins.map((p) => ({ ...p, ...px(p.lat, p.lon, z) }));
  // Pins at (nearly) the same spot would overlap and be too small to tap: fan later ones out sideways by a pin width.
  // ponytail: greedy sideways nudge; a proper cluster/spiderfy only if results grow past a handful.
  ps.forEach((p, k) => { while (ps.slice(0, k).some((q) => Math.abs(q.x - p.x) < 46 && Math.abs(q.y - p.y) < 48)) p.x += 46; });
  const cx = (Math.max(...ps.map((p) => p.x)) + Math.min(...ps.map((p) => p.x))) / 2;
  const cy = (Math.max(...ps.map((p) => p.y)) + Math.min(...ps.map((p) => p.y))) / 2;
  const ox = cx - w / 2 - view.x, oy = cy - h / 2 - view.y; // world pixel at the box's top-left
  const tiles: { x: number; y: number }[] = [];
  if (w) for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + h) / 256); ty++) for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + w) / 256); tx++) tiles.push({ x: tx, y: ty });
  const missing = reports.length - pins.length;

  return (
    <details className="results-map" open>
      <summary><MapPin aria-hidden="true" /> Map <span className="muted">· approximate locations{missing ? ` · ${missing} without coordinates` : ""}</span></summary>
      <div className="map-box" ref={setEl} role="group" aria-label="Map of matching spaces. Pins are approximate locations; each pin selects its card. Drag to move, pinch or Ctrl+scroll to zoom."
        onPointerDown={(e) => { if ((e.target as Element).closest("button")) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y }; }}
        onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.x + e.clientX - d.sx, y: d.y + e.clientY - d.sy })); }}
        onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${z}/${t.x}/${t.y}`} alt="" src={esriStreetTile(z, t.x, t.y)} width={256} height={256}
            onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
            style={{ left: t.x * 256 - ox, top: t.y * 256 - oy }} />
        ))}
        {w > 0 && ps.map((p) => (
          <button key={p.r.shellId} type="button" className="map-pin" aria-pressed={p.i === selected}
            aria-label={`${p.i + 1}: ${p.r.name.split(" · ")[0]}, ${p.r.address}`} title={p.r.name.split(" · ")[0]}
            style={{ left: p.x - ox, top: p.y - oy, zIndex: p.i === selected ? 2 : 1 }} onClick={() => onSelect(p.i)}>
            <span>{p.i + 1}</span>
          </button>
        ))}
        <div className="map-zoom" role="group" aria-label="Map zoom">
          <button type="button" onClick={() => zoom(1)} disabled={z >= 19} aria-label="Zoom in"><Plus aria-hidden="true" /></button>
          <button type="button" onClick={() => zoom(-1)} disabled={z <= 2} aria-label="Zoom out"><Minus aria-hidden="true" /></button>
          <button type="button" onClick={() => setView({ dz: 0, x: 0, y: 0 })} disabled={!view.dz && !view.x && !view.y} aria-label="Fit all pins"><Locate aria-hidden="true" /></button>
        </div>
        <span className="map-credit">Esri · approximate</span>
      </div>
    </details>
  );
}
