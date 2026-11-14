import type { Block } from "@/lib/spec/parse";

const FILL: Record<string, string> = { reception: "#fde3d4", "exam room": "#dcefff", office: "#e6f4e8", hallway: "#fff1d6", storage: "#ece6f6", kitchen: "#fff0e0", bathroom: "#e3f4fb", "waiting area": "#fde3d4", conference: "#f3ecff", "procedure room": "#ffe5e5" };

export function DesignThumb({ blocks }: { blocks: Block[] }) {
  const rooms = blocks.filter((b) => b.kind !== "object");
  if (!rooms.length) return null;
  const x0 = Math.min(...rooms.map((r) => r.x)), y0 = Math.min(...rooms.map((r) => r.y));
  const w = Math.max(...rooms.map((r) => r.x + r.w)) - x0, h = Math.max(...rooms.map((r) => r.y + r.h)) - y0;
  return (
    <svg viewBox={`${x0 - 1} ${y0 - 1} ${w + 2} ${h + 2}`} width="100%" style={{ maxWidth: 320, display: "block", marginTop: 8 }} role="img" aria-label={`Drawn layout with ${rooms.length} rooms`}>
      {rooms.map((r) => <rect key={r.id} x={r.x} y={r.y} width={r.w} height={r.h} fill={FILL[r.label] ?? "#f7efe9"} stroke="#6b4a3a" strokeWidth={0.4} />)}
      {rooms.map((r) => r.w > 8 && <text key={`t${r.id}`} x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" fontSize={2} fill="#3b2320">{r.label}</text>)}
    </svg>
  );
}
