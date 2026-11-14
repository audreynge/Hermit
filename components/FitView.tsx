import type { ShellReport } from "@/lib/types";

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

export function FitView({ report }: { report: ShellReport }) {
  const g = report.floorplan;
  if (!g) return <p className="muted" style={{ padding: 16 }}>Record-only candidate: there is no room scan to lay the requirements onto.</p>;

  const byRoom = new Map(report.fit.assignment.filter((a) => a.roomId).map((a) => [a.roomId!, tidy(a.req)]));
  const unmatched = report.fit.assignment.filter((a) => !a.roomId).map((a) => tidy(a.req));
  const floors = [...new Set(g.rooms.map((r) => r.floorId))];
  const floor = floors.sort((a, b) => area(g, b) - area(g, a))[0];
  const rooms = g.rooms.filter((r) => r.floorId === floor);
  const withPoly = rooms.filter((r) => r.polygon.length >= 3);

  const legend = (
    <ul className="plan-legend">
      <li><span className="sw match" aria-hidden="true" /> matched to your requirement</li>
      <li><span className="sw" aria-hidden="true" /> measured room, not needed</li>
      {unmatched.length > 0 && <li><span className="sw build" aria-hidden="true" /> to build: {unmatched.join(", ")}</li>}
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
                <strong>{req ?? r.label}</strong><span className="num">{Math.round(r.areaSqft)} sf</span>
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

  const xs = withPoly.flatMap((r) => r.polygon.map((p) => p.x)), ys = withPoly.flatMap((r) => r.polygon.map((p) => p.y));
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
      <div className="plan-scroll"><svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Floor plan of ${g.name}: ${byRoom.size} rooms matched, ${unmatched.length} to build`}>
        <rect width={W} height={H} fill="#fff" />
        {withPoly.map((r) => {
          const req = byRoom.get(r.id);
          const pts = r.polygon.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ");
          const { x: cx, y: cy, r: room } = labelPoint(r.polygon.map((p) => ({ x: tx(p.x), y: ty(p.y) })));
          const name = (req ?? r.label).toUpperCase();
          const fits = room * 2 > name.length * 6.2 + 4 && room > 15;
          return (
            <g key={r.id}>
              <polygon points={pts} fill={req ? MATCH : "#fff"} stroke={INK} strokeWidth={2.5} strokeLinejoin="miter" />
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
        Matterport scan {g.sid} · {g.rooms.length} measured rooms · {Math.round(g.totalAreaSqft).toLocaleString()} sf net{floors.length > 1 ? ` · largest of ${floors.length} floors shown` : ""}
      </figcaption>
      {legend}
    </figure>
  );
}

const area = (g: NonNullable<ShellReport["floorplan"]>, f: string) => g.rooms.filter((r) => r.floorId === f).reduce((s, r) => s + r.areaSqft, 0);
