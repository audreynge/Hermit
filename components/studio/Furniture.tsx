import { FURNITURE, type FurnType } from "@/lib/spec/furnish";
import { FurnArt } from "./FurnArt";
import { ObjectArt } from "./ObjectArt";

// The illustrated objects from the original layout studio, with top-down glyphs for pieces it never drew.
const OLD: Partial<Record<FurnType, string>> = { chair: "chair", desk: "desk", table: "table", plant: "plant", "reception desk": "reception desk", "exam table": "exam bed", shelf: "shelf", counter: "counter", stool: "stool", sink: "sink" };
const DRAWN = new Set<string>(FURNITURE.map((f) => f.type));

export function Furniture({ type, w, h }: { type: FurnType | string; w: number; h: number }) {
  const old = OLD[type as FurnType];
  if (old) return <ObjectArt type={old} w={w} h={h} />;
  if (DRAWN.has(type)) return <FurnArt type={type as FurnType} w={w} h={h} />;
  // Anything placed from the 3D tour with no 2D glyph ("noodle cooker"): a labeled box at its real footprint.
  const fs = Math.max(0.5, Math.min(1.1, Math.min(w, h) * 0.32));
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={0.2} fill="#fbfaf8" stroke="#5b3d33" strokeWidth={0.12} />
      <text x={w / 2} y={h / 2 + fs * 0.35} textAnchor="middle" fontSize={fs} fill="#5b3d33">{type.length > 14 ? `${type.slice(0, 13)}…` : type}</text>
    </g>
  );
}
