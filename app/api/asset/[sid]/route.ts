import fs from "node:fs";
import path from "node:path";
import { dataDir, isSafeId } from "@/lib/query/load";

// Cached scan assets: ?kind=floorplan serves Matterport's floor plan render (cached because signed URLs expire).
export async function GET(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const kind = new URL(req.url).searchParams.get("kind") === "floorplan" ? "floorplan" : "thumb";
  if (!isSafeId(sid)) return new Response("not found", { status: 404 });
  const file = kind === "floorplan" ? path.join(dataDir(), "assets", "floorplans", `${sid}.jpg`) : path.join(dataDir(), "thumbs", `${sid}.jpg`);
  if (!fs.existsSync(file)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
