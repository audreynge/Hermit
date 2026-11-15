import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../paths";

const API = "https://api.vexcelgroup.com/v2";
export const VEXCEL_VIEWS = ["ortho", "oblique-north", "oblique-east", "oblique-south", "oblique-west"] as const;
export type VexcelView = (typeof VEXCEL_VIEWS)[number];
export const isVexcelView = (v: string): v is VexcelView => (VEXCEL_VIEWS as readonly string[]).includes(v);

const apiKey = () => (process.env.VEXCEL_API_KEY ?? process.env.VEXCELAPIKEY)?.trim();

// Obliques exist only on the "urban" layer; ortho asks for every layer so Vexcel picks the best one.
function request(lat: number, lon: number, view: VexcelView) {
  const base = { wkt: `POINT(${lon} ${lat})`, srid: 4326, "buffer-meter": 40, "image-format": "jpeg", "destination-dimensions": "800,800" };
  return view === "ortho"
    ? { path: "ortho/extract", body: { ...base, layer: "urban,urban-r,wide-area,urban-g", crop: "bounding_box" } }
    : { path: "oriented/extract", body: { ...base, layer: "urban", "product-type": view, rotation: "natural", crop: "bbox" } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// `retries` (default 0, so live routes stay fast) re-tries 429s, 5xx and network errors with backoff; the pipeline uses it.
export async function vexcelImage(lat: number, lon: number, view: VexcelView, fetchFn: typeof fetch = fetch, opts: { retries?: number; backoffMs?: number } = {}): Promise<Buffer | null> {
  const name = `${lat.toFixed(5)}_${lon.toFixed(5)}_${view}.jpg`;
  // The deploy bundle is read-only on Vercel, so fetched images are cached in /tmp there.
  const cached = [path.join(dataDir(), "vexcel", name), path.join(process.env.VERCEL ? "/tmp" : dataDir(), "vexcel", name)].find((f) => fs.existsSync(f));
  if (cached) return fs.readFileSync(cached);
  const file = path.join(process.env.VERCEL ? "/tmp" : dataDir(), "vexcel", name);
  const key = apiKey();
  if (!key) return null;
  const { path: p, body } = request(lat, lon, view);
  const retries = opts.retries ?? 0;
  for (let i = 0; i <= retries; i++) {
    if (i) await sleep((opts.backoffMs ?? 2000) * 2 ** (i - 1));
    try {
      const res = await fetchFn(`${API}/${p}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": key }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status >= 500) continue;
      if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
      } catch {} // caching is best-effort; never discard an image we already have
      return buf;
    } catch {
      // network error or timeout: retry if allowed
    }
  }
  return null;
}
