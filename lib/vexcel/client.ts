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

export async function vexcelImage(lat: number, lon: number, view: VexcelView, fetchFn: typeof fetch = fetch): Promise<Buffer | null> {
  const file = path.join(dataDir(), "vexcel", `${lat.toFixed(5)}_${lon.toFixed(5)}_${view}.jpg`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const key = apiKey();
  if (!key) return null;
  const { path: p, body } = request(lat, lon, view);
  try {
    const res = await fetchFn(`${API}/${p}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": key }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return buf;
  } catch {
    return null;
  }
}
