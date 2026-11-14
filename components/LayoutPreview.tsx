import { blockName } from "@/lib/design/layout-ops";
import { ROOM_TYPES } from "@/lib/design/rooms";
import type { Block } from "@/lib/spec/parse";

const FILL = Object.fromEntries(ROOM_TYPES.map((r) => [r.type, r.fill]));

/** Read-only drawing of a Layout Studio layout, shown in the chat after an edit. */
export function LayoutPreview({ blocks }: { blocks: Block[] }) {
  const rooms = blocks.filter((b) => b.kind !== "object");
  const objects = blocks.filter((b) => b.kind === "object" && b.label !== "door");
  if (!rooms.length) return <p className="muted" style={{ margin: 0 }}>The layout is empty.</p>;
  const x0 = Math.min(...rooms.map((r) => r.x)) - 1, y0 = Math.min(...rooms.map((r) => r.y)) - 1;
  const W = Math.max(...rooms.map((r) => r.x + r.w)) - x0 + 1, H = Math.max(...rooms.map((r) => r.y + r.h)) - y0 + 1;
  const area = Math.round(rooms.reduce((s, r) => s + r.w * r.h, 0));
  const names = rooms.map((r) => blockName(blocks, r));
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`${x0} ${y0} ${W} ${H}`} width="100%" style={{ maxHeight: 260 }} role="img"
        aria-label={`Your layout: ${names.join(", ")}; about ${area.toLocaleString()} square feet`}>
        {rooms.map((r, i) => (
          <g key={r.id}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={0.5} fill={FILL[r.label] ?? "#f7efe9"} stroke="#6b4a3a" strokeWidth={0.25} />
            <text x={r.x + r.w / 2} y={r.y + r.h / 2 + 0.5} textAnchor="middle" fontSize={Math.min(1.6, r.w / 7)} fontWeight={700} fill="#3b2320">{names[i]}</text>
          </g>
        ))}
        {objects.map((o) => <rect key={o.id} x={o.x} y={o.y} width={o.w} height={o.h} rx={0.3} fill="#fff" stroke="#9a7b6b" strokeWidth={0.15} opacity={0.8} />)}
      </svg>
      <figcaption className="muted" style={{ fontSize: "var(--t-sm)" }}>{rooms.length} rooms · about {area.toLocaleString()} sq ft</figcaption>
    </figure>
  );
}
