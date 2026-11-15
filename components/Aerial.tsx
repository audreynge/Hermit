"use client";
import { Maximize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useCoords } from "@/lib/neighborhood/heat";
import { esriStreetTile, esriTile, tileFor } from "@/lib/geometry/tiles";
import type { AerialCount, Mode, ShellReport } from "@/lib/types";
import { Evidence, plainDate } from "./Evidence";

const VIEWS = [["ortho", "Top-down"], ["oblique-north", "Looking north"], ["oblique-east", "Looking east"], ["oblique-south", "Looking south"], ["oblique-west", "Looking west"]] as const;
type ViewKey = (typeof VIEWS)[number][0];

const FACES: Record<string, string> = { ortho: "Straight down", "oblique-north": "North", "oblique-east": "East", "oblique-south": "South", "oblique-west": "West" };

// Parking stalls on the CoStar record, as the parking rule read them (lib/reason/rules.ts). null = not on record.
export function costarStalls(r: ShellReport): number | null {
  const hit = r.rules.find((h) => h.rule === "parking" || h.rule === "onsite_parking");
  const m = hit?.detail.match(/([\d,]+) (?:recorded|on-site) stalls?|CoStar record lists ([\d,]+)/);
  const v = m?.[1] ?? m?.[2];
  return v ? Number(v.replace(/,/g, "")) : null;
}

function siteFacts(r: ShellReport, lotSqft?: number) {
  const stalls = costarStalls(r);
  const lot = lotSqft;
  return { parking: stalls != null ? `${stalls.toLocaleString()} space${stalls === 1 ? "" : "s"}` : "Not on record", space: r.sqft ? `${r.sqft.toLocaleString()} sf` : "Not on record", lot: lot ? `${lot.toLocaleString()} sf` : null };
}

const counted = (a: AerialCount) => a.stalls.n != null && a.stalls.confidence >= 0.5;

// One plain sentence on parking from the aerial count (with the CoStar record's number beside it when there is one),
// and a short "inside and out" version. null when the space was never counted: nothing shown, never a made-up zero.
export function parkingFinding(r: ShellReport): { text: string; short: string; roof: string | null; lines: string[] } | null {
  const a = r.aerial;
  if (!a) return null;
  const rec = costarStalls(r);
  const n = a.stalls.n ?? 0;
  const where = a.scope === "lot" ? "on the lot" : "around the building";
  const recPart = rec != null ? `CoStar record ${rec.toLocaleString()} · ` : "";
  let text: string, short: string;
  if (!counted(a)) {
    text = "Couldn't count the parking from the photo.";
    short = `${recPart}couldn't count it on the aerial photo`;
  } else if (n === 0 && rec) {
    // Zero means no marked surface lot was seen (faint markings can be missed), never "no parking".
    text = `The CoStar record lists ${rec.toLocaleString()} parking spaces. No marked surface parking lot is visible on the aerial photo, so they're likely in a garage or off-site, which can't be counted from the air.`;
    short = `${recPart}aerial shows no marked surface lot → likely a garage or off-site`;
  } else if (n === 0 && a.garageLikely) {
    text = "No marked surface parking lot is visible on the aerial photo, so parking is likely in a garage or off-site, which can't be counted from the air.";
    short = `${recPart}aerial shows no marked surface lot → likely a garage or off-site`;
  } else if (n === 0) {
    text = `No marked surface parking lot is visible ${where} on the aerial photo.`;
    short = `${recPart}aerial shows no marked surface lot`;
  } else {
    text = `About ${n.toLocaleString()} parking space${n === 1 ? "" : "s"} ${where} (counted on the ${a.provider === "vexcel" ? "Vexcel " : ""}aerial photo).`;
    short = `${recPart}about ${n.toLocaleString()} counted on the aerial photo`;
  }
  const ru = a.rooftopUnits;
  const roof = ru.n && ru.confidence >= 0.5 ? `The photo shows ${ru.n === 1 ? "one rooftop unit" : `${ru.n} rooftop units`}, likely heating and cooling equipment.` : null;
  const how = /runs agreed/.test(a.source) ? "Counted twice by Gemini and the counts agreed."
    : counted(a) ? "Counted by Gemini."
    : /wasn't clear/.test(a.source) ? "Gemini looked at it, but the photo wasn't clear enough to count."
    : "Gemini counted twice and the counts didn't agree, so Hermit gives no number.";
  return {
    text, short, roof,
    lines: [
      `${a.provider === "vexcel" ? "Vexcel" : "Esri"} top-down aerial photo${a.captured ? `, taken ${plainDate(a.captured)}` : ""}.`,
      `${how}${a.retrieved ? ` Checked ${plainDate(a.retrieved)}.` : ""}`,
      rec != null ? "The number of spaces on record comes from the CoStar property record." : "",
    ].filter(Boolean),
  };
}

// The parking finding as it sits above the aerial photo. Rooftop units only matter when you run a business there.
export function AerialFinding({ report, mode }: { report: ShellReport; mode: Mode }) {
  const f = parkingFinding(report);
  if (!f) return null;
  return (
    <div className="aerial-finding">
      <p>{f.text}</p>
      {f.roof && mode !== "home" && <p>{f.roof}</p>}
      <Evidence lines={f.lines} />
    </div>
  );
}

const BOX_LABEL: Record<AerialCount["boxes"][number]["label"], string> = { rooftop_unit: "Rooftop unit", parking_area: "Parking area", stall: "Parking space" };

// The cached Vexcel ortho the count was made on, with what was counted outlined. Boxes are [ymin,xmin,ymax,xmax] in 0-1000.
// Rooftop units: solid outline; parking: dashed. The legend says so in words, so nothing depends on color.
function CountedPhoto({ count, address }: { count: AerialCount; address: string }) {
  const kinds = [...new Set(count.boxes.map((b) => b.label))];
  const tally = kinds.map((k) => { const n = count.boxes.filter((b) => b.label === k).length; return `${n} ${BOX_LABEL[k].toLowerCase()}${n === 1 ? "" : "s"}`; });
  return (
    <div className="aerial-counted">
      <div className="aerial-counted-box">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/asset/${encodeURIComponent(count.sid)}?kind=aerial`} alt={`${count.provider === "vexcel" ? "Vexcel" : "Esri"} top-down aerial photo of ${address || "the property"}${tally.length ? `, with ${tally.join(" and ")} outlined` : ""}`} />
        {count.boxes.length > 0 && (
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            {count.boxes.map((b, i) => {
              const [y0, x0, y1, x1] = b.box;
              const r = { x: x0, y: y0, width: Math.max(4, x1 - x0), height: Math.max(4, y1 - y0) };
              return (
                <g key={i} className={b.label === "rooftop_unit" ? "ab-roof" : "ab-lot"}>
                  <rect {...r} className="ab-halo" />
                  <rect {...r} className="ab-line" />
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {kinds.length > 0 && (
        <ul className="aerial-legend" aria-label="Outlined on the photo">
          {kinds.map((k) => <li key={k}><span className={`ab-swatch ${k === "rooftop_unit" ? "ab-roof" : "ab-lot"}`} aria-hidden="true" /> {BOX_LABEL[k]} ({k === "rooftop_unit" ? "solid" : "dashed"})</li>)}
        </ul>
      )}
    </div>
  );
}

const HEADING: Record<string, number | undefined> = { "oblique-north": 0, "oblique-east": 90, "oblique-south": 180, "oblique-west": 270 };

// Street map centered on the property, sized to fill its box; the cone shows which way an angled photo faces.
// `small` is the corner-inset version (fewer, lower-zoom tiles).
function StreetMap({ address, lat, lon, facing, small }: { address: string; lat: number; lon: number; facing?: number; small?: boolean }) {
  const cols = small ? 3 : 9, rows = small ? 3 : 5, z = small ? 15 : 17;
  const { pt, byAddress, fail, dead } = useCoords(address, lat, lon, cols * rows);
  if (dead) return <p className="aerial-msg">The street map couldn&apos;t load (offline?).</p>;
  if (!pt) return <p className="aerial-msg">Finding the location...</p>;
  const t = tileFor(pt.lat, pt.lon, z);
  const hx = Math.floor(cols / 2), hy = Math.floor(rows / 2);
  const offX = (hx + t.fx) * 256, offY = (hy + t.fy) * 256;
  const cone = small ? 34 : 70, pin = small ? 7 : 10;
  return (
    <div className="aerial-map" role="img" aria-label={`Street map locating ${address || "the property"}${facing !== undefined ? `; the photo faces ${["north", "east", "south", "west"][facing / 90]}` : ""}`}>
      <div style={{ position: "absolute", left: `calc(50% - ${offX}px)`, top: `calc(50% - ${offY}px)`, width: cols * 256, height: rows * 256 }}>
        {Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${c}-${r}`} alt="" src={esriStreetTile(z, t.x + c - hx, t.y + r - hy)} width={256} height={256} onError={fail} style={{ position: "absolute", left: c * 256, top: r * 256 }} />
        )))}
      </div>
      <svg className="aerial-pin" width={cone * 2} height={cone * 2} viewBox={`0 0 ${cone * 2} ${cone * 2}`} aria-hidden="true">
        {facing !== undefined && (
          <g transform={`rotate(${facing} ${cone} ${cone})`}>
            <path d={`M${cone} ${cone} L${cone - cone * 0.5} ${0} L${cone + cone * 0.5} ${0} Z`} fill="#f26a4b" fillOpacity={0.28} />
          </g>
        )}
        <circle cx={cone} cy={cone} r={pin} fill="#f26a4b" stroke="#fff" strokeWidth={small ? 2.5 : 3} />
      </svg>
      <span className="aerial-map-n" aria-hidden="true">N ↑</span>
      <span className="aerial-map-credit">{byAddress ? "Located by address · " : ""}Street map: Esri</span>
    </div>
  );
}

// The street map fills the panel so first-time viewers know where they are; the Vexcel photo for the chosen angle
// sits in the corner and swaps to full size on click. When Hermit counted parking on the cached Vexcel ortho, that photo
// (with the counted boxes) leads instead. Falls back to Esri imagery only when there is no Vexcel top-down photo at all.
// onProvider says whose photo is showing, so a caption never credits Esri for a Vexcel image.
export function Aerial({ report, onProvider }: { report: ShellReport; onProvider?: (p: "vexcel" | "esri") => void }) {
  const count = report.aerial?.image ? report.aerial : undefined;
  const [view, setView] = useState<ViewKey>("ortho");
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [photoBig, setPhotoBig] = useState(!!count);
  const [lotSqft, setLotSqft] = useState<number>();
  useEffect(() => {
    fetch(`/api/parcel/${encodeURIComponent(report.shellId)}`).then((r) => (r.ok ? r.json() : null)).then((d) => setLotSqft(d?.shell?.parcel?.lotSqft)).catch(() => {});
  }, [report.shellId]);
  const esri = missing.has("ortho") && !count;
  useEffect(() => { if (count) onProvider?.(count.provider); else if (esri) onProvider?.("esri"); }, [count, esri, onProvider]);
  if (!report.above) return <p className="muted" style={{ padding: 16 }}>No coordinates on record for this property.</p>;
  if (esri) return <EsriAerial report={report} />;
  const f = siteFacts(report, lotSqft);
  const label = VIEWS.find(([k]) => k === view)![1];
  const photo = view === "ortho" && count ? <CountedPhoto key="counted" count={count} address={report.address} /> : (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={view} className="aerial-photo" src={`/api/vexcel/${encodeURIComponent(report.shellId)}?view=${view}`} alt={`Vexcel ${label.toLowerCase()} aerial photo of ${report.address}`}
      onLoad={() => onProvider?.("vexcel")} onError={() => { setMissing((m) => new Set(m).add(view)); setView("ortho"); }} />
  );
  const map = <StreetMap address={report.address} lat={report.above.lat} lon={report.above.lon} facing={HEADING[view]} small={photoBig} />;
  return (
    <div className="aerial-view">
      <div role="group" aria-label="Vexcel camera angle" className="angles">
        {VIEWS.filter(([k]) => !missing.has(k)).map(([k, l]) => (
          <button key={k} type="button" className="btn small" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      <dl className="aerial-facts" aria-label="Site facts">
        <div><dt>Parking · CoStar record</dt><dd>{f.parking}</dd></div>
        <div><dt>Space size</dt><dd>{f.space}</dd></div>
        {f.lot && <div><dt>Lot size</dt><dd>{f.lot}</dd></div>}
        <div><dt>Photo faces</dt><dd>{FACES[view]}</dd></div>
      </dl>
      <div className="aerial-stage">
        <div className="aerial-main">{photoBig ? photo : map}{photoBig && <span className="aerial-credit">Vexcel</span>}</div>
        <button type="button" className="aerial-inset" onClick={() => setPhotoBig((b) => !b)} aria-label={photoBig ? "Show the street map full size" : `Show the ${label.toLowerCase()} Vexcel photo full size`}>
          {photoBig ? map : photo}
          <span className="aerial-inset-tag"><Maximize2 aria-hidden="true" /> {photoBig ? "Map" : "Vexcel photo"}</span>
        </button>
      </div>
    </div>
  );
}

function EsriAerial({ report }: { report: ShellReport }) {
  const a = report.above;
  const { pt, fail, dead } = useCoords(report.address, a?.lat, a?.lon);
  if (pt === undefined) return <p className="muted" style={{ padding: 16 }}>Finding the location...</p>;
  if (!pt) return <p className="muted" style={{ padding: 16 }}>No coordinates on record for this property.</p>;
  const z = 19;
  const t = tileFor(pt.lat, pt.lon, z);
  const offX = (1 + t.fx) * 256, offY = (1 + t.fy) * 256;
  if (dead) return <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 16, textAlign: "center" }}><p>Aerial imagery couldn&apos;t load (offline?). Location: <span className="num">{pt.lat.toFixed(5)}, {pt.lon.toFixed(5)}</span>.</p></div>;
  return (
    <div role="img" aria-label={`Aerial image centered on ${report.address}`} style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 768, height: 768, transform: `translate(${-offX}px, ${-offY}px)` }}>
        {[-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${dx}${dy}`} alt="" src={esriTile(z, t.x + dx, t.y + dy)} width={256} height={256} onError={fail} style={{ position: "absolute", left: (dx + 1) * 256, top: (dy + 1) * 256 }} />
        )))}
        <svg width={40} height={40} viewBox="0 0 24 24" aria-hidden="true" style={{ position: "absolute", left: offX - 20, top: offY - 38 }}>
          <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z" fill="#f26a4b" stroke="#fff" strokeWidth={1.5} />
          <circle cx={12} cy={9} r={2.6} fill="#fff" />
        </svg>
      </div>
      <span className="aerial-credit">Esri World Imagery</span>
    </div>
  );
}
