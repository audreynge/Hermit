// Pulls room geometry for candidate scans once; resumable (skips sids already on disk).
// Run: npx tsx --env-file=.env pipeline/matterport.ts [limit]
import fs from "node:fs";
import path from "node:path";
import { roomGraphFromModel } from "./transform";
import type { Shell } from "../lib/types";

const DIR = path.join(process.cwd(), "data", "processed");
const OUT = path.join(DIR, "roomgraphs");
const PLANS = path.join(DIR, "assets", "floorplans");
const QUERY = `query($id: ID!) { model(id: $id) {
  id name
  propertyClassifications { classification type }
  floors { id }
  generatedDescription { description }
  panoLocations { id label position { x y z } }
  assets { floorplans { url format flags } }
  rooms { id label tags classifications { label confidence } dimensions { areaFloor height units } floor { id }
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
  fs.mkdirSync(PLANS, { recursive: true });
  const shells: Shell[] = JSON.parse(fs.readFileSync(path.join(DIR, "shells.json"), "utf8"));
  fs.mkdirSync(OUT, { recursive: true });
  const HEROES = new Set(["x37LjPx62VA", "1uXpcwty9Sr", "PxU1vnyht7Q", "GpFkvxKtRrp", "6FNMVoyPrL1", "Kst1D1ZfDa8", "zvKHR9DHNjJ"]);
  const BUSINESS = new Set(["suite", "office", "medical", "salon", "retail", "warehouse"]);
  const wanted = shells
    .filter((s) => s.sid && (HEROES.has(s.sid) || (s.kind ? BUSINESS.has(s.kind) : s.mode !== "home" || s.listing?.status === "active")))
    .sort((a, b) => Number(HEROES.has(b.sid!)) - Number(HEROES.has(a.sid!)))
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
        const model = (await fetchModel(sid)) as { assets?: { floorplans?: { url: string; format: string }[] } };
        const g = roomGraphFromModel(model);
        // Signed floor plan URLs expire, so cache the image once.
        const plan = model.assets?.floorplans?.find((f) => f.format === "jpg");
        if (plan) {
          const img = await fetch(plan.url);
          if (img.ok) { fs.writeFileSync(path.join(PLANS, `${sid}.jpg`), Buffer.from(await img.arrayBuffer())); g.floorplan = `floorplan:${sid}`; }
        }
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
