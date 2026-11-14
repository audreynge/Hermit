// Pulls room geometry for candidate scans once; resumable (skips sids already on disk).
// Run: npx tsx --env-file=.env pipeline/matterport.ts [limit]
import fs from "node:fs";
import path from "node:path";
import { roomGraphFromModel } from "./transform";
import type { Shell } from "../lib/types";

const DIR = path.join(process.cwd(), "data", "processed");
const OUT = path.join(DIR, "roomgraphs");
const QUERY = `query($id: ID!) { model(id: $id) {
  id name
  propertyClassifications { classification type }
  floors { id }
  panoLocations { id }
  rooms { id label tags classifications { label confidence } dimensions { areaFloor height units } floor { id } panoLocations { id label }
    boundary { edges { id type openings { type } vertices { position { x y } } } } }
  objectAnnotations { label confidence room { id } }
} }`;

const env = (k: string) => process.env[k]?.trim();
const auth = "Basic " + Buffer.from(`${env("MATTERPORTAPIKEY")}:${env("MATTERPORTAPITOKEN")}`).toString("base64");

async function fetchModel(sid: string, attempt = 0): Promise<unknown> {
  const res = await fetch("https://api.matterport.com/api/models/graph", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ query: QUERY, variables: { id: sid } }),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return fetchModel(sid, attempt + 1);
  }
  const body = await res.json();
  if (!body.data?.model) throw new Error(`${sid}: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 160)}`);
  return body.data.model;
}

async function main() {
  const limit = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? Infinity);
  const shells: Shell[] = JSON.parse(fs.readFileSync(path.join(DIR, "shells.json"), "utf8"));
  fs.mkdirSync(OUT, { recursive: true });
  const wanted = shells
    .filter((s) => s.sid && (s.mode !== "home" || s.listing?.status === "active"))
    .map((s) => s.sid!)
    .filter((sid) => process.argv.includes("--refresh") || !fs.existsSync(path.join(OUT, `${sid}.json`)))
    .slice(0, limit);
  console.log(`fetching ${wanted.length} room graphs`);
  let done = 0, failed = 0;
  const queue = [...wanted];
  // ponytail: fixed pool of 4 workers; tune if Matterport publishes rate limits.
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let sid = queue.shift(); sid; sid = queue.shift()) {
      try {
        const g = roomGraphFromModel(await fetchModel(sid));
        fs.writeFileSync(path.join(OUT, `${sid}.json`), JSON.stringify(g));
      } catch (e) {
        failed++;
        console.error(String(e).slice(0, 200));
      }
      if (++done % 50 === 0) console.log(`${done}/${wanted.length} (${failed} failed)`);
    }
  }));
  console.log(`done: ${done - failed} ok, ${failed} failed`);
}

main();
