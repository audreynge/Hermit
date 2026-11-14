// Uploads the local catalog (shells + room graphs) to Postgres so deployed instances can load it.
// Run: npm run db:push-catalog   (needs DATABASE_URL in .env; replaces the remote catalog)
import postgres from "postgres";
import { db } from "../lib/db";
import { ensureImported } from "../lib/query/load";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

ensureImported();
const shells = db().prepare("SELECT id, sid, mode, city, sqft, json FROM shells").all() as Record<string, string | number | null>[];
const graphs = db().prepare("SELECT sid, json FROM roomgraphs").all() as Record<string, string>[];
if (!shells.length) throw new Error("local catalog is empty; run npm run etl first");

const sql = postgres(url, { prepare: false, max: 1 });
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
await sql.begin(async (t) => {
  await t`TRUNCATE shells, roomgraphs`;
  for (const c of chunks(shells, 500)) await t`INSERT INTO shells ${t(c, "id", "sid", "mode", "city", "sqft", "json")}`;
  for (const c of chunks(graphs, 100)) await t`INSERT INTO roomgraphs ${t(c, "sid", "json")}`;
});
const [{ s, g }] = await sql`SELECT (SELECT count(*) FROM shells) AS s, (SELECT count(*) FROM roomgraphs) AS g`;
console.log(`pushed catalog: ${s} shells, ${g} room graphs`);
await sql.end();
