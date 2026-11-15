import fs from "node:fs";
import path from "node:path";
import { matterportImageUrl } from "@/lib/matterport";
import { dataDir, isSafeId } from "@/lib/query/load";

const HEADERS = { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" };
const jpeg = (buf: Buffer) => new Response(new Uint8Array(buf), { headers: HEADERS });

// The private Supabase Storage bucket pipeline/upload-assets.ts fills with the demo runs' images. Read server-side
// with the secret key; the project URL comes from SUPABASE_URL or the project ref in DATABASE_URL.
const BUCKET = "hermit-assets";
function storageBase(): string | null {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL.replace(/\/+$/, "");
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    const ref = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1] ?? decodeURIComponent(u.username).match(/^postgres\.([a-z0-9]+)$/)?.[1];
    return ref ? `https://${ref}.supabase.co` : null;
  } catch {
    return null;
  }
}
async function fromStorage(object: string): Promise<Response | null> {
  const base = storageBase(), key = process.env.SECRET_KEY?.trim();
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/storage/v1/object/authenticated/${BUCKET}/${object}`, {
      headers: key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key },
      signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (!res.ok || !res.body) return null;
    return new Response(res.body, { headers: HEADERS });
  } catch {
    return null;
  }
}

// Scan and site images:
// - ?kind=floorplan: Matterport's floor plan render
// - ?kind=aerial: the cached Vexcel ortho the parking count was made on (pipeline/aerial.ts)
// - ?kind=pano&f=<file>.jpg: a cropped scan photo from a "looked closer" check (pipeline/panos.ts)
// - otherwise the preview thumbnail
// Served from the local cache when present. Otherwise floor plans and thumbnails redirect to a fresh signed
// Matterport CDN URL, and aerials, pano crops and floor plans Matterport can't give come from the private Storage
// copy, which is how deployed instances get them since the cache is not deployed.
export async function GET(req: Request, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const q = new URL(req.url).searchParams;
  const k = q.get("kind");
  if (!isSafeId(sid)) return new Response("not found", { status: 404 });
  if (k === "aerial" || k === "pano") {
    const f = q.get("f") ?? "";
    if (k === "pano" && !/^[A-Za-z0-9_-]{1,80}\.jpg$/.test(f)) return new Response("not found", { status: 404 });
    const file = k === "aerial" ? path.join(dataDir(), "aerial", `${sid}.jpg`) : path.join(dataDir(), "panos", sid, f);
    if (fs.existsSync(file)) return jpeg(fs.readFileSync(file));
    return (await fromStorage(k === "aerial" ? `aerial/${sid}.jpg` : `panos/${sid}/${f}`)) ?? new Response("not found", { status: 404 });
  }
  const kind = k === "floorplan" ? "floorplan" : "thumb";
  const file = kind === "floorplan" ? path.join(dataDir(), "assets", "floorplans", `${sid}.jpg`) : path.join(dataDir(), "thumbs", `${sid}.jpg`);
  if (fs.existsSync(file)) return jpeg(fs.readFileSync(file));
  const url = await matterportImageUrl(sid, kind);
  if (!url) return (kind === "floorplan" ? await fromStorage(`floorplans/${sid}.jpg`) : null) ?? new Response("not found", { status: 404 });
  // Shorter than the signed URL's lifetime so a cached redirect never points at an expired link.
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, max-age=1800" } });
}
