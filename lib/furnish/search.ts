// 3D model lookup on Sketchfab (realistic, heavier) and Poly Pizza (low-poly; free plan 3,000 calls/month).
// Each source's raw results are cached in the DB per query for 30 days, misses included; concurrent identical
// queries share one request; errors are not cached.
import { getCached, putCached } from "../regs/cache";
import { matchesTerms, normName, type Size } from "./catalog";
import { fitModel } from "./fit";
import { glbBounds, glbHeaderLength, type Bounds } from "./glb";
import type { Model } from "./ops";

const CACHE_DAYS = 30;
const MAX_TRIS = 60_000; // keep the tour smooth
const MAX_GLB_BYTES = 8_000_000;
const inflight = new Map<string, Promise<unknown[] | null>>();
let calls = 0;

/** Cached, de-duplicated upstream query. `null` = source unavailable (no key or error). */
async function cachedQuery<T>(key: string, run: () => Promise<T[]>): Promise<T[] | null> {
  const hit = await getCached<T[]>(key);
  if (hit) return hit;
  let p = inflight.get(key);
  if (!p) {
    p = run().then(async (r) => { await putCached(key, r, CACHE_DAYS); return r; })
      .catch((e) => { console.warn(`[hermit] ${key} failed (${e instanceof Error ? e.message : e})`); return null; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p as Promise<T[] | null>;
}

// --- Poly Pizza
type PolyResult = { ID: string; Title: string; Thumbnail: string; Download: string; Licence: string; Attribution: string; Animated?: boolean; "Tri Count"?: number };
async function polyPizza(q: string, fetchFn: typeof fetch): Promise<PolyResult[] | null> {
  const apiKey = process.env.POLYPIZZA_API_KEY?.trim();
  if (!apiKey) return null;
  return cachedQuery<PolyResult>(`polypizza:${q}`, async () => {
    console.info(`[hermit] poly.pizza request #${++calls}: "${q}"`);
    const res = await fetchFn(`https://api.poly.pizza/v1/search/${encodeURIComponent(q)}?Limit=24`, { headers: { "x-auth-token": apiKey }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`poly.pizza ${res.status}`);
    return ((await res.json()) as { results?: PolyResult[] }).results ?? [];
  });
}
const fromPoly = (r: PolyResult): Model => ({ id: r.ID, source: "polypizza", url: r.Download, title: r.Title, thumb: r.Thumbnail, licence: r.Licence, attribution: r.Attribution });
const polyOk = (r: PolyResult, terms: string[]) => !r.Animated && (r["Tri Count"] ?? 0) <= MAX_TRIS && r.Download.endsWith(".glb") && matchesTerms(r.Title, terms);

// --- Sketchfab (search is public; downloads use the API key, see sketchfabDownloadUrl)
type SfResult = { uid: string; name: string; viewerUrl: string; faceCount: number; animationCount: number; license: { label: string } | null; user: { displayName?: string; username: string }; thumbnails: { images: { width: number; url: string }[] }; archives?: { glb?: { size?: number } } };
// Recoloring modifies a model, so NoDerivs is out; NonCommercial is out for a product demo.
const SF_LICENCES = new Set(["CC0 Public Domain", "CC Attribution", "CC Attribution-ShareAlike"]);
async function sketchfab(q: string, fetchFn: typeof fetch): Promise<SfResult[] | null> {
  if (!process.env.SKETCHFAB_API_KEY?.trim()) return null; // no key → results couldn't be downloaded anyway
  return cachedQuery<SfResult>(`sketchfab:${q}`, async () => {
    console.info(`[hermit] sketchfab search: "${q}"`);
    const res = await fetchFn(`https://api.sketchfab.com/v3/search?type=models&downloadable=true&count=24&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`sketchfab ${res.status}`);
    // Keep only the fields we use, so the cache row stays small.
    return (((await res.json()) as { results?: SfResult[] }).results ?? []).map((r) => ({
      uid: r.uid, name: r.name, viewerUrl: r.viewerUrl, faceCount: r.faceCount, animationCount: r.animationCount, license: r.license ? { label: r.license.label } : null,
      user: { displayName: r.user?.displayName, username: r.user?.username }, thumbnails: { images: (r.thumbnails?.images ?? []).filter((i) => i.width <= 256 && i.width >= 200).slice(0, 1) },
      archives: { glb: { size: r.archives?.glb?.size } },
    }));
  });
}
const sfOk = (r: SfResult, terms: string[]) => !r.animationCount && r.faceCount <= MAX_TRIS && (r.archives?.glb?.size ?? Infinity) <= MAX_GLB_BYTES && SF_LICENCES.has(r.license?.label ?? "") && matchesTerms(r.name, terms);
const fromSf = (r: SfResult): Model => ({
  id: `sf-${r.uid}`, source: "sketchfab", url: `/api/furniture/model/sketchfab/${r.uid}`, title: r.name, thumb: r.thumbnails.images[0]?.url ?? "",
  licence: r.license!.label, attribution: `"${r.name}" by ${r.user.displayName || r.user.username}, ${r.viewerUrl}. Licence: ${r.license!.label}`,
});

// Category words match almost any title ("Furniture Set"), so terms made only of them are skipped.
const VAGUE = new Set(["furniture", "equipment", "appliance", "item", "object", "decor", "kitchen", "living", "room", "home", "office", "restaurant", "salon", "cooking"]);
const specific = (t: string) => normName(t).split(" ").some((w) => !VAGUE.has(w));

/** Up to `limit` models whose titles match one of the terms: Sketchfab first, then Poly Pizza. Stops at the first term with matches. */
export async function searchModels(raw: string[], limit = 5, fetchFn: typeof fetch = fetch): Promise<Model[]> {
  const terms = raw.filter(specific);
  for (const term of terms.slice(0, 3)) {
    const q = normName(term);
    const [sf, poly] = await Promise.all([sketchfab(q, fetchFn), polyPizza(q, fetchFn)]);
    const found = [...(sf ?? []).filter((r) => sfOk(r, terms)).map(fromSf), ...(poly ?? []).filter((r) => polyOk(r, terms)).map(fromPoly)];
    if (found.length) return found.slice(0, limit);
  }
  return [];
}

// Signed download links expire after 300 s; reuse one for up to 4 minutes.
const SIGNED_TTL_MS = 240_000;
const signed = new Map<string, { url: string; until: number }>();
const signing = new Map<string, Promise<string | null>>();
let blockedUntil = 0; // Sketchfab rate-limited us (429): don't ask again until then
const BACKOFF_MS = 60_000;
/** A fresh signed GLB URL for a Sketchfab model, or null if it can't be downloaded. */
export async function sketchfabDownloadUrl(uid: string, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<string | null> {
  const key = process.env.SKETCHFAB_API_KEY?.trim();
  if (!key || !/^[0-9a-f]{32}$/.test(uid)) return null;
  const hit = signed.get(uid);
  if (hit && hit.until > now) return hit.url;
  if (now < blockedUntil) return null;
  let p = signing.get(uid);
  if (!p) {
    p = (async () => {
      const res = await fetchFn(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${key}` }, signal: AbortSignal.timeout(8000) });
      if (res.status === 429) blockedUntil = now + BACKOFF_MS;
      if (!res.ok) throw new Error(`sketchfab download ${res.status}`);
      const url = ((await res.json()) as { glb?: { url?: string } }).glb?.url;
      if (url) signed.set(uid, { url, until: now + SIGNED_TTL_MS });
      return url ?? null;
    })().catch((e) => { console.warn(`[hermit] ${e instanceof Error ? e.message : e}`); return null; }).finally(() => signing.delete(uid));
    signing.set(uid, p);
  }
  return p;
}

// --- Model dimensions from the GLB header (range request; the glTF JSON chunk comes first in the file)
const HEAD_BYTES = 262_144;
async function fetchHead(url: string, fetchFn: typeof fetch): Promise<Uint8Array | null> {
  const get = async (end: number) => {
    const res = await fetchFn(url, { headers: { Range: `bytes=0-${end}` }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  };
  let bytes = await get(HEAD_BYTES - 1);
  const need = bytes && glbHeaderLength(bytes);
  if (!bytes || !need) return null;
  if (bytes.byteLength < need) bytes = need <= MAX_GLB_BYTES ? await get(need - 1) : null;
  return bytes;
}

/** A model's bounds in its own units, read from its file header and cached per model (misses for a day). */
export async function modelBounds(m: Model, fetchFn: typeof fetch = fetch): Promise<Bounds | null> {
  const key = `glbbounds:${m.id}`;
  const hit = await getCached<{ bounds: Bounds | null }>(key);
  if (hit) return hit.bounds;
  const url = m.source === "sketchfab" ? await sketchfabDownloadUrl(m.id.replace(/^sf-/, ""), fetchFn) : m.url;
  if (!url) return null; // couldn't sign a download right now: try again next time
  const bounds = await fetchHead(url, fetchFn).then((b) => (b ? glbBounds(b) : null)).catch(() => null);
  await putCached(key, { bounds }, bounds ? 365 : 1);
  return bounds;
}

/** Measures the top candidates and orders them by how well their proportions fit the item; clear misfits go last. */
// Measuring a Sketchfab model costs a download-API call (rate-limited and shared with actual loads), so only the first
// few are measured; Poly Pizza files are static and cheap. Unmeasured models are fitted in the browser after loading.
const SKETCHFAB_MEASURE = 2;
export async function rankModels(models: Model[], size: Size | null, fetchFn: typeof fetch = fetch, measure = 6): Promise<Model[]> {
  let sf = 0;
  const measured = await Promise.all(models.map(async (m, i) => {
    if (i >= measure || (m.source === "sketchfab" && sf++ >= SKETCHFAB_MEASURE)) return m;
    return { ...m, bounds: (await modelBounds(m, fetchFn)) ?? undefined };
  }));
  if (!size) return measured;
  const err = (m: Model) => (m.bounds ? fitModel(m.bounds, size)?.error ?? 9 : 0.6); // unmeasured: after good fits, before misfits
  const misfit = (e: number) => (e > 0.69 ? 1 : 0); // footprint off by more than 2×
  return measured.map((m, i) => ({ m, i, e: err(m) })).sort((a, b) => misfit(a.e) - misfit(b.e) || a.e - b.e || a.i - b.i).map((x) => x.m);
}
