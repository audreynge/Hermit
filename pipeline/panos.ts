// "Hermit looked closer": for candidate medical scans, asks a vision model whether each room's scan photos show a
// sink, toilet, exam table or counter. Resumable: room+feature pairs already in checks.json are skipped.
// Run: npx tsx pipeline/panos.ts [sid...]   (HERMIT_DATA_DIR = the processed data dir; HERMIT_ENV_FILE = .env path)
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../lib/paths";
import type { RoomGraph } from "../lib/types";
import { loadPanoChecks } from "../lib/vision/pano";
import { checkRoom, panoHitRate } from "../lib/vision/look";

const FEATURES = ["sink", "toilet", "exam table", "counter"];
const FIXED = ["x37LjPx62VA", "EK8LMNkDsv3", "FNbBFuqpCdT", "mh9ozDuMTeN", "DUUUvKWaNGr"];
const BUDGET_MS = 55 * 60_000;

// .env lines look like `NAME ="value"`: trim the name and value and drop surrounding quotes. Never printed.
function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 1 || line.trim().startsWith("#")) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

// Report shells from recorded medical runs, in file order.
function medicalReplaySids(): string[] {
  const dir = path.join(dataDir(), "replay");
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const run = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (!/medical|clinic/i.test(String(run?.spec?.useType ?? ""))) continue;
      for (const e of run.events ?? []) if (e?.type === "report") for (const r of e.reports ?? []) if (r?.shellId) out.push(r.shellId);
    } catch { /* skip unreadable replay */ }
  }
  return out;
}

const graphOf = (sid: string): RoomGraph | null => {
  const f = path.join(dataDir(), "roomgraphs", `${sid}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
};

async function main() {
  loadEnv(process.env.HERMIT_ENV_FILE ?? path.join(process.cwd(), ".env"));
  const start = Date.now();
  const args = process.argv.slice(2).filter((a) => /^[A-Za-z0-9]+$/.test(a));
  const sids = [...new Set(args.length ? args : [...FIXED, ...medicalReplaySids()])].filter((sid) => graphOf(sid));
  console.log(`data: ${dataDir()}\nscans: ${sids.join(", ")}`);

  type Job = { sid: string; roomId: string; label: string; features: string[] };
  const jobs: Job[] = [];
  for (const sid of sids) {
    const g = graphOf(sid)!;
    const done = new Set(loadPanoChecks(sid).map((c) => `${c.roomId}|${c.feature.toLowerCase()}`));
    try {
      const { mapped, total } = await panoHitRate(sid);
      console.log(`${sid}: ${mapped}/${total} panos inside a room polygon`);
    } catch (e) {
      console.error(`${sid}: ${String(e).slice(0, 160)}`);
      continue;
    }
    for (const r of g.rooms) {
      if (r.polygon.length < 3 || r.label === "hallway") continue;
      const features = FEATURES.filter((f) => !done.has(`${r.id}|${f}`));
      if (features.length) jobs.push({ sid, roomId: r.id, label: r.rawTags?.[0] ?? r.label, features });
    }
  }
  console.log(`${jobs.length} rooms to check`);

  let n = 0, failed = 0;
  const totals = { seen: 0, not_seen: 0, unclear: 0 };
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() - start > BUDGET_MS) { console.log("time budget reached; rerun to resume"); queue.length = 0; return; }
      try {
        const out = await checkRoom(job.sid, job.roomId, job.features);
        for (const c of out) totals[c.result]++;
        const seen = out.filter((c) => c.result === "seen").map((c) => c.feature);
        console.log(`[${++n}/${jobs.length}] ${job.sid} ${job.roomId} (${job.label}): ${seen.length ? "seen " + seen.join(", ") : "nothing seen"}`);
      } catch (e) {
        failed++;
        console.error(`[${++n}/${jobs.length}] ${job.sid} ${job.roomId}: ${String(e).slice(0, 200)}`);
      }
    }
  }));
  console.log(`done in ${Math.round((Date.now() - start) / 1000)} s: seen ${totals.seen}, not_seen ${totals.not_seen}, unclear ${totals.unclear}, failed rooms ${failed}`);
}

main();
