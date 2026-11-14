"use client";
import { useState } from "react";
import type { FitoutDiff } from "@/lib/design/fitout";
import type { RoomGraph, ShellReport } from "@/lib/types";
import { M_TO_FT, PAIR_COLORS, Plan3D, rectPoly, roomHeight, type Solid } from "./Plan3D";

const W = 640, MAX_H = 460, PAD = 28;
const INK = "#111", MUTED = "#6b6b6b", MATCH = "#e6e6e6";

type Pt = { x: number; y: number };
const shoelace = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;
const nice = (ft: number) => [5, 10, 20, 25, 50, 100, 200].find((n) => n >= ft) ?? 500;
const tidy = (req: string) => req.replace(/\s*#(\d+)/, " $1");

const inside = (x: number, y: number, p: Pt[]) => p.reduce((c, a, i) => { const b = p[(i + 1) % p.length]; return (a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x ? !c : c; }, false);
const segDist = (x: number, y: number, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
};
// ponytail: 12x12 grid search for the roomiest interior point; polylabel if labels still collide on odd shapes.
export function labelPoint(p: Pt[]): Pt & { r: number } {
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: 0 };
  for (let i = 0.5; i < 12; i++) for (let j = 0.5; j < 12; j++) {
    const x = x0 + ((x1 - x0) * i) / 12, y = y0 + ((y1 - y0) * j) / 12;
    if (!inside(x, y, p)) continue;
    const r = Math.min(...p.map((a, k) => segDist(x, y, a, p[(k + 1) % p.length])));
    if (r > best.r) best = { x, y, r };
  }
  return best;
}
type View = "plan" | "3d" | "compare";
const k$ = (n: number) => `$${Math.round(n / 1000)}k`;
const range = ([lo, hi]: readonly number[]) => (hi ? `${k$(lo)}–${k$(hi)}` : "none");
export type Proposal = { report: ShellReport; diff: FitoutDiff; kept: boolean };

export function FitView({ report: measured, proposal, onKeep, onUndo }: { report: ShellReport; proposal?: Proposal | null; onKeep?: () => void; onUndo?: () => void }) {
  const report = proposal?.report ?? measured;
  const sim = report.similarity?.layout?.length ? report.similarity : undefined;
  const [picked, setView] = useState<View>(sim ? "compare" : "plan");
  const view: View = picked === "compare" && !sim ? "plan" : picked; // the report can change under a kept view
  const g = report.floorplan;
  if (!g) return <p className="muted" style={{ padding: 16 }}>Record-only candidate: there is no room scan to lay the requirements onto.</p>;
  const views: [View, string][] = [["plan", "2D plan"], ["3d", "3D model"], ...(sim ? [["compare", "vs. your design"] as [View, string]] : [])];
  return (
    <div style={{ padding: 12 }}>
      <div className="view-switch" role="group" aria-label="Fit view">
        {views.map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {proposal && <ProposalStrip p={proposal} onKeep={onKeep} onUndo={onUndo} />}
      {view === "plan" && <Plan2D report={report} g={g} measuredRooms={measured.floorplan?.rooms.length} />}
      {view === "3d" && <Scan3D report={report} g={g} />}
      {view === "compare" && sim && <LayoutCompare name={report.name.split(" · ")[0]} g={g} sim={sim} />}
    </div>
  );
}

const mainFloor = (g: RoomGraph) => [...new Set(g.rooms.map((r) => r.floorId))].sort((a, b) => area(g, b) - area(g, a))[0];
// Matterport y points up in plan; flip so the 3D view reads the same way round as the 2D plan.
const scanSolids = (g: RoomGraph, paint: (roomId: string, label: string) => { fill: string; label?: string }): Solid[] =>
  g.rooms.filter((r) => r.floorId === mainFloor(g) && r.polygon.length >= 3).map((r) => {
    const p = paint(r.id, r.label);
    return { id: r.id, polygon: r.polygon.map((q) => ({ x: q.x * M_TO_FT, y: -q.y * M_TO_FT })), height: roomHeight(r.heightFt), fill: p.fill, label: p.label };
  });

function Scan3D({ report, g }: { report: ShellReport; g: RoomGraph }) {
  const byRoom = new Map(report.fit.assignment.filter((a) => a.roomId).map((a) => [a.roomId!, a.req]));
  const solids = scanSolids(g, (id, label) => {
    const req = byRoom.get(id);
    return { fill: req ? "#f58a6b" : label === "hallway" ? "#fff1d6" : "#fbe5d8", label: req ?? undefined };
  });
  if (!solids.length) return <p className="muted">This scan has no wall geometry to build a 3D model from.</p>;
  return (
    <figure style={{ margin: 0 }}>
      <Plan3D solids={solids} label={`3D model of ${g.name} from Matterport room polygons`} wallScale={0.5} />
      <figcaption className="muted" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>
        Extruded from scan {g.sid} room outlines (walls cut to half height). Coral rooms already serve one of your requirements. Geometry only: it does not show fixtures or finishes.
      </figcaption>
    </figure>
  );
}

export function LayoutCompare({ name, g, sim }: { name: string; g: RoomGraph; sim: NonNullable<ShellReport["similarity"]> }) {
  const layout = sim.layout!;
  const color = new Map(sim.pairs.map((p, i) => [p.mine, PAIR_COLORS[i % PAIR_COLORS.length]]));
  const theirs = new Map(sim.pairs.map((p, i) => [p.theirs, { c: PAIR_COLORS[i % PAIR_COLORS.length], l: layout[p.mine]?.label }]));
  const k = Math.sqrt(sim.scale);
  const mine: Solid[] = layout.map((b, i) => ({
    id: `m${i}`, polygon: rectPoly({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }), height: 9,
    fill: color.get(i) ?? (/hall|corridor/i.test(b.label) ? "#fff1d6" : "#ffffff"), dashed: !color.has(i) && !/hall|corridor/i.test(b.label), label: b.label,
  }));
  const scan = scanSolids(g, (id) => { const t = theirs.get(id); return t ? { fill: t.c, label: t.l } : { fill: "#f3e9e2" }; });
  const unmatched = layout.filter((b, i) => !color.has(i) && !/hall|corridor/i.test(b.label)).map((b) => b.label);
  const bars: [string, number | null][] = [["Room program", sim.breakdown.program], ["Adjacency kept", sim.breakdown.adjacency], ["Total size", sim.breakdown.size], ["Footprint shape", sim.breakdown.shape]];
  return (
    <figure style={{ margin: 0 }}>
      <p style={{ margin: "0 0 4px" }}><strong className="num">{sim.score}%</strong> layout similarity{sim.scale !== 1 ? <> · your design scaled to <span className="num">{Math.round(sim.scale * 100)}%</span> of its drawn area</> : null}</p>
      <div className="sim-bars">
        {bars.map(([l, v]) => <div key={l}><strong className="num">{v == null ? "n/a" : `${v}%`}</strong>{l}{v != null && <meter min={0} max={100} value={v} aria-label={`${l} ${v}%`} />}</div>)}
      </div>
      <div className="compare3d">
        <div><h4>Your design</h4><Plan3D solids={mine} label="Your drawn layout in 3D" height={300} wallScale={0.5} /></div>
        <div><h4>{name} (measured)</h4>{scan.length ? <Plan3D solids={scan} label={`Matched scan ${g.sid} in 3D`} height={300} wallScale={0.5} /> : <p className="muted">No wall geometry in this scan.</p>}</div>
      </div>
      <figcaption className="muted" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>
        Matching colours are rooms Hermit paired by type and size{unmatched.length ? `; dashed rooms (${unmatched.join(", ")}) have no counterpart in the scan` : ""}. Similarity compares room tags and outlines from scan {g.sid}; it is a screening signal, not a survey.
      </figcaption>
    </figure>
  );
}

function ProposalStrip({ p, onKeep, onUndo }: { p: Proposal; onKeep?: () => void; onUndo?: () => void }) {
  const d = p.diff;
  return (
    <div className="row" role="group" aria-label="Proposed changes" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--sand-2)", marginBottom: 8 }}>
      <span role="status" style={{ fontSize: "var(--t-sm)" }}>
        <strong>Proposed{p.kept ? " (kept)" : ""}:</strong> fit {d.fit[0]} → {d.fit[1]} · known work {range(d.cost[1])} (was {range(d.cost[0])}) · {d.weeks[1][0]}–{d.weeks[1][1]} wks
      </span>
      <span className="row" style={{ gap: 6 }}>
        {!p.kept && onKeep && <button type="button" className="btn small" onClick={onKeep}>Keep</button>}
        {onUndo && <button type="button" className="btn small" onClick={onUndo}>Undo</button>}
      </span>
    </div>
  );
}

function Plan2D({ report, g, measuredRooms }: { report: ShellReport; g: RoomGraph; measuredRooms?: number }) {
  const byRoom = new Map(report.fit.assignment.filter((a) => a.roomId).map((a) => [a.roomId!, tidy(a.req)]));
  const unmatched = report.fit.assignment.filter((a) => !a.roomId).map((a) => tidy(a.req));
  const floors = [...new Set(g.rooms.map((r) => r.floorId))];
  const floor = floors.sort((a, b) => area(g, b) - area(g, a))[0];
  const rooms = g.rooms.filter((r) => r.floorId === floor);
  // A proposed merge keeps the original measured polygons as parts; draw each one.
  const shapes = (r: (typeof rooms)[number]) => (r.parts?.length ? r.parts : r.polygon.length >= 3 ? [r.polygon] : []);
  const withPoly = rooms.filter((r) => shapes(r).length);
  const proposed = rooms.filter((r) => r.proposed);

  const legend = (
    <ul className="plan-legend">
      <li><span className="sw match" aria-hidden="true" /> matched to your requirement</li>
      <li><span className="sw" aria-hidden="true" /> measured room, not needed</li>
      {unmatched.length > 0 && <li><span className="sw build" aria-hidden="true" /> to build: {unmatched.join(", ")}</li>}
      {proposed.length > 0 && <li><span className="sw build" aria-hidden="true" /> * proposed change, not measured</li>}
    </ul>
  );

  if (withPoly.length < rooms.length * 0.6) {
    const total = rooms.reduce((s, r) => s + r.areaSqft, 0) || 1;
    return (
      <figure className="plan" aria-label="Room areas (no floor-plan geometry in this scan)">
        <div className="plan-blocks">
          {rooms.map((r) => {
            const req = byRoom.get(r.id);
            return (
              <div key={r.id} className={req ? "match" : undefined} style={{ flex: `${Math.max(0.08, r.areaSqft / total)} 1 0` }} title={`${r.label} ${Math.round(r.areaSqft)} sf`}>
                <strong>{req ?? r.label}{r.proposed ? "*" : ""}</strong><span className="num">{Math.round(r.areaSqft)} sf</span>
              </div>
            );
          })}
          {unmatched.map((u) => <div key={u} className="build"><strong>{u}</strong><span>to build</span></div>)}
        </div>
        <figcaption>This scan has no wall geometry, so rooms are shown by measured area.</figcaption>
        {legend}
      </figure>
    );
  }

  const xs = withPoly.flatMap((r) => shapes(r).flat().map((p) => p.x)), ys = withPoly.flatMap((r) => shapes(r).flat().map((p) => p.y));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((W - 2 * PAD) / (maxX - minX || 1), (MAX_H - 2 * PAD) / (maxY - minY || 1));
  const H = Math.round((maxY - minY) * k + 2 * PAD + 24);
  const ox = (W - (maxX - minX) * k) / 2;
  const tx = (x: number) => ox + (x - minX) * k, ty = (y: number) => PAD + (maxY - y) * k;

  // Feet per drawing unit from measured area vs polygon area, so the scale bar is unit-agnostic.
  const ratios = withPoly.map((r) => Math.sqrt(r.areaSqft / (shoelace(r.polygon) || Infinity))).filter((v) => v > 0 && isFinite(v)).sort((a, b) => a - b);
  const ftPerUnit = ratios[Math.floor(ratios.length / 2)];
  const barFt = ftPerUnit ? nice((W * 0.18) / k * ftPerUnit) : 0;
  const barPx = ftPerUnit ? (barFt / ftPerUnit) * k : 0;

  return (
    <figure className="plan">
      <div className="plan-scroll"><svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Floor plan of ${g.name}: ${byRoom.size} rooms matched, ${unmatched.length} to build${proposed.length ? `; proposed changes to ${proposed.map((r) => r.label).join(", ")}` : ""}`}>
        <rect width={W} height={H} fill="#fff" />
        {withPoly.map((r) => {
          const req = byRoom.get(r.id);
          const main = shapes(r)[0];
          const { x: cx, y: cy, r: room } = labelPoint(main.map((p) => ({ x: tx(p.x), y: ty(p.y) })));
          const name = `${(req ?? r.label).toUpperCase()}${r.proposed ? "*" : ""}`;
          const fits = room * 2 > name.length * 6.2 + 4 && room > 15;
          return (
            <g key={r.id}>
              {shapes(r).map((poly, i) => (
                <polygon key={i} points={poly.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ")} fill={req ? MATCH : "#fff"} stroke={INK} strokeWidth={2.5} strokeLinejoin="miter" strokeDasharray={r.proposed ? "7 4" : undefined} />
              ))}
              {fits ? (
                <text x={cx} y={cy - 2} textAnchor="middle" fontSize={9.5} letterSpacing={0.6} fill={req ? INK : MUTED} fontWeight={req ? 700 : 500}>
                  {name}
                  <tspan x={cx} dy={13} fontSize={9} fontWeight={400} fill={MUTED} letterSpacing={0} className="num">{Math.round(r.areaSqft)} SF</tspan>
                </text>
              ) : room > 9 && (
                <text x={cx} y={cy + 3} textAnchor="middle" fontSize={8.5} fill={MUTED} className="num">{Math.round(r.areaSqft)}</text>
              )}
            </g>
          );
        })}
        {barPx > 0 && (
          <g transform={`translate(${PAD}, ${H - 18})`} fontSize={9} fill={INK}>
            <rect width={barPx / 2} height={4} fill={INK} />
            <rect x={barPx / 2} width={barPx / 2} height={4} fill="#fff" stroke={INK} strokeWidth={1} />
            <text x={0} y={-4}>0</text>
            <text x={barPx} y={-4} textAnchor="end" className="num">{barFt} FT</text>
          </g>
        )}
      </svg></div>
      <figcaption>
        {proposed.length > 0 && "* proposed change, not measured · "}Matterport scan {g.sid} · {measuredRooms ?? g.rooms.length} measured rooms · {Math.round(g.totalAreaSqft).toLocaleString()} sf net{floors.length > 1 ? ` · largest of ${floors.length} floors shown` : ""}
      </figcaption>
      {legend}
    </figure>
  );
}

const area = (g: NonNullable<ShellReport["floorplan"]>, f: string) => g.rooms.filter((r) => r.floorId === f).reduce((s, r) => s + r.areaSqft, 0);
