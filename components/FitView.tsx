"use client";
import { useState } from "react";
import type { FitoutDiff } from "@/lib/design/fitout";
import type { Block } from "@/lib/spec/parse";
import { blockName } from "@/lib/design/layout-ops";
import { LayoutPreview } from "./LayoutPreview";
import { doorClearIn, doorPoint } from "@/lib/reason/access";
import type { Access, AccessRoom, RoomGraph, ShellReport } from "@/lib/types";
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
type View = "plan" | "3d" | "compare" | "design" | "access";

// Wheelchair view: tints carry the verdict, and every room also says it in words.
type AccessState = "reachable" | "hinges" | "blocked" | "unknown";
const ACCESS: Record<AccessState, { fill: string; label: string; legend: string }> = {
  reachable: { fill: "#dcefe2", label: "reachable", legend: "chair reaches it" },
  hinges: { fill: "url(#hinge-hatch)", label: "with hinges", legend: "reachable once offset hinges go on" },
  blocked: { fill: "#f6d3cc", label: "blocked", legend: "a door stops the chair" },
  unknown: { fill: "#ededed", label: "not measured", legend: "door width not measured" },
};
const HATCH_CSS = "repeating-linear-gradient(45deg, #9fcfae 0 3px, #eef7f0 3px 8px)";
type AccessView = { a: Access; hinges: boolean };

// As scanned, a room offset hinges would fix is still blocked: that is the point of the toggle.
function accessState(id: string, { a, hinges }: AccessView): AccessState {
  const scanned = a.asScanned.find((r) => r.roomId === id)?.status ?? "unknown";
  if (!hinges) return scanned;
  const fixed = a.hinges.find((r) => r.roomId === id)?.status ?? "unknown";
  return scanned === "blocked" && fixed === "reachable" ? "hinges" : fixed;
}

// Every measured door on the plan with its clear width for this case; red when the chair can't pass.
function doorLabels(g: RoomGraph, { a, hinges }: AccessView, shown: Set<string>) {
  const chairW = a.chairIn[0];
  const inner = g.edges.filter((e) => e.kind === "door" && e.widthIn != null && shown.has(e.a) && shown.has(e.b))
    .map((e) => ({ key: `${e.a}|${e.b}`, at: doorPoint(g, e.a, e.b, e.at), clear: doorClearIn(e, hinges) }));
  const outside = (g.entries ?? []).filter((d) => d.widthIn != null && shown.has(d.roomId))
    .map((d) => ({ key: `out|${d.roomId}`, at: doorPoint(g, d.roomId, null, d.at), clear: doorClearIn(d, hinges) }));
  return [...inner, ...outside].flatMap((d) => (d.at ? [{ ...d, at: d.at, tooNarrow: d.clear < chairW }] : []));
}

// Rooms a door stops the chair at, with the tour sweep to open: the room the chair is stuck in, looking at the door.
function blockedStops(g: RoomGraph, rooms: AccessRoom[]) {
  const sweep = (id?: string) => g.rooms.find((x) => x.id === id)?.sweeps?.[0]?.index;
  return rooms.filter((r) => r.status === "blocked" && r.stopDoor).flatMap((r) => {
    const index = sweep(r.stopDoor!.from === "outside" ? r.roomId : r.stopDoor!.from) ?? sweep(r.roomId);
    return index == null ? [] : [{ roomId: r.roomId, label: r.stopDoor!.from === "outside" ? "front" : r.label, index, clearIn: r.stopDoor!.clearIn }];
  }).filter((s, i, all) => all.findIndex((x) => x.label === s.label && x.index === s.index) === i);
}

function AccessPlan({ report, g, measuredRooms, a, onShowInTour }: { report: ShellReport; g: RoomGraph; measuredRooms?: number; a: Access; onShowInTour?: (sweepIndex: number) => void }) {
  const [hinges, setHinges] = useState(false);
  const fixable = a.asScanned.some((r) => r.status === "blocked" && a.hinges.find((x) => x.roomId === r.roomId)?.status === "reachable");
  const stops = onShowInTour ? blockedStops(g, hinges ? a.hinges : a.asScanned) : [];
  return (
    <>
      {fixable && (
        <div className="view-switch" role="group" aria-label="Door scenario" style={{ marginTop: 8 }}>
          <button type="button" aria-pressed={!hinges} onClick={() => setHinges(false)}>As scanned</button>
          <button type="button" aria-pressed={hinges} onClick={() => setHinges(true)}>With offset hinges</button>
        </div>
      )}
      <Plan2D report={report} g={g} measuredRooms={measuredRooms} access={{ a, hinges }} />
      {stops.length > 0 && (
        <nav aria-label="Doors that stop the chair" className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {stops.map((s) => (
            <button key={`${s.roomId}-${s.index}`} type="button" className="btn small" onClick={() => onShowInTour!(s.index)}>
              Show the {s.label} door ({s.clearIn} in) in the 3D tour
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
const k$ = (n: number) => `$${Math.round(n / 1000)}k`;
const range = ([lo, hi]: readonly number[]) => (hi ? `${k$(lo)}–${k$(hi)}` : "none");
export type Proposal = { report: ShellReport; diff: FitoutDiff; kept: boolean };

export function FitView({ report: measured, proposal, onKeep, onUndo, onShowInTour, design }: { report: ShellReport; proposal?: Proposal | null; onKeep?: () => void; onUndo?: () => void; onShowInTour?: (sweepIndex: number) => void; design?: Block[] }) {
  const report = proposal?.report ?? measured;
  const sim = report.similarity?.layout?.length ? report.similarity : undefined;
  const mine = design?.some((b) => b.kind !== "object") ? design : undefined;
  // One "vs your design" slot: the 2D side by side when the design is passed, else the similarity 3D pair.
  const vs: View | null = mine ? "design" : sim ? "compare" : null;
  const [picked, setView] = useState<View>(vs ?? "plan");
  const view: View = (picked === "design" || picked === "compare") && picked !== vs ? (vs ?? "plan") : picked; // the report can change under a kept view
  const g = report.floorplan;
  if (!g) return <p className="muted" style={{ padding: 16 }}>Record-only candidate: there is no room scan to lay the requirements onto.</p>;
  const access = measured.access; // computed on the measured scan, not on a proposed edit
  const views: [View, string][] = [["plan", "2D plan"], ...(vs ? [[vs, "Your design vs this space"] as [View, string]] : []), ["3d", "3D model"], ...(access ? [["access", "Wheelchair access"] as [View, string]] : [])];
  return (
    <div style={{ padding: 12 }}>
      <div className="view-switch" role="group" aria-label="Fit view">
        {views.map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
      </div>
      {proposal && <ProposalStrip p={proposal} onKeep={onKeep} onUndo={onUndo} />}
      {view === "plan" && <Plan2D report={report} g={g} measuredRooms={measured.floorplan?.rooms.length} />}
      {view === "access" && access && <AccessPlan report={report} g={g} measuredRooms={measured.floorplan?.rooms.length} a={access} onShowInTour={onShowInTour} />}
      {view === "3d" && <Scan3D report={report} g={g} />}
      {view === "design" && mine && <DesignVsSpace report={report} g={g} design={mine} measuredRooms={measured.floorplan?.rooms.length} />}
      {view === "compare" && sim && <LayoutCompare name={report.name.split(" · ")[0]} g={g} sim={sim} />}
    </div>
  );
}

const mainFloor = (g: RoomGraph) => [...new Set(g.rooms.map((r) => r.floorId))].sort((a, b) => area(g, b) - area(g, a))[0];
// Matterport y points up in plan; flip so the 3D view reads the same way round as the 2D plan.
const scanSolids = (g: RoomGraph, paint: (roomId: string, label: string) => { fill: string; label?: string }): Solid[] =>
  g.rooms.filter((r) => r.floorId === mainFloor(g)).flatMap((r) => {
    const p = paint(r.id, r.label);
    // A proposed merge has no polygon of its own, only the measured parts.
    const polys = r.parts?.length ? r.parts : r.polygon.length >= 3 ? [r.polygon] : [];
    return polys.map((poly, i) => ({ id: `${r.id}~${i}`, polygon: poly.map((q) => ({ x: q.x * M_TO_FT, y: -q.y * M_TO_FT })), height: roomHeight(r.heightFt), fill: p.fill, label: i ? undefined : p.label }));
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
  return (
    <figure style={{ margin: 0 }}>
      {sim.scale !== 1 && <p className="muted" style={{ margin: "0 0 4px" }}>Your design scaled to <span className="num">{Math.round(sim.scale * 100)}%</span> of its drawn area</p>}
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

const HALL = /hall|corridor/i;
// Mirrors ROOM_ALIAS in lib/spec/parse.ts, which turns drawn labels into requirement labels.
const reqLabel = (l: string) => (l.toLowerCase() === "waiting area" ? "reception" : l.toLowerCase());
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// Your drawn rooms against the fit: the nth room of a type is matched when the nth requirement of that type got a scan room.
export function designMatch(design: Block[], assignment: ShellReport["fit"]["assignment"]) {
  const rooms = design.filter((b) => b.kind !== "object");
  const seen = new Map<string, number>();
  const named = rooms.filter((b) => !HALL.test(b.label)).map((b) => {
    const key = reqLabel(b.label); // aliases ("waiting area", "reception") share one requirement's slots
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const hits = assignment.filter((a) => a.req.replace(/ #\d+$/, "").toLowerCase() === key);
    return { name: blockName(design, b), matched: !!hits[n]?.roomId };
  });
  return { matched: named.filter((r) => r.matched).map((r) => r.name), build: named.filter((r) => !r.matched).map((r) => r.name), sqft: Math.round(rooms.reduce((s, b) => s + b.w * b.h, 0)) };
}

function DesignVsSpace({ report, g, design, measuredRooms }: { report: ShellReport; g: RoomGraph; design: Block[]; measuredRooms?: number }) {
  const m = designMatch(design, report.fit.assignment);
  return (
    <section aria-label="Your design next to this space">
      <div className="fit-twoup">
        <div><h4>Your design</h4><LayoutPreview blocks={design} /></div>
        <div><h4>This space</h4><Plan2D report={report} g={g} measuredRooms={measuredRooms} /></div>
      </div>
      <p className="fit-twoup-summary">
        {m.matched.length ? <>Already here: {list(m.matched)}. </> : "None of your rooms has a match here yet. "}
        {m.build.length ? <>Must be built: {list(m.build)}. </> : m.matched.length ? "Nothing to build. " : ""}
        Yours is about <span className="num">{m.sqft.toLocaleString()}</span> sq ft; this space is about <span className="num">{Math.round(g.totalAreaSqft).toLocaleString()}</span> sq ft.
      </p>
    </section>
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

function Plan2D({ report, g, measuredRooms, access }: { report: ShellReport; g: RoomGraph; measuredRooms?: number; access?: AccessView }) {
  const byRoom = new Map(report.fit.assignment.filter((a) => a.roomId).map((a) => [a.roomId!, tidy(a.req)]));
  const unmatched = report.fit.assignment.filter((a) => !a.roomId).map((a) => tidy(a.req));
  const floors = [...new Set(g.rooms.map((r) => r.floorId))];
  const floor = floors.sort((a, b) => area(g, b) - area(g, a))[0];
  const rooms = g.rooms.filter((r) => r.floorId === floor);
  // A proposed merge keeps the original measured polygons as parts; draw each one.
  const shapes = (r: (typeof rooms)[number]) => (r.parts?.length ? r.parts : r.polygon.length >= 3 ? [r.polygon] : []);
  const withPoly = rooms.filter((r) => shapes(r).length);
  const proposed = rooms.filter((r) => r.proposed);

  const state = (id: string) => accessState(id, access!);
  const states = access ? withPoly.map((r) => state(r.id)) : [];
  const count = (s: AccessState) => states.filter((x) => x === s).length;
  const labels = access ? doorLabels(g, access, new Set(withPoly.map((r) => r.id))) : [];
  const chair = access ? `${access.a.chairIn[0]} in chair` : "";

  const legend = access ? (
    <ul className="plan-legend">
      {(Object.keys(ACCESS) as AccessState[]).map((s) => (
        <li key={s}><span className="sw" aria-hidden="true" style={{ background: s === "hinges" ? HATCH_CSS : ACCESS[s].fill }} /> {ACCESS[s].legend} ({count(s)})</li>
      ))}
      {labels.length > 0 && <li><span className="sw" aria-hidden="true" style={{ background: labels.some((d) => d.tooNarrow) ? "var(--fail)" : INK, borderRadius: 7 }} /> doors, with clear width in inches{labels.some((d) => d.tooNarrow) ? "; red = too narrow for the chair" : ""}</li>}
    </ul>
  ) : (
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
      <div className="plan-scroll"><svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={access
        ? `Wheelchair route on ${g.name} for a ${chair}: ${count("reachable")} rooms reachable, ${count("hinges")} fit with offset hinges, ${count("blocked")} blocked, ${count("unknown")} not measured`
        : `Floor plan of ${g.name}: ${byRoom.size} rooms matched, ${unmatched.length} to build${proposed.length ? `; proposed changes to ${proposed.map((r) => r.label).join(", ")}` : ""}`}>
        <defs>
          <pattern id="hinge-hatch" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={8} height={8} fill="#eef7f0" />
            <line x1={0} y1={0} x2={0} y2={8} stroke="#9fcfae" strokeWidth={3} />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="#fff" />
        {withPoly.map((r) => {
          const req = byRoom.get(r.id);
          const main = shapes(r)[0];
          const { x: cx, y: cy, r: room } = labelPoint(main.map((p) => ({ x: tx(p.x), y: ty(p.y) })));
          const name = `${(access ? r.label : req ?? r.label).toUpperCase()}${r.proposed ? "*" : ""}`;
          const fill = access ? ACCESS[state(r.id)].fill : req ? MATCH : "#fff";
          const line2 = access ? ACCESS[state(r.id)].label.toUpperCase() : `${Math.round(r.areaSqft)} SF`;
          const fits = room * 2 > name.length * 6.2 + 4 && room > 15;
          return (
            <g key={r.id}>
              {shapes(r).map((poly, i) => (
                <polygon key={i} points={poly.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ")} fill={fill} stroke={INK} strokeWidth={2.5} strokeLinejoin="miter" strokeDasharray={r.proposed ? "7 4" : undefined} />
              ))}
              {fits ? (
                <text x={cx} y={cy - 2} textAnchor="middle" fontSize={9.5} letterSpacing={0.6} fill={req ? INK : MUTED} fontWeight={req ? 700 : 500}>
                  {name}
                  <tspan x={cx} dy={13} fontSize={9} fontWeight={access ? 700 : 400} fill={access ? INK : MUTED} letterSpacing={0} className={access ? undefined : "num"}>{line2}</tspan>
                </text>
              ) : room > 9 && (
                <text x={cx} y={cy + 3} textAnchor="middle" fontSize={8.5} fill={MUTED} className="num">{Math.round(r.areaSqft)}</text>
              )}
            </g>
          );
        })}
        {labels.map((d) => (
          <g key={d.key}>
            <circle cx={tx(d.at.x)} cy={ty(d.at.y)} r={d.tooNarrow ? 6 : 4} fill={d.tooNarrow ? "var(--fail)" : INK} stroke="#fff" strokeWidth={2} />
            <text x={tx(d.at.x) + 8} y={ty(d.at.y) - 7} fontSize={10} fontWeight={700} fill={d.tooNarrow ? "var(--fail)" : INK} stroke="#fff" strokeWidth={3} paintOrder="stroke" className="num">{d.clear}&quot;</text>
          </g>
        ))}
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
        {access && `Route for a ${chair} from the entry through measured doors${access.hinges ? ", with offset hinges on every hinged door" : ""}. Clear widths are estimates (opening minus about 2 in for a hinged door); confirm with a tape. · `}
        {proposed.length > 0 && "* proposed change, not measured · "}Matterport scan {g.sid} · {measuredRooms ?? g.rooms.length} measured rooms · {Math.round(g.totalAreaSqft).toLocaleString()} sf net{floors.length > 1 ? ` · largest of ${floors.length} floors shown` : ""}
      </figcaption>
      {legend}
    </figure>
  );
}

const area = (g: NonNullable<ShellReport["floorplan"]>, f: string) => g.rooms.filter((r) => r.floorId === f).reduce((s, r) => s + r.areaSqft, 0);
