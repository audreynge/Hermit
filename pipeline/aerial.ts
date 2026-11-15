// Counts surface parking stalls and rooftop units on the Vexcel ortho for business and enterprise spaces and writes
// data/processed/aerial/<sid>.{jpg,json} (see lib/vexcel/count.ts). Resumable: spaces with a JSON already are skipped.
// Run: npx tsx pipeline/aerial.ts [--limit N] [--minutes M] [--dry-run]
//      npx tsx pipeline/aerial.ts --recount-unclear [--replay-only] [--limit N] [--minutes M] [--dry-run]
//        re-runs every saved count whose stalls or rooftop units are unclear under the tie-break rule (the two saved runs
//        plus a third on the saved photo), replay shells first, then Houston and LA medical/office.
// Needs VEXCELAPIKEY and GEMINI_API_KEY; DATABASE_URL (read-only) adds the Postgres catalog. Env comes from the process,
// else from ./.env or HERMIT_ENV_FILE (lines like `NAME =value`).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { dataDir } from "../lib/paths";
import type { AerialCount, Shell } from "../lib/types";
import { countAerial, isUnclear, QuotaExhausted, recountAerial, SAFE_SID, savedRuns } from "../lib/vexcel/count";

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
const okSid = (s: unknown): s is string => typeof s === "string" && SAFE_SID.test(s);
const hasLL = (s: Partial<Shell>) => typeof s.lat === "number" && typeof s.lon === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lon);
// Low concurrency: gemini-3.8-flash answers 503 "high demand" and 429 when pushed.
const CONCURRENCY = 2;

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

const isCounted = (a: AerialCount) => a.stalls.n !== null && a.stalls.confidence >= 0.5;
const unitsCounted = (a: AerialCount) => a.rooftopUnits.n !== null && a.rooftopUnits.confidence >= 0.5;

function savedCounts(outDir: string): AerialCount[] {
  const out: AerialCount[] = [];
  for (const f of fs.readdirSync(outDir).filter((f) => f.endsWith(".json"))) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(outDir, f), "utf8")) as AerialCount); } catch {}
  }
  return out;
}

function tally(outDir: string) {
  const all = savedCounts(outDir);
  return {
    total: all.length,
    counted: all.filter(isCounted).length,
    couldntCount: all.filter((a) => !isCounted(a)).length,
    tieBroken: all.filter((a) => isCounted(a) && a.stalls.confidence < 0.8).length,
    unitsCounted: all.filter(unitsCounted).length,
    unitsUnclear: all.filter((a) => !unitsCounted(a)).length,
  };
}

const isFatal = (e: unknown) => e instanceof QuotaExhausted || / 40[123]:/.test((e as Error).message);

/** Runs `work` over `items` with CONCURRENCY workers until done, the deadline, or a fatal (billing/quota) error. */
async function pool<T>(items: T[], deadline: number, work: (t: T) => Promise<void>): Promise<{ fatal: string; stopped: boolean }> {
  let next = 0, stopped = false, fatal = "";
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      if (Date.now() > deadline || fatal) { stopped = true; return; }
      try { await work(items[next++]); } catch (e) { if (isFatal(e)) fatal = (e as Error).message.slice(0, 200); }
    }
  }));
  return { fatal, stopped };
}

async function recountUnclear(dir: string, all: Cand[], first: string[], limit: number, deadline: number, dry: boolean) {
  const outDir = path.join(dir, "aerial");
  const prio = new Map(all.map((c) => [c.sid, c.prio]));
  for (const id of first) prio.set(id, 0);
  const before = tally(outDir);
  // Stalls unclear (the user sees "couldn't count") before rooftop units only; replay shells first either way.
  const rank = (a: AerialCount) => {
    const p = prio.get(a.sid) ?? 5;
    const unitsOnly = isCounted(a) ? 1 : 0;
    return [p === 0 ? 0 : 1, unitsOnly, p, savedRuns(a) ? 0 : 1];
  };
  const replayOnly = process.argv.includes("--replay-only");
  const todo = savedCounts(outDir).filter((a) => isUnclear(a) && (!replayOnly || prio.get(a.sid) === 0)).map((a) => ({ a, r: rank(a) }))
    .sort((x, y) => x.r.reduce((d, v, i) => d || v - y.r[i], 0) || x.a.sid.localeCompare(y.a.sid)).map((x) => x.a);
  // Same photo and same saved runs: one recount, copied to the rest.
  const groups = new Map<string, AerialCount[]>();
  for (const a of todo) {
    const jpg = path.join(outDir, `${a.sid}.jpg`);
    if (!fs.existsSync(jpg)) continue;
    const k = crypto.createHash("sha1").update(fs.readFileSync(jpg)).update(a.source).digest("hex");
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const work = [...groups.values()].slice(0, limit);
  const stallsTodo = todo.filter((a) => !isCounted(a)).length;
  console.log(`before: ${before.counted} counted, ${before.couldntCount} couldn't count (of ${before.total}); rooftop units ${before.unitsCounted} counted, ${before.unitsUnclear} unclear`);
  console.log(`unclear to recount: ${todo.length} (${stallsTodo} stalls unclear, ${todo.length - stallsTodo} rooftop units only) in ${groups.size} distinct photos; this run ${work.length}`);
  console.log(`first up: ${work.slice(0, 8).map((g) => `${g[0].sid}(p${prio.get(g[0].sid) ?? 5})`).join(" ")}`);
  if (dry) return;

  const t0 = Date.now();
  const stats = { settled: 0, stillUnclear: 0, failed: 0, copied: 0 };
  let done = 0;
  const res = await pool(work, deadline, async (group) => {
    const [head, ...rest] = group;
    try {
      const c = await recountAerial(head.sid, { timeoutMs: 60_000 });
      if (!c) throw new Error("no saved photo");
      for (const o of rest) {
        fs.writeFileSync(path.join(outDir, `${o.sid}.json`), JSON.stringify({ ...c, sid: o.sid, image: `aerial/${o.sid}.jpg` }, null, 2));
        stats.copied++;
      }
      if ((isCounted(c) && !isCounted(head)) || (unitsCounted(c) && !unitsCounted(head))) stats.settled++; else stats.stillUnclear++;
      console.log(`[${++done}/${work.length}] ${head.sid} p${prio.get(head.sid) ?? 5} stalls ${head.stalls.n ?? "unclear"} -> ${c.stalls.n ?? "unclear"} (${c.stalls.confidence}) units ${head.rooftopUnits.n ?? "unclear"} -> ${c.rooftopUnits.n ?? "unclear"} runs ${JSON.stringify(c.runs?.map((r) => r.stalls))} ${c.model} ${((Date.now() - t0) / 1000).toFixed(0)}s${rest.length ? ` (+${rest.length} same photo)` : ""}`);
    } catch (e) {
      stats.failed++;
      console.log(`[${++done}/${work.length}] ${head.sid} FAILED ${(e as Error).message.slice(0, 160)}`);
      throw e;
    }
  });
  const after = tally(outDir);
  console.log(`\nrecounted ${done} photos in ${((Date.now() - t0) / 60000).toFixed(1)} min: settled ${stats.settled}, still unclear ${stats.stillUnclear}, failed ${stats.failed}, copied to ${stats.copied} same-photo spaces${res.fatal ? `; stopped early: ${res.fatal}` : res.stopped ? "; stopped at the time limit" : ""}`);
  console.log(`before: ${before.counted} counted, ${before.couldntCount} couldn't count; rooftop units ${before.unitsCounted} counted, ${before.unitsUnclear} unclear`);
  console.log(`after:  ${after.counted} counted (${after.tieBroken} by 2 of 3), ${after.couldntCount} couldn't count; rooftop units ${after.unitsCounted} counted, ${after.unitsUnclear} unclear`);
}

async function main() {
  loadEnv();
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
  const recount = process.argv.includes("--recount-unclear");
  const dry = process.argv.includes("--dry-run");
  const limit = Number(arg("--limit") ?? Infinity);
  const deadline = Date.now() + Number(arg("--minutes") ?? (recount ? 40 : 55)) * 60_000;
  const dir = dataDir();
  const outDir = path.join(dir, "aerial");
  fs.mkdirSync(outDir, { recursive: true });

  const local = JSON.parse(fs.readFileSync(path.join(dir, "shells.json"), "utf8")) as Partial<Shell>[];
  const remote = await dbShells();
  const first = [...new Set([...HEROES, ...replayShellIds(dir)])];
  const all = candidates(local, remote, first);
  if (recount) return recountUnclear(dir, all, first, limit, deadline, dry);

  const missingFirst = first.filter((id) => !all.some((c) => c.sid === id));
  if (missingFirst.length) console.warn(`priority (a) ids not business/enterprise with coordinates, skipped: ${missingFirst.join(" ")}`);
  const todo = all.filter((c) => !fs.existsSync(path.join(outDir, `${c.sid}.json`))).slice(0, limit);
  const byPrio = (list: Cand[]) => [0, 1, 2, 3, 4].map((p) => list.filter((c) => c.prio === p).length).join("/");
  console.log(`candidates ${all.length} (a/b/c/d-commercial/d-amenity ${byPrio(all)}); already done ${all.length - all.filter((c) => !fs.existsSync(path.join(outDir, `${c.sid}.json`))).length}; this run ${todo.length} (${byPrio(todo)})`);
  if (dry) return;

  const stats = { counted: 0, unclear: 0, failed: 0, reused: 0 };
  const failures: string[] = [];
  // Spaces at the same coordinates share one ortho, so they share one count instead of re-asking the model.
  const sameImage = new Map<string, Promise<AerialCount | null>>();
  const t0 = Date.now();
  let done = 0;

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
        const p = countAerial(c.sid, c.lat, c.lon, { timeoutMs: 60_000 });
        sameImage.set(key, p.catch(() => null));
        res = await p;
        if (!res) throw new Error("no Vexcel image");
      }
      if (res.stalls.n !== null) stats.counted++; else stats.unclear++;
      console.log(`[${++done}/${todo.length}] ${c.sid} p${c.prio} ${c.city ?? "?"} stalls=${res.stalls.n ?? "unclear"} units=${res.rooftopUnits.n ?? "unclear"}${res.garageLikely ? " garage" : ""} ${res.model} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      stats.failed++;
      failures.push(`${c.sid}: ${(e as Error).message.slice(0, 120)}`);
      console.log(`[${++done}/${todo.length}] ${c.sid} p${c.prio} FAILED ${(e as Error).message.slice(0, 120)}`);
      // Billing, auth or every model's daily quota won't fix themselves: the pool stops the run.
      throw e;
    }
  }

  const { fatal, stopped } = await pool(todo, deadline, one);
  const left = all.filter((c) => !fs.existsSync(path.join(outDir, `${c.sid}.json`)));
  console.log(`\ncounted ${stats.counted}, unclear ${stats.unclear}, failed ${stats.failed} (reused a same-image count for ${stats.reused}) in ${((Date.now() - t0) / 60000).toFixed(1)} min${fatal ? `; stopped early: ${fatal}` : stopped ? "; stopped at the time limit" : ""}`);
  console.log(`left unprocessed: ${left.length} (a/b/c/d-commercial/d-amenity ${byPrio(left)})`);
  if (failures.length) console.log(`failures:\n  ${failures.slice(0, 30).join("\n  ")}`);
}

if (process.argv[1] && /aerial\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
