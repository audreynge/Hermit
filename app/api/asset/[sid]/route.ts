import fs from "node:fs";
import path from "node:path";
import { matterportImageUrl } from "@/lib/matterport";
import { dataDir, isSafeId } from "@/lib/query/load";

// Scan images: ?kind=floorplan is Matterport's floor plan render, otherwise the preview thumbnail.
// Served from the local cache when present (dev, pipeline output); otherwise redirected to a fresh signed
// Matterport CDN URL, which is how deployed instances get them since the cache is not deployed.
export async function GET(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const kind = new URL(req.url).searchParams.get("kind") === "floorplan" ? "floorplan" : "thumb";
  if (!isSafeId(sid)) return new Response("not found", { status: 404 });
  const file = kind === "floorplan" ? path.join(dataDir(), "assets", "floorplans", `${sid}.jpg`) : path.join(dataDir(), "thumbs", `${sid}.jpg`);
  if (fs.existsSync(file)) return new Response(fs.readFileSync(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  const url = await matterportImageUrl(sid, kind);
  if (!url) return new Response("not found", { status: 404 });
  // Shorter than the signed URL's lifetime so a cached redirect never points at an expired link.
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=1800" } });
}
