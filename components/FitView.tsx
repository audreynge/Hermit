import type { ShellReport } from "@/lib/types";

const W = 640, H = 440, PAD = 16;

export function FitView({ report }: { report: ShellReport }) {
  const g = report.floorplan;
  if (!g) return <p className="muted" style={{ padding: 16 }}>Record-only candidate: there is no room scan to lay the requirements onto.</p>;

  const byRoom = new Map(report.fit.assignment.filter((a) => a.roomId).map((a) => [a.roomId!, a.req]));
  const unmatched = report.fit.assignment.filter((a) => !a.roomId).map((a) => a.req);
  const floors = [...new Set(g.rooms.map((r) => r.floorId))];
  const floor = floors.sort((a, b) => area(g, b) - area(g, a))[0];
  const rooms = g.rooms.filter((r) => r.floorId === floor);
  const withPoly = rooms.filter((r) => r.polygon.length >= 3);

  const legend = (
    <ul className="row" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", fontSize: "var(--t-sm)" }}>
      <li className="row" style={{ gap: 6 }}><Swatch c="var(--coral)" /> matched to a requirement</li>
      <li className="row" style={{ gap: 6 }}><Swatch c="var(--sand-2)" /> measured room, unused</li>
      {unmatched.length > 0 && <li className="row" style={{ gap: 6 }}><Swatch c="var(--coral-wash)" dashed /> to build: {unmatched.join(", ")}</li>}
    </ul>
  );

  if (withPoly.length < rooms.length * 0.6) {
    const total = rooms.reduce((s, r) => s + r.areaSqft, 0) || 1;
    return (
      <figure style={{ margin: 0, padding: 12 }} aria-label="Room areas (no floor-plan geometry in this scan)">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {rooms.map((r) => {
            const req = byRoom.get(r.id);
            return (
              <div key={r.id} title={`${r.label} ${Math.round(r.areaSqft)} sf`} style={{
                flex: `${Math.max(0.08, r.areaSqft / total)} 1 0`, minWidth: 72, minHeight: 64, padding: 8, borderRadius: 8,
                background: req ? "var(--coral)" : "var(--sand-2)", color: req ? "#fff" : "var(--ink)", fontSize: 12,
              }}>
                <strong>{req ?? r.label}</strong><br /><span className="num">{Math.round(r.areaSqft)} sf</span>
              </div>
            );
          })}
          {unmatched.map((u) => (
            <div key={u} style={{ minWidth: 72, minHeight: 64, padding: 8, borderRadius: 8, border: "2px dashed var(--fail)", background: "var(--coral-wash)", color: "#14213d", fontSize: 12 }}>
              <strong>build</strong><br />{u}
            </div>
          ))}
        </div>
        <figcaption className="muted" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>This scan has no wall geometry, so rooms are shown by measured area.</figcaption>
        {legend}
      </figure>
    );
  }

  const xs = withPoly.flatMap((r) => r.polygon.map((p) => p.x)), ys = withPoly.flatMap((r) => r.polygon.map((p) => p.y));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1));
  const tx = (x: number) => PAD + (x - minX) * k, ty = (y: number) => H - PAD - (y - minY) * k;

  return (
    <figure style={{ margin: 0, padding: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Floor plan of ${g.name}: ${byRoom.size} rooms matched, ${unmatched.length} to build`}>
        {withPoly.map((r) => {
          const req = byRoom.get(r.id);
          const pts = r.polygon.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ");
          const cx = r.polygon.reduce((s, p) => s + tx(p.x), 0) / r.polygon.length;
          const cy = r.polygon.reduce((s, p) => s + ty(p.y), 0) / r.polygon.length;
          return (
            <g key={r.id}>
              <polygon points={pts} fill={req ? "var(--coral)" : "var(--sand-2)"} fillOpacity={req ? 0.85 : 1} stroke="var(--ink)" strokeWidth={1.2} />
              {r.areaSqft > 40 && (
                <text x={cx} y={cy} textAnchor="middle" fontSize={11} fill={req ? "#fff" : "var(--ink)"}>
                  <tspan x={cx}>{req ?? r.label}</tspan>
                  <tspan x={cx} dy={13} className="num">{Math.round(r.areaSqft)} sf</tspan>
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="muted" style={{ fontSize: "var(--t-sm)" }}>
        Matterport scan {g.sid}: {g.rooms.length} measured rooms, {Math.round(g.totalAreaSqft).toLocaleString()} sf net floor area{floors.length > 1 ? ` (largest of ${floors.length} floors shown)` : ""}.
      </figcaption>
      {legend}
    </figure>
  );
}

const area = (g: NonNullable<ShellReport["floorplan"]>, f: string) => g.rooms.filter((r) => r.floorId === f).reduce((s, r) => s + r.areaSqft, 0);

function Swatch({ c, dashed }: { c: string; dashed?: boolean }) {
  return <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 3, background: c, border: dashed ? "2px dashed var(--fail)" : "1px solid var(--ink)", display: "inline-block" }} />;
}
