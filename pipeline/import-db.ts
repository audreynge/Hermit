// Loads a JSON bundle directory (shells.json, roomgraphs/*.json, replay/*.json) into SQLite. Idempotent.
// Run: npm run db:import [dir]
import fs from "node:fs";
import path from "node:path";
import { bumpGeneration, db, tx } from "../lib/db";
import { dataDir } from "../lib/paths";
import type { Shell } from "../lib/types";

export function importBundle(dir: string) {
  const d = db();
  const readJson = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
  const list = (sub: string) => (fs.existsSync(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith(".json")) : []);
  const counts = { shells: 0, roomgraphs: 0, runs: 0 };
  tx(() => {
    const shell = d.prepare("INSERT OR REPLACE INTO shells (id, sid, mode, city, sqft, json) VALUES (?, ?, ?, ?, ?, ?)");
    if (fs.existsSync(path.join(dir, "shells.json"))) for (const s of readJson(path.join(dir, "shells.json")) as Shell[]) {
      shell.run(s.id, s.sid ?? null, s.mode, s.city, s.sqft ?? null, JSON.stringify(s));
      counts.shells++;
    }
    const graph = d.prepare("INSERT OR REPLACE INTO roomgraphs (sid, json) VALUES (?, ?)");
    for (const f of list("roomgraphs")) { graph.run(f.slice(0, -5), fs.readFileSync(path.join(dir, "roomgraphs", f), "utf8")); counts.roomgraphs++; }
    const run = d.prepare("INSERT OR REPLACE INTO runs (id, created_at, spec_json, events_json) VALUES (?, ?, ?, ?)");
    for (const f of list("replay")) {
      const r = readJson(path.join(dir, "replay", f));
      run.run(r.id, r.createdAt, JSON.stringify(r.spec), JSON.stringify(r.events));
      counts.runs++;
    }
  });
  bumpGeneration();
  return counts;
}

if (process.argv[1]?.endsWith("import-db.ts")) {
  const dir = process.argv[2] ?? dataDir();
  const c = importBundle(dir);
  console.log(`imported into ${dir}: ${c.shells} shells, ${c.roomgraphs} room graphs, ${c.runs} runs`);
}
