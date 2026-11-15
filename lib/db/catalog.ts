import { bumpGeneration, db, q, tx, usingPostgres } from "./index";

// Below this many local shells the catalog is the synthetic sample (data/sample has 8), i.e. a fresh Vercel instance.
export const SAMPLE_MAX_SHELLS = 100;

// Hydrate only a sample-sized local catalog, and only when Postgres has more. A full local catalog (the merged
// shells.merged.json, 15k rows) is never replaced by the smaller Postgres one.
export const shouldHydrate = (local: number, remote: number) => local < SAMPLE_MAX_SHELLS && remote > local;

// The full catalog is private and not in the deploy bundle, so on Vercel each instance starts with only the
// synthetic sample. Copy the catalog from Postgres into local SQLite once per instance in that case,
// so every synchronous search read in lib/query/load.ts keeps working unchanged.
export async function hydrateCatalogFromPostgres(): Promise<{ shells: number; roomgraphs: number } | null> {
  if (!usingPostgres()) return null;
  const { n: local } = db().prepare("SELECT count(*) AS n FROM shells").get() as { n: number };
  if (local >= SAMPLE_MAX_SHELLS) return null;
  const [{ n: remote }] = await q<{ n: number | string }>("SELECT count(*) AS n FROM shells");
  if (!shouldHydrate(local, Number(remote))) return null;
  const [shells, graphs] = await Promise.all([
    q<{ id: string; sid: string | null; mode: string; city: string; sqft: number | null; json: string }>("SELECT id, sid, mode, city, sqft, json FROM shells"),
    q<{ sid: string; json: string }>("SELECT sid, json FROM roomgraphs"),
  ]);
  tx(() => {
    const d = db();
    d.exec("DELETE FROM shells; DELETE FROM roomgraphs;");
    const s = d.prepare("INSERT INTO shells (id, sid, mode, city, sqft, json) VALUES (?, ?, ?, ?, ?, ?)");
    for (const r of shells) s.run(r.id, r.sid, r.mode, r.city, r.sqft, r.json);
    const g = d.prepare("INSERT INTO roomgraphs (sid, json) VALUES (?, ?)");
    for (const r of graphs) g.run(r.sid, r.json);
  });
  bumpGeneration();
  return { shells: shells.length, roomgraphs: graphs.length };
}
