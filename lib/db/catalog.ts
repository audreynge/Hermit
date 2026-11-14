import { bumpGeneration, db, q, tx, usingPostgres } from "./index";

// The full catalog is private and not in the deploy bundle, so on Vercel each instance starts with only the
// synthetic sample. Copy the catalog from Postgres into local SQLite once per instance when Postgres has more,
// so every synchronous search read in lib/query/load.ts keeps working unchanged.
export async function hydrateCatalogFromPostgres(): Promise<{ shells: number; roomgraphs: number } | null> {
  if (!usingPostgres()) return null;
  const [{ n: remote }] = await q<{ n: number | string }>("SELECT count(*) AS n FROM shells");
  const { n: local } = db().prepare("SELECT count(*) AS n FROM shells").get() as { n: number };
  if (Number(remote) <= local) return null;
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
