"use client";
import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";
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

  const pins = reports.flatMap((r, i) => (r.above ? [{ i, r, lat: r.above.lat, lon: r.above.lon }] : []));
  if (!pins.length) return null;

  const { w, h } = size;
  // Largest zoom (capped at street level) where every pin fits inside the padded box.
  let z = 16;
  while (z > 3 && w) {
    const ps = pins.map((p) => px(p.lat, p.lon, z));
    const spanX = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
    const spanY = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
    if (spanX <= w - PAD * 2 && spanY <= h - PAD * 2) break;
    z--;
  }
  const ps = pins.map((p) => ({ ...p, ...px(p.lat, p.lon, z) }));
  const cx = (Math.max(...ps.map((p) => p.x)) + Math.min(...ps.map((p) => p.x))) / 2;
  const cy = (Math.max(...ps.map((p) => p.y)) + Math.min(...ps.map((p) => p.y))) / 2;
  const ox = cx - w / 2, oy = cy - h / 2; // world pixel at the box's top-left
  const tiles: { x: number; y: number }[] = [];
  if (w) for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + h) / 256); ty++) for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + w) / 256); tx++) tiles.push({ x: tx, y: ty });
  const missing = reports.length - pins.length;

  return (
    <details className="results-map" open>
      <summary><MapPin aria-hidden="true" /> Map <span className="muted">· approximate locations{missing ? ` · ${missing} without coordinates` : ""}</span></summary>
      <div className="map-box" ref={setEl} role="group" aria-label="Map of matching spaces. Pins are approximate locations; each pin selects its card.">
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
        <span className="map-credit">Esri · approximate</span>
      </div>
    </details>
  );
}
