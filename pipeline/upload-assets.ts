// Uploads the images the demo runs show (aerial photos, looked-closer pano crops, floor plans) to a PRIVATE
// Supabase Storage bucket, so the deployed site can serve them through /api/asset without the local cache.
// Only the shells in the recorded replays: every report shell, plus every shell any priya* replay mentions.
// Idempotent: objects already in the bucket are skipped. Server-side only; the secret key never leaves this process.
// Run: npx tsx --env-file=.env pipeline/upload-assets.ts [--dry]
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../lib/paths";
import { getShell } from "../lib/query/load";
import type { TraceEvent } from "../lib/types";

export const BUCKET = "hermit-assets";

// https://<ref>.supabase.co, from SUPABASE_URL or the project ref in DATABASE_URL (db.<ref>.supabase.co or pooler user postgres.<ref>).
export function storageBase(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SUPABASE_URL) return env.SUPABASE_URL.replace(/\/+$/, "");
  try {
    const u = new URL(env.DATABASE_URL ?? "");
    const ref = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1] ?? decodeURIComponent(u.username).match(/^postgres\.([a-z0-9]+)$/)?.[1];
    return ref ? `https://${ref}.supabase.co` : null;
  } catch {
    return null;
  }
}
// New sb_secret_ keys go in apikey only; legacy JWT service keys also as the bearer token.
export const storageHeaders = (key: string): Record<string, string> => (key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key });

function demoSids(dir: string): string[] {
  const ids = new Set<string>();
  const replay = path.join(dir, "replay");
  for (const f of fs.readdirSync(replay).filter((f) => f.endsWith(".json"))) {
    const events = (JSON.parse(fs.readFileSync(path.join(replay, f), "utf8")).events ?? []) as TraceEvent[];
    for (const e of events) {
      if (e.type === "report") for (const r of e.reports) ids.add(r.shellId);
      if (f.startsWith("priya") && "shellId" in e && typeof e.shellId === "string") ids.add(e.shellId);
    }
  }
  return [...new Set([...ids].map((id) => getShell(id)?.sid ?? id))].filter((s) => /^[A-Za-z0-9_-]{1,40}$/.test(s)).sort();
}

async function main() {
  const dry = process.argv.includes("--dry");
  const base = storageBase();
  const key = process.env.SECRET_KEY?.trim();
  if (!base || !key) throw new Error("need DATABASE_URL (or SUPABASE_URL) and SECRET_KEY");
  const h = storageHeaders(key);
  const api = `${base}/storage/v1`;

  const b = await fetch(`${api}/bucket/${BUCKET}`, { headers: h });
  if (b.ok) {
    const info = (await b.json()) as { public?: boolean };
    if (info.public) throw new Error(`bucket ${BUCKET} is public; refusing to upload private data`);
  } else if (!dry) {
    const c = await fetch(`${api}/bucket`, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
    if (!c.ok) throw new Error(`create bucket failed: ${c.status} ${(await c.text()).slice(0, 200)}`);
    console.log(`created private bucket ${BUCKET}`);
  }

  const existing = async (prefix: string): Promise<Set<string>> => {
    const names = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const r = await fetch(`${api}/object/list/${BUCKET}`, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ prefix, limit: 1000, offset }) });
      if (!r.ok) return names;
      const page = (await r.json()) as { name: string }[];
      for (const o of page) names.add(o.name);
      if (page.length < 1000) return names;
    }
  };

  const dir = dataDir();
  const sids = demoSids(dir);
  const [haveAerial, haveFloor] = await Promise.all([existing("aerial"), existing("floorplans")]);
  type Job = { local: string; object: string; kind: "aerial" | "pano" | "floorplan" };
  const jobs: Job[] = [];
  const counts = { shells: sids.length, aerial: 0, pano: 0, floorplan: 0, skipped: 0, missingLocal: 0, failed: 0 };
  for (const sid of sids) {
    const a = path.join(dir, "aerial", `${sid}.jpg`);
    if (!fs.existsSync(a)) counts.missingLocal++;
    else if (haveAerial.has(`${sid}.jpg`)) counts.skipped++;
    else jobs.push({ local: a, object: `aerial/${sid}.jpg`, kind: "aerial" });
    const fp = path.join(dir, "assets", "floorplans", `${sid}.jpg`);
    if (!fs.existsSync(fp)) counts.missingLocal++;
    else if (haveFloor.has(`${sid}.jpg`)) counts.skipped++;
    else jobs.push({ local: fp, object: `floorplans/${sid}.jpg`, kind: "floorplan" });
    const pdir = path.join(dir, "panos", sid);
    if (fs.existsSync(pdir)) {
      const have = await existing(`panos/${sid}`);
      for (const f of fs.readdirSync(pdir).filter((f) => f.endsWith(".jpg"))) {
        if (have.has(f)) counts.skipped++;
        else jobs.push({ local: path.join(pdir, f), object: `panos/${sid}/${f}`, kind: "pano" });
      }
    }
  }
  console.log(`${sids.length} demo shells; ${jobs.length} files to upload, ${counts.skipped} already in the bucket${dry ? " (dry run)" : ""}`);
  if (dry) return;

  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const r = await fetch(`${api}/object/${BUCKET}/${j.object}`, {
        method: "POST", headers: { ...h, "Content-Type": "image/jpeg", "x-upsert": "false" }, body: new Uint8Array(fs.readFileSync(j.local)),
      }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as const);
      if (r.ok) counts[j.kind]++;
      else {
        const body = await r.text();
        if (/already exists|Duplicate/i.test(body)) counts.skipped++;
        else { counts.failed++; console.warn(`upload ${j.object} failed: ${r.status} ${body.slice(0, 160)}`); }
      }
    }
  }));
  console.log(`uploaded: ${counts.aerial} aerial, ${counts.pano} pano, ${counts.floorplan} floor plans; skipped ${counts.skipped} existing; ${counts.missingLocal} not cached locally; ${counts.failed} failed`);
}

if (process.argv[1]?.endsWith("upload-assets.ts")) await main();
