import fs from "node:fs";
import path from "node:path";
import { matterportImageUrl } from "@/lib/matterport";
import { dataDir, isSafeId } from "@/lib/query/load";

const jpeg = (buf: Buffer) => new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });

// Scan and site images:
// - ?kind=floorplan: Matterport's floor plan render
// - ?kind=aerial: the cached Vexcel ortho the parking count was made on (pipeline/aerial.ts)
// - ?kind=pano&f=<file>.jpg: a cropped scan photo from a "looked closer" check (pipeline/panos.ts)
// - otherwise the preview thumbnail
// Served from the local cache when present; floor plans and thumbnails otherwise redirect to a fresh signed
// Matterport CDN URL, which is how deployed instances get them since the cache is not deployed.
export async function GET(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const q = new URL(req.url).searchParams;
  const k = q.get("kind");
  if (!isSafeId(sid)) return new Response("not found", { status: 404 });
  if (k === "aerial" || k === "pano") {
    const f = q.get("f") ?? "";
    if (k === "pano" && !/^[A-Za-z0-9_-]{1,80}\.jpg$/.test(f)) return new Response("not found", { status: 404 });
    const file = k === "aerial" ? path.join(dataDir(), "aerial", `${sid}.jpg`) : path.join(dataDir(), "panos", sid, f);
    return fs.existsSync(file) ? jpeg(fs.readFileSync(file)) : new Response("not found", { status: 404 });
  }
  const kind = k === "floorplan" ? "floorplan" : "thumb";
  const file = kind === "floorplan" ? path.join(dataDir(), "assets", "floorplans", `${sid}.jpg`) : path.join(dataDir(), "thumbs", `${sid}.jpg`);
  if (fs.existsSync(file)) return jpeg(fs.readFileSync(file));
  const url = await matterportImageUrl(sid, kind);
  if (!url) return new Response("not found", { status: 404 });
  // Shorter than the signed URL's lifetime so a cached redirect never points at an expired link.
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=1800" } });
}
