// Small illustrated fixtures drawn in a w×h box (feet on the canvas, px in the palette).
export function ObjectArt({ type, w, h }: { type: string; w: number; h: number }) {
  const s = Math.min(w, h);
  const stroke = "#6b4a3a", sw = s * 0.07, coral = "#f58a6b", wood = "#f6dcc4";
  switch (type) {
    case "chair":
      return <g><rect x={w * 0.15} y={h * 0.1} width={w * 0.7} height={h * 0.55} rx={s * 0.2} fill={coral} stroke={stroke} strokeWidth={sw} /><rect x={w * 0.1} y={h * 0.55} width={w * 0.8} height={h * 0.18} rx={s * 0.08} fill={coral} stroke={stroke} strokeWidth={sw} /><path d={`M${w * 0.22} ${h * 0.73} v${h * 0.22} M${w * 0.78} ${h * 0.73} v${h * 0.22}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "stool":
      return <g><ellipse cx={w / 2} cy={h * 0.25} rx={w * 0.35} ry={h * 0.13} fill="#fff" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} ${h * 0.35} V${h * 0.8} M${w * 0.2} ${h * 0.9} L${w / 2} ${h * 0.8} L${w * 0.8} ${h * 0.9}`} stroke={stroke} strokeWidth={sw} fill="none" /></g>;
    case "table":
      return <g><rect x={0} y={h * 0.15} width={w} height={h * 0.25} rx={s * 0.08} fill={wood} stroke={stroke} strokeWidth={sw} /><path d={`M${w * 0.12} ${h * 0.4} V${h * 0.95} M${w * 0.88} ${h * 0.4} V${h * 0.95}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "desk":
    case "reception desk":
      return <g><rect x={0} y={h * 0.35} width={w} height={h * 0.6} rx={s * 0.2} fill="#fde9d6" stroke={stroke} strokeWidth={sw} /><rect x={w * 0.35} y={h * 0.02} width={w * 0.3} height={h * 0.3} rx={s * 0.04} fill="#7a7a86" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} ${h * 0.32} v${h * 0.06}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "sink":
      return <g><rect x={w * 0.05} y={h * 0.3} width={w * 0.9} height={h * 0.62} rx={s * 0.12} fill="#e9eef2" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} ${h * 0.3} V${h * 0.08} H${w * 0.68}`} stroke={stroke} strokeWidth={sw} fill="none" /><path d={`M${w * 0.3} ${h * 0.55} H${w * 0.7}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "counter":
    case "kitchenette":
      return <g><rect x={0} y={0} width={w} height={h} rx={s * 0.12} fill="#fdeee2" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 3} 0 V${h} M${(2 * w) / 3} 0 V${h}`} stroke={stroke} strokeWidth={sw * 0.7} />{type === "kitchenette" && <circle cx={w / 6} cy={h / 2} r={s * 0.22} fill="#e9eef2" stroke={stroke} strokeWidth={sw * 0.7} />}</g>;
    case "door":
      return w > h * 1.6
        ? <g fill="#fff" stroke={stroke} strokeWidth={sw}><path d={`M0 ${h} V0 A${w / 2} ${h} 0 0 1 ${w / 2} ${h} Z`} /><path d={`M${w} ${h} V0 A${w / 2} ${h} 0 0 0 ${w / 2} ${h} Z`} /></g>
        : <path d={`M0 ${h} H${w} M0 ${h} V0 A${w} ${h} 0 0 1 ${w} ${h}`} fill="#fff" stroke={stroke} strokeWidth={sw} />;
    case "window":
      return <g><rect x={0} y={0} width={w} height={h} fill="#dff3fb" stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} 0 V${h} M0 ${h / 2} H${w}`} stroke={stroke} strokeWidth={sw * 0.7} /></g>;
    case "plant":
      return <g><path d={`M${w * 0.25} ${h * 0.6} H${w * 0.75} L${w * 0.68} ${h} H${w * 0.32} Z`} fill={wood} stroke={stroke} strokeWidth={sw} /><path d={`M${w / 2} ${h * 0.6} C${w * 0.1} ${h * 0.45} ${w * 0.1} ${h * 0.15} ${w * 0.35} ${h * 0.05} C${w * 0.4} ${h * 0.3} ${w * 0.45} ${h * 0.45} ${w / 2} ${h * 0.6} C${w * 0.6} ${h * 0.3} ${w * 0.7} ${h * 0.1} ${w * 0.9} ${h * 0.12} C${w * 0.9} ${h * 0.4} ${w * 0.7} ${h * 0.55} ${w / 2} ${h * 0.6}`} fill="#7cc576" stroke="#4f8f4a" strokeWidth={sw * 0.6} /></g>;
    case "exam bed":
      return <g><rect x={0} y={h * 0.25} width={w} height={h * 0.35} rx={s * 0.12} fill="#fff" stroke={stroke} strokeWidth={sw} /><path d={`M${w * 0.02} ${h * 0.3} L${w * 0.3} ${h * 0.02} L${w * 0.36} ${h * 0.28}`} fill="#8ecae6" stroke={stroke} strokeWidth={sw} /><path d={`M${w * 0.1} ${h * 0.6} V${h} M${w * 0.9} ${h * 0.6} V${h}`} stroke={stroke} strokeWidth={sw} /></g>;
    case "shelf":
      return <g fill="none" stroke={stroke} strokeWidth={sw * 0.6}><rect x={0} y={0} width={w} height={h} fill="#fff7ef" /><path d={`M0 ${h / 3} H${w} M0 ${(2 * h) / 3} H${w}`} /><rect x={w * 0.15} y={h * 0.1} width={w * 0.45} height={h * 0.2} fill="#f4c7a1" /><rect x={w * 0.1} y={h * 0.43} width={w * 0.35} height={h * 0.2} fill="#f4c7a1" /><rect x={w * 0.52} y={h * 0.43} width={w * 0.35} height={h * 0.2} fill="#f4c7a1" /></g>;
    default:
      return <g fill={stroke}>{[0.25, 0.5, 0.75].map((f) => <circle key={f} cx={w * f} cy={h / 2} r={s * 0.07} />)}</g>;
  }
}
