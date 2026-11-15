// Uploads the local catalog (shells + room graphs) to Postgres so deployed instances can load it.
// Run: npm run db:push-catalog [-- path/to/shells.json] [-- --dry-run]
// Source: the given file, else <data dir>/shells.merged.json if present, else <data dir>/shells.json; room graphs
// from <data dir>/roomgraphs/*.json. Upserts by primary key (shells.id, roomgraphs.sid), so re-running is safe;
// rows already in Postgres that the file lacks are left alone. --dry-run prints counts and writes nothing.
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { dataDir } from "../lib/paths";
import type { Shell } from "../lib/types";
import { loadEnvFile } from "./merge-catalog";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
loadEnvFile(args.find((a) => a.startsWith("--env="))?.slice(6) ?? path.join(process.cwd(), ".env"));

const dir = dataDir();
const file = args.find((a) => !a.startsWith("--")) ?? [path.join(dir, "shells.merged.json"), path.join(dir, "shells.json")].find((f) => fs.existsSync(f));
if (!file || !fs.existsSync(file)) throw new Error(`no catalog file found in ${dir}; run npm run etl (and pipeline/merge-catalog.ts) first`);

const shells = (JSON.parse(fs.readFileSync(file, "utf8")) as Shell[]).map((s) => ({ id: s.id, sid: s.sid ?? null, mode: s.mode, city: s.city, sqft: s.sqft ?? null, json: JSON.stringify(s) }));
if (!shells.length) throw new Error(`${file} is empty`);
const dupes = shells.length - new Set(shells.map((s) => s.id)).size;
if (dupes) throw new Error(`${file} has ${dupes} duplicate ids; fix before pushing`);

const graphDir = path.join(dir, "roomgraphs");
const graphs = (fs.existsSync(graphDir) ? fs.readdirSync(graphDir).filter((f) => /^[A-Za-z0-9_-]{1,40}\.json$/.test(f)) : [])
  .map((f) => ({ sid: f.slice(0, -5), json: fs.readFileSync(path.join(graphDir, f), "utf8") }));

console.log(`catalog: ${shells.length} shells from ${path.basename(file)}, ${graphs.length} room graphs from ${graphDir}`);
if (dryRun) {
  console.log("dry run: nothing written");
} else {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  try {
    await sql.begin(async (t) => {
      for (const c of chunks(shells, 500))
        await t`INSERT INTO shells ${t(c, "id", "sid", "mode", "city", "sqft", "json")}
          ON CONFLICT (id) DO UPDATE SET sid = EXCLUDED.sid, mode = EXCLUDED.mode, city = EXCLUDED.city, sqft = EXCLUDED.sqft, json = EXCLUDED.json`;
      for (const c of chunks(graphs, 100))
        await t`INSERT INTO roomgraphs ${t(c, "sid", "json")} ON CONFLICT (sid) DO UPDATE SET json = EXCLUDED.json`;
    });
    const [{ s, g }] = await sql`SELECT (SELECT count(*) FROM shells) AS s, (SELECT count(*) FROM roomgraphs) AS g`;
    console.log(`pushed catalog: Postgres now has ${s} shells, ${g} room graphs`);
  } finally {
    await sql.end();
  }
}
