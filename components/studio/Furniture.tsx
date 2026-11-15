import type { FurnType } from "@/lib/spec/furnish";
import { FurnArt } from "./FurnArt";
import { ObjectArt } from "./ObjectArt";

// The illustrated objects from the original layout studio, with top-down glyphs for pieces it never drew.
const OLD: Partial<Record<FurnType, string>> = { chair: "chair", desk: "desk", table: "table", plant: "plant", "reception desk": "reception desk", "exam table": "exam bed", shelf: "shelf", counter: "counter", stool: "stool", sink: "sink" };

export function Furniture({ type, w, h }: { type: FurnType; w: number; h: number }) {
  const old = OLD[type];
  return old ? <ObjectArt type={old} w={w} h={h} /> : <FurnArt type={type} w={w} h={h} />;
}
