// Caches a 512px Matterport preview image per room-graphed scan into data/processed/thumbs (resumable).
// Run: npx tsx --env-file=.env pipeline/thumbs.ts
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "data", "processed");
const OUT = path.join(DIR, "thumbs");
const auth = "Basic " + Buffer.from(`${process.env.MATTERPORTAPIKEY?.trim()}:${process.env.MATTERPORTAPITOKEN?.trim()}`).toString("base64");

async function previewUrl(sid: string): Promise<string | null> {
  const res = await fetch("https://api.matterport.com/api/models/graph", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ query: "query($id: ID!) { model(id: $id) { image { resizeUrl(resolution: preview) } } }", variables: { id: sid } }),
  });
  const body = await res.json();
  return body.data?.model?.image?.resizeUrl ?? null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const sids = fs.readdirSync(path.join(DIR, "roomgraphs")).map((f) => f.replace(/\.json$/, ""))
    .filter((sid) => !fs.existsSync(path.join(OUT, `${sid}.jpg`)));
  console.log(`fetching ${sids.length} thumbnails`);
  let ok = 0, failed = 0;
  const queue = [...sids];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let sid = queue.shift(); sid; sid = queue.shift()) {
      try {
        const url = await previewUrl(sid);
        if (!url) throw new Error("no image");
        const img = await fetch(url);
        if (!img.ok) throw new Error(`image ${img.status}`);
        fs.writeFileSync(path.join(OUT, `${sid}.jpg`), Buffer.from(await img.arrayBuffer()));
        ok++;
      } catch (e) {
        failed++;
        console.error(sid, String(e).slice(0, 120));
      }
    }
  }));
  console.log(`done: ${ok} ok, ${failed} failed`);
}

main();
