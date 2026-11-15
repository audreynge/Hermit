// Counts surface parking stalls and rooftop units on the Vexcel ortho for business and enterprise spaces and writes
// data/processed/aerial/<sid>.{jpg,json} (see lib/vexcel/count.ts). Resumable: spaces with a JSON already are skipped.
// Run: npx tsx pipeline/aerial.ts [--limit N] [--minutes M] [--dry-run]
// Needs VEXCELAPIKEY and GEMINI_API_KEY; DATABASE_URL (read-only) adds the Postgres catalog. Env comes from the process,
// else from ./.env or HERMIT_ENV_FILE (lines like `NAME =value`).
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { dataDir } from "../lib/paths";
import type { AerialCount, Shell } from "../lib/types";
import { countAerial } from "../lib/vexcel/count";

function loadEnv() {
  const file = [process.env.HERMIT_ENV_FILE, path.join(process.cwd(), ".env")].find((f) => f && fs.existsSync(f));
  if (!file) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m && !process.env[m[1]]?.trim()) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
}

type Cand = { sid: string; lat: number; lon: number; city?: string; kind?: string; mode?: string; text: string; prio: number };
const HEROES = ["x37LjPx62VA", "EK8LMNkDsv3"];
const MEDICAL_OFFICE = /medical|office|clinic/i;
const okSid = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9]+$/.test(s);
const hasLL = (s: Partial<Shell>) => typeof s.lat === "number" && typeof s.lon === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lon);

async function dbShells(): Promise<Shell[]> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) { console.warn("DATABASE_URL not set: using data/processed/shells.json only"); return []; }
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 20 });
  try {
    const rows = await sql`SELECT id, sid, json FROM shells WHERE mode IN ('business', 'enterprise')`;
    return rows.map((r) => ({ ...(typeof r.json === "string" ? JSON.parse(r.json) : r.json), id: r.id, sid: r.sid ?? undefined }) as Shell);
  } catch (e) {
    console.warn(`Postgres read failed (${(e as Error).message.slice(0, 120)}): using shells.json only`);
    return [];
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

function replayShellIds(dir: string): string[] {
  const ids: string[] = [];
  const rdir = path.join(dir, "replay");
  for (const f of fs.existsSync(rdir) ? fs.readdirSync(rdir).filter((f) => f.endsWith(".json")) : []) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(rdir, f), "utf8"));
      for (const e of r.events ?? []) if (e?.type === "report") for (const rep of e.reports ?? []) if (okSid(rep?.shellId)) ids.push(rep.shellId);
    } catch {}
  }
  return ids;
}

/** Merges both catalogs by sid (Postgres CoStar coordinates win; the scan index adds kind) and orders by priority. */
export function candidates(local: Partial<Shell>[], remote: Partial<Shell>[], first: string[]): Cand[] {
  const by = new Map<string, Partial<Shell>>();
  for (const s of local) { const k = s.sid ?? s.id; if (okSid(k) && (s.mode === "business" || s.mode === "enterprise")) by.set(k, s); }
  for (const s of remote) {
    const k = s.sid ?? s.id;
    if (!okSid(k) || (s.mode !== "business" && s.mode !== "enterprise")) continue;
    const prev = by.get(k);
    by.set(k, prev ? { ...prev, ...s, kind: prev.kind ?? s.kind, lat: hasLL(s) ? s.lat : prev.lat, lon: hasLL(s) ? s.lon : prev.lon } : s);
  }
  const head = new Set(first);
  const out: Cand[] = [];
  for (const [sid, s] of by) {
    if (!hasLL(s)) continue;
    const text = [s.name, s.propertyType, s.subtype].filter(Boolean).join(" ");
    const medOff = s.kind === "medical" || s.kind === "office" || MEDICAL_OFFICE.test(text);
    // (a) heroes and replay reports, (b) Houston medical/office, (c) LA medical/office, (d) the rest, real
    // commercial kinds before apartment amenities.
    const prio = head.has(sid) ? 0 : medOff && s.city === "houston" ? 1 : medOff ? 2 : s.kind === "amenity" ? 4 : 3;
    out.push({ sid, lat: s.lat!, lon: s.lon!, city: s.city, kind: s.kind, mode: s.mode, text, prio });
  }
  const order = (c: Cand) => (c.prio === 0 ? first.indexOf(c.sid) : 0);
  return out.sort((a, b) => a.prio - b.prio || order(a) - order(b) || (a.city ?? "").localeCompare(b.city ?? "") || a.sid.localeCompare(b.sid));
}

async function main() {
  loadEnv();
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const limit = Number(arg("--limit") ?? Infinity);
  const deadline = Date.now() + Number(arg("--minutes") ?? 55) * 60_000;
  const dir = dataDir();
  const outDir = path.join(dir, "aerial");
  fs.mkdirSync(outDir, { recursive: true });

  const local = JSON.parse(fs.readFileSync(path.join(dir, "shells.json"), "utf8")) as Partial<Shell>[];
  const remote = await dbShells();
  const first = [...new Set([...HEROES, ...replayShellIds(dir)])];
  const all = candidates(local, remote, first);
  const missingFirst = first.filter((id) => !all.some((c) => c.sid === id));
  if (missingFirst.length) console.warn(`priority (a) ids not business/enterprise with coordinates, skipped: ${missingFirst.join(" ")}`);
  const todo = all.filter((c) => !fs.existsSync(path.join(outDir, `${c.sid}.json`))).slice(0, limit);
  const byPrio = (list: Cand[]) => [0, 1, 2, 3, 4].map((p) => list.filter((c) => c.prio === p).length).join("/");
  console.log(`candidates ${all.length} (a/b/c/d-commercial/d-amenity ${byPrio(all)}); already done ${all.length - all.filter((c) => !fs.existsSync(path.join(outDir, `${c.sid}.json`))).length}; this run ${todo.length} (${byPrio(todo)})`);
  if (process.argv.includes("--dry-run")) return;

  const stats = { counted: 0, unclear: 0, failed: 0, reused: 0 };
  const failures: string[] = [];
  // Spaces at the same coordinates share one ortho, so they share one count instead of re-asking the model.
  const sameImage = new Map<string, Promise<AerialCount | null>>();
  const t0 = Date.now();
  let next = 0, done = 0, stopped = false;

  async function one(c: Cand) {
    const key = `${c.lat.toFixed(5)}_${c.lon.toFixed(5)}`;
    let res: AerialCount | null;
    try {
      const shared = sameImage.get(key);
      if (shared) {
        const base = await shared;
        if (!base) throw new Error("no image");
        res = { ...base, sid: c.sid, image: `aerial/${c.sid}.jpg` };
        fs.copyFileSync(path.join(dir, base.image), path.join(outDir, `${c.sid}.jpg`));
        fs.writeFileSync(path.join(outDir, `${c.sid}.json`), JSON.stringify(res, null, 2));
        stats.reused++;
      } else {
        const p = countAerial(c.sid, c.lat, c.lon);
        sameImage.set(key, p.catch(() => null));
        res = await p;
        if (!res) throw new Error("no Vexcel image");
      }
      if (res.stalls.n !== null) stats.counted++; else stats.unclear++;
      console.log(`[${++done}/${todo.length}] ${c.sid} p${c.prio} ${c.city ?? "?"} stalls=${res.stalls.n ?? "unclear"} units=${res.rooftopUnits.n ?? "unclear"}${res.garageLikely ? " garage" : ""} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      stats.failed++;
      failures.push(`${c.sid}: ${(e as Error).message.slice(0, 120)}`);
      console.log(`[${++done}/${todo.length}] ${c.sid} p${c.prio} FAILED ${(e as Error).message.slice(0, 120)}`);
    }
  }

  const CONCURRENCY = 6;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length) {
      if (Date.now() > deadline) { stopped = true; return; }
      await one(todo[next++]);
    }
  }));
  const left = all.filter((c) => !fs.existsSync(path.join(outDir, `${c.sid}.json`)));
  console.log(`\ncounted ${stats.counted}, unclear ${stats.unclear}, failed ${stats.failed} (reused a same-image count for ${stats.reused}) in ${((Date.now() - t0) / 60000).toFixed(1)} min${stopped ? "; stopped at the time limit" : ""}`);
  console.log(`left unprocessed: ${left.length} (a/b/c/d-commercial/d-amenity ${byPrio(left)})`);
  if (failures.length) console.log(`failures:\n  ${failures.slice(0, 30).join("\n  ")}`);
}

if (process.argv[1] && /aerial\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
