import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { dataDir } from "../paths";
import type { PanoCheck, RoomGraph } from "../types";
import { loadPanoChecks } from "./pano";
import { VISION_SCHEMA, WALL_FACES, cropRect, mapPanosToRooms, parseVision, pickPanos, slug, upsertChecks, visionPrompt, type PanoPos } from "./decide";

// "Hermit looked closer": downloads real Matterport panorama photos of one room and asks a vision model whether
// each feature is visible. Results go to data/processed/panos/<sid>/checks.json (read by lib/vision/pano.ts).
// Signed skybox URLs expire, so they are never stored; image bytes are downloaded right away.

const GRAPH = "https://api.matterport.com/api/models/graph";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const PANO_QUERY = `query($id: ID!) { model(id: $id) { panoLocations { id position { x y z } skyboxes { resolution status children } } } }`;
const visionModel = () => process.env.GEMINI_VISION_MODEL?.trim() || "gemini-3.8-flash";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with retry on 429/5xx and network errors (exponential backoff). */
async function fetchRetry(url: string, init: RequestInit = {}, tries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
      if ((res.status === 429 || res.status >= 500) && i < tries - 1) { await sleep(1500 * 2 ** i); continue; }
      return res;
    } catch (e) {
      if (i >= tries - 1) throw e;
      await sleep(1500 * 2 ** i);
    }
  }
}

type PanoWithFaces = PanoPos & { faces: string[] }; // faces = 6 signed 2k cube-face URLs (short-lived; never persisted)

// Signed URLs last about an hour; reuse one model fetch for 20 minutes.
const panoCache = new Map<string, { at: number; panos: PanoWithFaces[] }>();

async function fetchPanos(sid: string): Promise<PanoWithFaces[]> {
  const hit = panoCache.get(sid);
  if (hit && Date.now() - hit.at < 20 * 60_000) return hit.panos;
  const key = process.env.MATTERPORTAPIKEY?.trim(), token = process.env.MATTERPORTAPITOKEN?.trim();
  if (!key || !token) throw new Error("MATTERPORTAPIKEY / MATTERPORTAPITOKEN not set");
  const res = await fetchRetry(GRAPH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${key}:${token}`).toString("base64") },
    body: JSON.stringify({ query: PANO_QUERY, variables: { id: sid } }),
  });
  const body = await res.json().catch(() => ({}));
  const locs = body?.data?.model?.panoLocations;
  if (!Array.isArray(locs)) throw new Error(`${sid}: Matterport ${res.status} ${String(body?.errors?.[0]?.message ?? body?.message ?? "").slice(0, 120)}`);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const panos: PanoWithFaces[] = locs
    .filter((p: any) => p?.position && Number.isFinite(p.position.x) && Number.isFinite(p.position.y))
    .map((p: any) => {
      const sb = (p.skyboxes ?? []).find((s: any) => s.resolution === "2k" && s.status === "available" && s.children?.length === 6);
      return { id: p.id, x: p.position.x, y: p.position.y, faces: sb?.children ?? [] };
    });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  panoCache.set(sid, { at: Date.now(), panos });
  return panos;
}

function loadGraph(sid: string): RoomGraph | null {
  const file = path.join(dataDir(), "roomgraphs", `${sid}.json`);
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as RoomGraph) : null;
  } catch {
    return null;
  }
}

/** Room id → panos (id and floor-plane position, metres) taken inside that room, by point-in-polygon. */
export async function panosByRoom(sid: string): Promise<Record<string, PanoPos[]>> {
  const g = loadGraph(sid);
  if (!g) return {};
  const panos = await fetchPanos(sid);
  return mapPanosToRooms(g.rooms, panos.map(({ id, x, y }) => ({ id, x, y }))).byRoom;
}

/** Same mapping plus the share of panos that landed in a room, for pipeline reporting. */
export async function panoHitRate(sid: string): Promise<{ mapped: number; total: number }> {
  const g = loadGraph(sid);
  if (!g) return { mapped: 0, total: 0 };
  const panos = await fetchPanos(sid);
  const { unmapped } = mapPanosToRooms(g.rooms, panos);
  return { mapped: panos.length - unmapped.length, total: panos.length };
}

async function download(url: string): Promise<Buffer> {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`skybox ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function askGemini(prompt: string, images: Buffer[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const parts = [
    ...images.flatMap((b, i) => [{ text: `Photo ${i}:` }, { inlineData: { mimeType: "image/jpeg", data: b.toString("base64") } }]),
    { text: prompt },
  ];
  const res = await fetchRetry(`${GEMINI}/${visionModel()}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: VISION_SCHEMA },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${String(j?.error?.message ?? "").slice(0, 160)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join("");
}

function saveChecks(sid: string, fresh: PanoCheck[]) {
  const dir = path.join(dataDir(), "panos", sid);
  fs.mkdirSync(dir, { recursive: true });
  // Synchronous read-modify-write, so concurrent checkRoom calls in one process can't interleave.
  fs.writeFileSync(path.join(dir, "checks.json"), JSON.stringify(upsertChecks(loadPanoChecks(sid), fresh), null, 1));
}

/**
 * Looks at up to 2 panoramas inside the room (nearest its centroid), 4 wall faces each, and asks the vision model
 * about every feature in ONE call. Saves a cropped photo for each "seen" answer and upserts checks.json.
 */
export async function checkRoom(sid: string, roomId: string, features: string[]): Promise<PanoCheck[]> {
  if (!/^[A-Za-z0-9]+$/.test(sid) || !/^[A-Za-z0-9_-]+$/.test(roomId)) throw new Error("bad sid or room id");
  const g = loadGraph(sid);
  const room = g?.rooms.find((r) => r.id === roomId);
  if (!g || !room) throw new Error(`${sid}: no room graph or room ${roomId}`);
  const retrieved = new Date().toISOString();
  const model = visionModel();
  const base = { sid, roomId, model, retrieved };

  const all = await fetchPanos(sid);
  const { byRoom } = mapPanosToRooms(g.rooms, all);
  const chosen = pickPanos(room.polygon, byRoom[roomId] ?? []).map((p) => all.find((a) => a.id === p.id)!).filter((p) => p.faces.length === 6);
  if (!chosen.length) {
    const out = features.map((feature): PanoCheck => ({ ...base, feature, result: "unclear", confidence: 0.3, note: "No scan photo was taken inside this room." }));
    saveChecks(sid, out);
    return out;
  }

  // Each photo: one wall face of one pano. Keep the 2k original for cropping, send a ≤1024 px copy to the model.
  const photos: { panoId: string; face: number; full: Buffer }[] = [];
  for (const p of chosen) for (const face of WALL_FACES) photos.push({ panoId: p.id, face, full: await download(p.faces[face]) });
  const small = await Promise.all(photos.map((ph) => sharp(ph.full).resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()));

  const text = await askGemini(visionPrompt(features, room.rawTags?.[0] ?? room.label, photos.length), small);
  const decided = parseVision(text, features, photos.length);

  const dir = path.join(dataDir(), "panos", sid);
  fs.mkdirSync(dir, { recursive: true });
  const out: PanoCheck[] = [];
  for (const d of decided) {
    const ph = d.image !== null ? photos[d.image] : undefined;
    const check: PanoCheck = { ...base, feature: d.feature, result: d.result, confidence: d.confidence, note: d.note, ...(ph ? { panoId: ph.panoId, face: ph.face } : {}) };
    if (ph) {
      // "seen": crop around the box. Otherwise keep the whole wall photo the model pointed at, so every answer has its photo.
      const file = `${roomId}-${slug(d.feature)}.jpg`;
      let img = sharp(ph.full);
      if (d.result === "seen" && d.box) {
        const meta = await sharp(ph.full).metadata();
        img = img.extract(cropRect(d.box, meta.width ?? 2048, meta.height ?? 2048));
      }
      await img.resize(800, 800, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(dir, file));
      check.image = `panos/${sid}/${file}`;
    }
    out.push(check);
  }
  saveChecks(sid, out);
  return out;
}
