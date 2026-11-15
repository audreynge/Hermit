import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { TraceEvent } from "../lib/types";

// The 2-minute demo path with no venue Wi-Fi: every browser request that isn't to this machine is aborted, so the
// Matterport tour, Esri tiles and any direct Vexcel calls fail the way they would offline. The server is the user's
// dev server on localhost:3000. Expected names come from the recorded run itself, never from this file.
// Run: npx playwright test e2e/demo.spec.ts --project=desktop   (DEMO_RUN=<id> to point at another replay)
const RUN = process.env.DEMO_RUN ?? "priya-det";
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

async function offline(page: Page) {
  const blocked: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (LOCAL.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    blocked.push(url);
    return route.abort("internetdisconnected");
  });
  return blocked;
}

// Console errors, split in two. "fallout" is what blocked outside requests cause: the browser's "Failed to load
// resource" for a remote URL, and the Matterport Showcase SDK (served from /mp/) logging or throwing "Failed to fetch"
// when it can't reach Matterport. Everything else is a real error and fails the test.
const NETWORK = /Failed to fetch|status_code: 0|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|Load failed/i;
async function watchErrors(page: Page) {
  const errors: string[] = [];
  const fallout: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const where = m.location()?.url ?? "";
    const line = `${m.text().slice(0, 240)}${where ? ` @ ${where}` : ""}`;
    if ((/Failed to load resource/i.test(m.text()) && where && !LOCAL.test(where)) || NETWORK.test(m.text())) fallout.push(line);
    else errors.push(line);
  });
  // The Showcase SDK also rejects with a bare { status_code: 0 } when its API call can't connect; that surfaces as a
  // pageerror reading only "Object". Tag that exact shape as fallout instead of losing what it was.
  await page.addInitScript(() => {
    window.addEventListener("unhandledrejection", (ev) => {
      const r = ev.reason as { status_code?: unknown } | null;
      if (r && typeof r === "object" && !(r instanceof Error) && r.status_code === 0) { ev.preventDefault(); console.error("Matterport API unreachable: status_code 0 (Failed to fetch)"); }
    });
  });
  page.on("pageerror", (e) => {
    const line = `pageerror: ${e.message.slice(0, 240)} :: ${(e.stack ?? "").replace(/\s+/g, " ").slice(0, 300)}`;
    if (NETWORK.test(e.message) || /\/mp\/js\//.test(e.stack ?? "")) fallout.push(line);
    else errors.push(line);
  });
  return { errors, fallout };
}

// The run as the server replays it (server-side, so not affected by the browser block).
async function recorded(request: APIRequestContext) {
  const res = await request.get(`/api/agent?replay=${RUN}`, { timeout: 60_000 });
  expect(res.status(), `replay ${RUN} exists on the server`).toBe(200);
  const events = (await res.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as TraceEvent);
  const of = <K extends TraceEvent["type"]>(k: K) => events.filter((e): e is Extract<TraceEvent, { type: K }> => e.type === k);
  const reports = of("report").at(-1)?.reports ?? [];
  const names = new Map(reports.map((r) => [r.shellId, r.name]));
  const short = (s: string) => s.split(/[,·:]/)[0].trim();
  const ruledOut = [...of("veto").map((e) => short(e.name)), ...of("drop").map((e) => short(names.get(e.shellId) ?? e.reason))];
  const looked = of("escalate").filter((e) => e.result).map((e) => ({ name: short(names.get(e.shellId) ?? ""), result: e.result! })).filter((l) => l.name);
  return { reports, ruledOut, looked };
}

test.describe.configure({ mode: "serial" });

test("offline demo: results and the decision panel", async ({ page, request }) => {
  const run = await recorded(request);
  expect(run.reports.length, "the run has reports").toBeGreaterThan(0);
  expect(run.ruledOut.length, "the run ruled out a named space").toBeGreaterThan(0);
  expect(run.looked.length, "the run looked closer with a result").toBeGreaterThan(0);

  const blocked = await offline(page);
  const { errors, fallout } = await watchErrors(page);
  await page.goto(`/studio?replay=${RUN}`);
  const results = page.locator("section.results-card");
  await expect(results.locator("[id^='sp-']").first()).toBeVisible({ timeout: 60_000 });
  await expect(results.getByRole("status")).toHaveText(new RegExp(`^${run.reports.length} results?$`), { timeout: 60_000 });

  const panel = page.getByRole("region", { name: /How Hermit decided|crew at work/i });
  await expect(panel).toBeVisible();
  const text = await panel.innerText();
  expect(text, "decision panel names a ruled-out space").toMatch(new RegExp(`(Ruled out|Dropped|ruled out)[^\\n]*(${run.ruledOut.map(escape).join("|")})`));
  expect(text, "decision panel has a look-closer line").toMatch(new RegExp(`Looked[^\\n]*(${run.looked.map((l) => escape(l.name)).join("|")})`));
  const seen = run.looked.find((l) => l.result === "seen");
  if (seen) expect.soft(lineFor(text, seen.name), "a feature the photos showed is not reported as unseen").not.toMatch(/Couldn't see/);
  expect(errors, `console errors (blocked ${blocked.length} outside requests)`).toEqual([]);
});

test("offline demo: #1 report Overview, Inside & furnish, Neighborhood", async ({ page, request }) => {
  test.setTimeout(180_000);
  const run = await recorded(request);
  const top = run.reports[0];
  const blocked = await offline(page);
  const { errors, fallout } = await watchErrors(page);

  // Open the #1 report the way the demo does: Full report on the first card.
  await page.goto(`/studio?replay=${RUN}`);
  const card = page.locator("article", { has: page.locator(`#sp-${top.shellId}`) });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("section.results-card").getByRole("status")).not.toHaveText(/Searching/, { timeout: 60_000 });
  // The dev server may hot-reload the page while other work lands (a click then goes nowhere), so retry the click.
  const reportUrl = new RegExp(`/shell/${top.shellId}\\?run=${RUN}`);
  await expect(async () => {
    if (!reportUrl.test(page.url())) await card.getByRole("button", { name: /Full report/ }).click({ timeout: 10_000 });
    await expect(page).toHaveURL(reportUrl, { timeout: 15_000 });
  }).toPass({ timeout: 75_000 });
  await expect(page.getByRole("tab", { name: /Overview/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#report-panel")).toContainText(/\w{3,}/);
  expect(errors, "Overview console errors").toEqual([]);

  // Inside & furnish: the 3D tour can't load offline; the page must keep working and the measured 2D plan must show.
  await page.getByRole("tab", { name: /Inside/ }).click();
  await page.waitForTimeout(8000);
  await expect(page.locator("#report-panel")).toBeVisible();
  const plan2d = page.getByRole("button", { name: /2D plan/ });
  await expect(plan2d).toBeEnabled();
  if ((await plan2d.getAttribute("aria-pressed")) !== "true") await plan2d.click();
  await expect(page.locator("#report-panel svg.floorplan-svg")).toBeVisible();
  expect(errors, "Inside & furnish console errors").toEqual([]);

  // Neighborhood: the aerial photo is served by this server's /api/asset (local cache or private Storage), so it shows offline.
  await page.getByRole("tab", { name: /Neighborhood/ }).click();
  const aerial = page.locator("#report-panel img[src*='/api/asset/'][src*='kind=aerial']").first();
  await expect(aerial, "aerial photo from /api/asset").toBeAttached({ timeout: 15_000 });
  await expect.poll(() => aerial.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { message: "aerial photo loaded" }).toBe(true);
  expect(errors, `Neighborhood console errors (blocked ${blocked.length} outside requests)`).toEqual([]);
  console.log(`blocked ${blocked.length} outside requests; ${fallout.length} console errors from them (e.g. ${fallout[0]?.slice(0, 120) ?? "none"})`);
});

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
// The friendly row and its detail line (the detail renders as the next line).
function lineFor(text: string, name: string) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(name) && /Looked/.test(l));
  return i < 0 ? "" : `${lines[i]}\n${lines[i + 1] ?? ""}`;
}
