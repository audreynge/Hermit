"use client";
import { ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { layoutRooms, type LayoutBlock } from "@/lib/similarity/layout";
import type { City, Mode, RoomGraph, Similarity } from "@/lib/types";
import { LayoutCompare } from "./FitView";
import { Modal } from "./Modal";

type Hit = { shellId: string; sid: string; name: string; address: string; sqft?: number; similarity: Similarity; floorplan: RoomGraph | null };
const SCALES: [number, string][] = [[0.75, "Smaller"], [1, "As drawn"], [1.25, "Larger"], [1.5, "Much larger"]];
const CITIES: [City, string][] = [["houston", "Houston"], ["los_angeles", "Los Angeles"]];

// Live geometry-only preview while drawing; "Analyze & match" runs the full agent with rules, costs and reports.
export function SimilarScans({ layout, mode, city, onCity }: { layout: LayoutBlock[]; mode: Mode; city: City; onCity: (c: City) => void }) {
  // Hits keep the exact layout they were scored against: pairs[].mine indexes into it, not into later edits.
  const [res, setRes] = useState<{ layout: LayoutBlock[]; hits: Hit[] } | null>(null);
  const hits = res?.hits ?? null;
  const [compared, setCompared] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState<Hit | null>(null);
  const [scale, setScale] = useState(1);
  const key = JSON.stringify(layout.map(({ label, x, y, w, h }) => [label, x, y, w, h]));

  useEffect(() => {
    if (!layoutRooms(layout).length) { setRes(null); setState("idle"); return; }
    const ctl = new AbortController();
    setState("loading");
    const t = setTimeout(() => {
      fetch("/api/similar", { method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ layout, city, mode, scale }) })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: { compared: number; results: Hit[] }) => { setRes({ layout, hits: d.results }); setCompared(d.compared); setState("idle"); })
        .catch((e) => { if (e?.name !== "AbortError") setState("error"); });
    }, 500);
    return () => { clearTimeout(t); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures layout contents
  }, [key, city, mode, scale]);

  return (
    <section className="card similar" aria-labelledby="similar-title" aria-busy={state === "loading"}>
      <header>
        <h2 id="similar-title"><Search aria-hidden="true" /> Closest real spaces</h2>
        <div className="view-switch" role="group" aria-label="Match at size" style={{ margin: 0 }}>
          {SCALES.map(([f, l]) => <button key={f} type="button" aria-pressed={scale === f} onClick={() => setScale(f)} title={`Look for spaces about ${Math.round(f * 100)}% of your drawn area`}>{l}</button>)}
        </div>
        <label>City <select value={city} onChange={(e) => onCity(e.target.value as City)}>{CITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      </header>
      <p className="muted" aria-live="polite">
        {state === "error" ? "Couldn't compare right now. Keep drawing and Hermit will retry."
          : !layoutRooms(layout).length ? "Add a room (hallways don't count) and Hermit will look for measured floor plans shaped like it."
          : state === "loading" ? (hits?.length ? "Updating matches…" : "Comparing with scanned floor plans…")
          : `Ranked by room types, sizes, which rooms touch, and footprint shape across ${compared} scanned ${mode === "home" ? "homes" : "spaces"}${scale !== 1 ? `, with your layout scaled to ${Math.round(scale * 100)}% of its area` : ""}.`}
      </p>
      {hits && hits.length > 0 && (
        <ul className="similar-list">
          {hits.map((h) => (
            <li key={h.shellId}>
              <button type="button" onClick={() => setOpen(h)} disabled={state === "loading"} aria-label={`${h.name.split(" · ")[0]}, ${h.similarity.score}% similar. Compare in 3D`}>
                <img src={`/api/asset/${h.sid}`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                <span className="sim-score num">{h.similarity.score}%</span>
                <span className="sim-name">{h.name.split(" · ")[0]}</span>
                <span className="muted sim-meta">{h.floorplan ? `${Math.round(h.floorplan.totalAreaSqft).toLocaleString()} sf measured` : h.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hits && hits.length === 0 && state === "idle" && <p className="muted">No scanned {mode === "home" ? "homes" : "spaces"} in {CITIES.find((c) => c[0] === city)?.[1]} pass the size filter for this layout. Try scaling it or switching city.</p>}
      {open && (
        <Modal title={open.name.split(" · ")[0]} onClose={() => setOpen(null)}>
          <p className="muted" style={{ marginTop: -8 }}>{open.address}</p>
          {open.floorplan ? <LayoutCompare name={open.name.split(" · ")[0]} g={open.floorplan} sim={{ ...open.similarity, layout: res!.layout }} /> : <p className="muted">No room geometry cached for this scan.</p>}
          <div className="actions" style={{ marginTop: 14 }}>
            <a className="btn" href={`https://my.matterport.com/show/?m=${open.sid}&play=1&qs=1&brand=0`} target="_blank" rel="noreferrer">Open Matterport tour <ExternalLink aria-hidden="true" /></a>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>A scan on record is not proof the space is available. Run Analyze &amp; match for zoning, code and cost screening.</p>
        </Modal>
      )}
    </section>
  );
}
