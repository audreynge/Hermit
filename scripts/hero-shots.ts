// Captures the home-page hero screenshots from the recorded demo (synthetic sample data only, safe for public/).
// Usage: start the dev server, then `npx tsx scripts/hero-shots.ts [baseUrl]` (default http://localhost:3000).
import { chromium, type Page } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const out = "public/hero";
const report = `${base}/shell/SAMPLEMED1?run=demo`;

// Hide page chrome that isn't part of the feature being shown.
const hideChrome = (p: Page) => p.addStyleTag({ content: ".decor, .rchat-pill, nextjs-portal, header.top { display: none !important; } body { background: var(--sand-0) !important; }" });

async function shot(p: Page, url: string, selector: string, name: string, height?: number, ready = selector) {
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForSelector(ready, { timeout: 60_000 });
  await hideChrome(p);
  await p.waitForTimeout(2500); // map tiles and plan layout settle
  const box = (await p.locator(selector).first().boundingBox())!;
  await p.screenshot({ path: `${out}/${name}.png`, clip: { x: box.x, y: box.y, width: box.width, height: height ?? box.height } });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem("hermit:settings", JSON.stringify({ theme: "light" })));
await shot(page, `${base}/studio?replay=demo`, ".results-card .space", "match-card", 300); // stop above the card's scroll cut-off
await shot(page, `${report}&tab=furnish`, ".furnish-plan .floorplan-svg", "floor-plan");
await page.setViewportSize({ width: 760, height: 900 }); // narrow card so its text stays legible when shown small
await shot(page, `${report}&tab=overview`, ".ov-verdict", "verdict-card");
await browser.close();
console.log(`Saved match-card.png, floor-plan.png, verdict-card.png to ${out}/`);
