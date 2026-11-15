import type { FurnType } from "@/lib/spec/furnish";

// Top-down furniture glyphs, drawn in feet inside a w×h box.
export function FurnArt({ type, w, h }: { type: FurnType; w: number; h: number }) {
  const ink = "#5b3d33", sw = 0.12, wood = "#e9c9a5", soft = "#f3a68f", white = "#fbfaf8", water = "#bfe3f2", green = "#8cc97f";
  const r = Math.min(w, h);
  switch (type) {
    case "chair": case "styling chair":
      return <g><rect x={0.15 * w} y={0.25 * h} width={0.7 * w} height={0.65 * h} rx={0.25 * r} fill={type === "chair" ? soft : "#c9b6e4"} stroke={ink} strokeWidth={sw} /><rect x={0.15 * w} y={0.05 * h} width={0.7 * w} height={0.22 * h} rx={0.1 * r} fill={ink} /></g>;
    case "desk": case "table":
      return <rect x={0} y={0} width={w} height={h} rx={0.25} fill={wood} stroke={ink} strokeWidth={sw} />;
    case "reception desk":
      return <path d={`M0 0 H${w} V${h} H${w - 1.2} V1.2 H0 Z`} fill={wood} stroke={ink} strokeWidth={sw} />;
    case "sofa":
      return <g><rect x={0} y={0} width={w} height={h} rx={0.6} fill={soft} stroke={ink} strokeWidth={sw} /><rect x={0} y={0} width={w} height={0.8} rx={0.3} fill={ink} opacity={0.6} /></g>;
    case "bed":
      return <g><rect x={0} y={0} width={w} height={h} rx={0.3} fill={white} stroke={ink} strokeWidth={sw} /><rect x={0.5} y={0.4} width={w - 1} height={1.2} rx={0.4} fill={water} /></g>;
    case "exam table":
      return <g><rect x={0} y={0} width={w} height={h} rx={0.5} fill={white} stroke={ink} strokeWidth={sw} /><rect x={0.2} y={0.3} width={1.2} height={h - 0.6} rx={0.4} fill={water} /></g>;
    case "shelf":
      return <rect x={0} y={0} width={w} height={h} fill={wood} stroke={ink} strokeWidth={sw} strokeDasharray="0.5 0.3" />;
    case "plant":
      return <circle cx={w / 2} cy={h / 2} r={r / 2} fill={green} stroke="#4f8f4a" strokeWidth={sw} />;
    case "sink": case "shampoo sink":
      return <g><rect x={0} y={0} width={w} height={h} rx={type === "sink" ? 0.3 : r / 2} fill={white} stroke={ink} strokeWidth={sw} /><ellipse cx={w / 2} cy={h / 2} rx={w * 0.3} ry={h * 0.28} fill={water} /></g>;
    case "toilet":
      return <g><rect x={0.1 * w} y={0} width={0.8 * w} height={0.3 * h} rx={0.15} fill={white} stroke={ink} strokeWidth={sw} /><ellipse cx={w / 2} cy={0.65 * h} rx={0.45 * w} ry={0.33 * h} fill={white} stroke={ink} strokeWidth={sw} /></g>;
    case "shower":
      return <g><rect x={0} y={0} width={w} height={h} fill={water} stroke={ink} strokeWidth={sw} /><path d={`M0 0 L${w} ${h} M${w} 0 L0 ${h}`} stroke={ink} strokeWidth={sw * 0.6} /></g>;
    case "counter": case "stool":
      return <rect x={0} y={0} width={w} height={h} rx={0.3} fill={wood} stroke={ink} strokeWidth={sw} />;
    case "hood":
      return <g><rect x={0} y={0} width={w} height={h} fill="#d9dde2" stroke={ink} strokeWidth={sw} /><path d={`M0 ${h / 2} H${w} M${w / 3} 0 V${h} M${(2 * w) / 3} 0 V${h}`} stroke={ink} strokeWidth={sw * 0.6} /></g>;
  }
}
