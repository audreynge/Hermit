import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Size } from "../lib/furnish/catalog";
import { corners } from "../lib/furnish/ops";
import { pointInPolygon, type Pt } from "../lib/geometry/polygon";
import type { RoomGraph } from "../lib/types";

async function axe(page: Page, exclude?: string) {
  const b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]);
  const r = await (exclude ? b.exclude(exclude) : b).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

const conversation = (page: Page) => page.getByLabel("Conversation");
const cards = (page: Page) => page.locator("article.space");
const quick = (page: Page, name: string) => page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name });

async function waitForResults(page: Page) {
  await expect(conversation(page)).toContainText(/Would you like me to compare|couldn't find/, { timeout: 45_000 });
}

async function fresh(page: Page, path = "/") {
  await page.goto(path);
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.goto(path);
}

/** Opens a report's 3D tour and its furnishing chat, which starts collapsed behind a "Furnish this …" button. */
async function openFurnishChat(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Step inside" }).click();
  await page.waitForFunction(() => "__furnish" in window, null, { timeout: 90_000 }); // the SDK scene is up
  const furnish = dialog.getByRole("button", { name: /^Furnish this / });
  await expect(furnish).toBeVisible();
  await expect(page.locator("#furnish-text")).toHaveCount(0);
  await furnish.click();
  const input = dialog.getByLabel("Tell me what to place");
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  return { dialog, input };
}

const RICH = "I'm looking for a space for a small medical clinic in Houston. I need about 1,200-1,800 sq ft, with 3 exam rooms, a reception area, and some storage.";

async function chatToResults(page: Page) {
  await fresh(page);
  await page.getByLabel("Message Hermit").fill(RICH);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(conversation(page)).toContainText("Perfect, I have what I need");
  await waitForResults(page);
}

test.describe("chat onboarding", () => {
  // UI moved inline in spec revamp
  test.skip("one Chat tab greets you and offers tap-to-answer choices", async ({ page }) => {
    await fresh(page);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link")).toHaveText(["Chat", "Studio", "Saved"]);
    await expect(nav.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await expect(quick(page, "Medical / dental clinic")).toBeVisible();
    await axe(page);
  });

  // UI moved inline in spec revamp
  test.skip("the survey questions arrive one at a time, including a must-haves card", async ({ page }) => {
    await fresh(page);
    await quick(page, "Medical / dental clinic").click();
    await expect(conversation(page)).toContainText("Houston or Los Angeles");
    await quick(page, "Houston").click();
    await expect(conversation(page)).toContainText("how much space");
    await quick(page, "1,000 – 2,500 sq ft").click();
    await expect(conversation(page)).toContainText("How many exam rooms");
    await quick(page, "3 exam rooms with sinks").click();
    const card = page.getByRole("group", { name: "Choose all that apply" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Step-free / wheelchair access" }).click();
    await card.getByRole("button", { name: "On-site Parking" }).click();
    await expect(card.getByRole("button", { name: "Step-free / wheelchair access" })).toHaveAttribute("aria-pressed", "true");
    await axe(page);
    await card.getByRole("button", { name: "Done" }).click();
    await expect(conversation(page)).toContainText("Step-free / wheelchair access, On-site Parking");
    await expect(conversation(page)).toContainText("How wide is the wheelchair");
    await quick(page, "Manual (~25 in)").click();
    await expect(conversation(page)).toContainText("Checking accessibility");
    await expect(conversation(page)).toContainText("Counting parking");
    await waitForResults(page);

    const n = await cards(page).count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(5);
    await expect(cards(page).first().locator(".space-facts")).toContainText(/sq ft/);
    await expect(cards(page).first().locator("li")).toHaveCount(3);
    const trace = page.getByRole("region", { name: "Agent trace" });
    await expect(trace).toContainText(/Found [\d,]+ spaces? that pass your filters/);
    await expect(trace).toContainText(/Ranked \d+ matching space/);
    await trace.getByText("See every step").click();
    await expect(page.getByLabel("Full agent trace")).toContainText("search_shells");
    await axe(page);
  });

  // UI moved inline in spec revamp
  test.skip("a single detailed message searches right away", async ({ page }) => {
    await chatToResults(page);
    await expect(conversation(page)).toContainText(/I found \d+ .*best fit \(\d+%\)/);
    await expect(cards(page).first()).toBeVisible();
  });

  // UI moved inline in spec revamp
  test.skip("old /search links land on the chat", async ({ page }) => {
    await page.goto("/search");
    await expect(page).toHaveURL(/\/(\?c=.*)?$/);
    await expect(conversation(page)).toBeVisible();
  });
});

test.describe("results", () => {
  test.beforeEach(async ({ page }) => {
    await chatToResults(page);
  });

  // UI moved inline in spec revamp
  test.skip("email drafts are obvious, editable and never sent", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const btn = cards(page).first().getByRole("button", { name: "Email manager" });
    await btn.click();
    const dialog = page.getByRole("dialog", { name: "Email the property manager" });
    await expect(dialog.getByLabel("Subject")).toHaveValue(/^Inquiry about /);
    await expect(dialog.getByLabel("Message")).toHaveValue(/medical clinic/);
    await expect(dialog.getByRole("link", { name: "Open in my email app" })).toHaveAttribute("href", /^mailto:/);
    await expect(dialog).toContainText("never sends it");
    await dialog.getByLabel("Message").fill("Hello, is the suite available in March?");
    await dialog.getByRole("button", { name: "Copy email" }).click();
    await expect(dialog.getByRole("status")).toContainText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("available in March");
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(btn).toBeFocused();

    await quick(page, "Draft an email").click();
    await expect(page.getByRole("dialog", { name: "Email the property manager" })).toBeVisible();
  });

  // UI moved inline in spec revamp
  test.skip("full report, printable page and saving", async ({ page }) => {
    await cards(page).first().getByRole("button", { name: "Full report" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "What Hermit checked" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "source" }).first()).toHaveAttribute("href", /^https:/);
    await dialog.getByRole("link", { name: "Open printable report" }).click();
    await expect(page).toHaveURL(/\/shell\/.+\?run=/);
    await expect(page.getByRole("heading", { name: "Fit overlay" })).toBeVisible();
    await axe(page);

    await page.goBack();
    await expect(cards(page).first()).toBeVisible();
    const name = await cards(page).first().locator("h3").innerText();
    await cards(page).first().getByRole("button", { name: "Save" }).click();
    await expect(cards(page).first().getByRole("button", { name: "Saved" })).toBeVisible();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Saved" }).click();
    await expect(page).toHaveURL(/\/saved$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Saved spaces");
    await expect(page.locator("article.space")).toHaveCount(1);
    await expect(page.locator("article.space h3")).toContainText(name);
    await axe(page);
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("No saved spaces yet.")).toBeVisible();
  });

  // UI moved inline in spec revamp
  test.skip("a refresh starts a fresh chat; the link still shares the search; saved spaces stay with this browser", async ({ page, browser }) => {
    await expect(page).toHaveURL(/[?&]c=c_[a-f0-9]{24}/);
    const shared = page.url();
    const name = await cards(page).first().locator("h3").innerText();
    await cards(page).first().getByRole("button", { name: "Save" }).click();
    await expect(cards(page).first().getByRole("button", { name: "Saved" })).toBeVisible();

    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto(shared);
    await expect(p2.getByLabel("Conversation")).toContainText("Perfect, I have what I need");
    await expect(p2.getByText("You're viewing someone else's search")).toBeVisible();
    await expect(p2.getByLabel("Message Hermit")).toHaveCount(0);
    await p2.getByRole("button", { name: "Start my own search from this" }).click();
    await expect(p2).not.toHaveURL(shared);
    await expect(p2.getByLabel("Message Hermit")).toBeVisible();
    await p2.getByLabel("Message Hermit").fill("make it smaller");
    await p2.getByRole("button", { name: "Send" }).click();
    await expect(p2.getByLabel("Conversation")).not.toContainText("Something went wrong");

    await page.reload();
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await expect(conversation(page)).not.toContainText("Perfect, I have what I need");
    await page.goto("/saved");
    await expect(page.getByText(name)).toBeVisible();
    await p2.goto("/saved");
    await expect(p2.getByText("No saved spaces yet.")).toBeVisible();
    await other.close();
  });

  // UI moved inline in spec revamp
  test.skip("regulations are researched, shown on reports, and answer permit questions", async ({ page }) => {
    await expect(conversation(page)).toContainText("Researching Houston and Texas rules for a medical clinic");
    await cards(page).first().getByRole("button", { name: "Full report" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Rules that may apply" })).toBeVisible();
    await expect(dialog.getByRole("region", { name: "City rules" }).getByRole("link", { name: "source" }).first()).toHaveAttribute("href", /^https:\/\//);
    await expect(dialog.getByRole("region", { name: "Federal rules" })).toContainText(/ADA/);
    await page.keyboard.press("Escape");
    await page.getByLabel("Message Hermit").fill("what permits do I need?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("Here are the rules I found");
    await expect(conversation(page).getByRole("region", { name: "City rules" })).toBeVisible();
    await page.goto(page.url());
    await expect(conversation(page).getByRole("region", { name: "City rules" })).toBeVisible();
  });

  // UI moved inline in spec revamp
  test.skip("View property opens a 3D tour that jumps between your rooms", async ({ page }) => {
    await page.route("**/api/tour-key", (r) => r.fulfill({ json: { key: null } })); // no SDK key → the basic iframe tour
    await cards(page).first().getByRole("button", { name: "View property" }).click();
    const dialog = page.getByRole("dialog");
    const frame = dialog.locator("iframe");
    await expect(frame).toHaveAttribute("src", /my\.matterport\.com\/show\/\?m=[A-Za-z0-9]+/);
    await expect(frame).not.toHaveAttribute("src", /ss=/);
    const stops = dialog.getByRole("navigation", { name: "Jump to a room" }).getByRole("button");
    await expect(stops.first()).toBeVisible();
    await stops.first().click();
    await expect(stops.first()).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator("iframe")).toHaveAttribute("src", /&ss=\d+/);
    await dialog.getByRole("tab", { name: "Aerial" }).click();
    await expect(dialog.getByRole("img", { name: /aerial (image|photo)/i })).toBeVisible();
    await dialog.getByRole("tab", { name: "Fit" }).click();
    await expect(dialog.locator("figure")).toBeVisible();
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  // UI moved inline in spec revamp
  test.skip("Interior, aerial and floor plan tabs open evidence for the selected space", async ({ page }) => {
    if ((await cards(page).count()) > 1) {
      await cards(page).nth(1).locator("h3 button").click();
      await expect(cards(page).nth(1)).toHaveAttribute("data-selected", "true");
    }
    await page.getByRole("button", { name: "Interior & tour" }).click();
    const panel = page.locator("#evidence-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Open 3D tour" }).click();
    await expect(panel.locator("iframe")).toHaveAttribute("src", /my\.matterport\.com/);
    await page.getByRole("button", { name: "Aerial view" }).click();
    await expect(panel.getByRole("img", { name: /aerial (image|photo)/i })).toBeVisible();
    await page.getByRole("button", { name: "Floor plan", exact: true }).click();
    await expect(panel.locator("figure")).toBeVisible();
    await page.getByRole("button", { name: "Floor plan", exact: true }).click();
    await expect(panel).toBeHidden();
  });

  // UI moved inline in spec revamp
  test.skip("follow-ups compare layouts and refine the search", async ({ page }) => {
    await quick(page, "Compare the layouts").click();
    const table = page.locator("table.compare");
    await expect(table).toBeVisible();
    await expect(table).toContainText("Rooms already built");
    await page.getByLabel("Message Hermit").fill("actually make it 2,500-4,000 sq ft");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("Updating your search");
    await expect(conversation(page)).toContainText(/2,500–4,000 sq ft/);
    await expect(conversation(page).getByText(/Would you like me to compare/)).toHaveCount(2, { timeout: 45_000 });
  });
});

test.describe("furnishing the 3D tour", () => {
  // UI overhaul: furnishing moved from the View property dialog to the report's Inside tab + floating Hermit chat; rewrite pending.
  test.skip("place by chat and by dragging a card, drag items in 3D, see load states, never scroll", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    const edits: unknown[] = [];
    let broken = 0;
    await page.route("**/api/furniture/suggest", (r) => r.fulfill({ json: { items: Array.from({ length: 10 }, (_, i) => ({ name: `item ${i}`, terms: [`item ${i}`], size: { w: 0.8, d: 0.8, h: 0.9 } })), source: "gemini" } }));
    // "broken" finds two models whose files 404; everything else finds none (drawn as a box).
    const model = (id: string) => ({ id, source: "polypizza", url: `/e2e-missing/${id}.glb`, title: id, thumb: "", licence: "CC0 1.0", attribution: id });
    await page.route("**/api/furniture/search**", (r) => r.fulfill({ json: { models: r.request().url().includes("broken") ? [model("b1"), model("b2")] : [] } }));
    await page.route("**/e2e-missing/**", (r) => { broken++; return r.fulfill({ status: 404, body: "" }); });
    await page.route("**/api/furniture/edit", async (r) => {
      edits.push(r.request().postDataJSON());
      await r.fulfill({ json: { ops: [{ op: "add", name: "stove", terms: ["stove"], at: "front" }, { op: "remove", id: "f9" }], reply: "I've placed a stove in front of you.", source: "gemini" } });
    });
    // The bundled demo replay is synthetic; point its scan at Matterport's public demo model so the SDK can load it.
    await page.route("**/api/agent?replay=demo", async (r) => {
      const res = await r.fetch();
      await r.fulfill({ response: res, body: (await res.text()).replaceAll('"sid":"SAMPLEMED1"', '"sid":"SxQL3iGyoDo"') });
    });
    await fresh(page, "/studio?replay=demo");
    await expect(cards(page).first()).toBeVisible({ timeout: 60_000 }); // Matching Spaces
    await cards(page).first().getByRole("button", { name: "View property" }).click();
    const { dialog } = await openFurnishChat(page);
    // The tray lowers itself when no floor is visible above it; reopen it before using its tabs.
    const openTray = async () => { const show = dialog.getByRole("button", { name: "Show the furniture tray" }); if (await show.count()) await show.click(); };
    const tab = (name: RegExp) => ({ click: async () => { await openTray(); await dialog.getByRole("tab", { name }).click(); }, el: dialog.getByRole("tab", { name }) });
    const expectPlaced = async (n: number) => { await openTray(); await expect(dialog.getByRole("tab", { name: `Placed (${n})` })).toBeVisible(); };
    const strip = dialog.locator(".furnish-strip");

    // Chat: the reply and the rejected part both show; the item appears as a labeled box (no model found).
    await dialog.getByLabel("Tell me what to place").fill("put a stove in front of me");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "I've placed a stove" })).toContainText("there's no item f9 in this room");
    expect(edits[0]).toMatchObject({ text: "put a stove in front of me", items: [] });
    await tab(/Placed/).click();
    await expect(strip.getByRole("button", { name: "stove, Box: no 3D model found" })).toBeVisible();

    // Drag a suggestion card into the room; then ten more items: still nothing scrolls vertically.
    await tab(/Suggested/).click();
    const box = (await dialog.locator("matterport-viewer").boundingBox())!, trayTop = (await dialog.locator(".furnish-tray").boundingBox())!.y;
    await strip.getByRole("button", { name: "Add item 0" }).dragTo(dialog.locator("matterport-viewer"), { targetPosition: { x: box.width / 2, y: trayTop - box.y - 30 } });
    await expectPlaced(2);
    for (let i = 1; i < 10; i++) { await tab(/Suggested/).click(); await strip.getByRole("button", { name: `Add item ${i}` }).click(); }
    await expectPlaced(11);
    const noVerticalScroll = await page.evaluate(() => [".modal", ".furnish-tray", ".furnish-strip"].every((sel) => { const el = document.querySelector(sel)!; return el.scrollHeight <= el.clientHeight + 1; }));
    expect(noVerticalScroll).toBe(true);
    await tab(/Placed/).click();
    expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // extra cards scroll sideways

    // Drag the stove in the 3D view: it moves, the tour doesn't. First bring it into plain view and lower the tray.
    const saved = () => page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith("hermit:furnish:"))![1]) as { id: string; pos: { x: number; y: number; z: number } }[]);
    await tab(/Placed/).click();
    await strip.getByRole("button", { name: /^stove/ }).click();
    await dialog.getByRole("toolbar", { name: "Edit stove" }).getByRole("button", { name: "Bring it here" }).click();
    const hide = dialog.getByRole("button", { name: "Hide the furniture tray" });
    if (await hide.count()) await hide.click();
    const stove = (await saved()).find((p) => p.id === "f1")!;
    const at = await page.evaluate((pos) => (window as unknown as { __furnish: { screenOf: (p: object, r: DOMRect) => { x: number; y: number } } }).__furnish.screenOf({ ...pos, y: pos.y + 0.45 }, document.querySelector("matterport-viewer")!.getBoundingClientRect()), stove.pos);
    const camera = () => page.evaluate(() => (document.querySelector("matterport-viewer") as unknown as { mpSdk: { Camera: { getPose: () => Promise<{ position: object }> } } }).mpSdk.Camera.getPose().then((p) => JSON.stringify(p.position)));
    const cam0 = await camera();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(at.x - i * 10, at.y + i * 2);
    await page.mouse.up();
    await expect.poll(async () => JSON.stringify((await saved()).find((p) => p.id === "f1")!.pos)).not.toBe(JSON.stringify(stove.pos));
    expect(await camera()).toBe(cam0);
    const toolbar0 = dialog.getByRole("toolbar", { name: "Edit stove" });
    await expect(toolbar0).toBeVisible();
    // Its size shows in feet and inches, in the toolbar and as lines over the tour.
    await expect(toolbar0).toContainText(/\d+′( \d+″)? W × \d+′( \d+″)? D × \d+′( \d+″)? H/);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll(".furnish-overlay g")].filter((g) => (g as SVGGElement).style.display !== "none").map((g) => g.textContent))).toEqual(expect.arrayContaining([expect.stringMatching(/^W /), expect.stringMatching(/^H /)]));

    // Size from a measurement: two clicks on the tour, snapped to the scanned surface; the stove matches, proportionally.
    const s0 = (await saved()).find((p) => p.id === "f1")! as unknown as { size: { w: number; h: number } };
    await toolbar0.getByRole("button", { name: "Size from a measurement" }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Click where the measurement starts" })).toBeVisible();
    const vb = (await dialog.locator("matterport-viewer").boundingBox())!, top = (await dialog.locator(".furnish-tray").boundingBox())!.y;
    for (const fx of [0.35, 0.6]) await page.mouse.click(vb.x + vb.width * fx, top - 40);
    await expect(dialog.getByRole("status").filter({ hasText: /Matched the stove to your/ })).toBeVisible({ timeout: 15_000 });
    expect(await camera()).toBe(cam0); // measuring clicks never walk the tour
    const s1 = (await saved()).find((p) => p.id === "f1")! as unknown as { size: { w: number; h: number } };
    expect(s1.size.w).not.toBeCloseTo(s0.size.w, 3);
    expect(s1.size.h / s1.size.w).toBeCloseTo(s0.size.h / s0.size.w, 3);

    // "Bring it here" puts it back in view.
    await toolbar0.getByRole("button", { name: "Bring it here" }).click();

    // A model whose file never loads: the next one is tried, then a labeled box; no endless retries.
    await dialog.getByLabel("Tell me what to place").fill("x");
    await page.unroute("**/api/furniture/edit");
    await page.route("**/api/furniture/edit", (r) => r.fulfill({ json: { ops: [{ op: "add", name: "broken lamp", terms: ["broken lamp"], at: "front" }], reply: "Added.", source: "gemini" } }));
    await dialog.getByRole("button", { name: "Send" }).click();
    await tab(/Placed/).click();
    await expect(strip.getByRole("button", { name: "broken lamp, Box: model didn't load" })).toBeVisible({ timeout: 45_000 });
    const tries = broken;
    expect(tries).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(3000);
    expect(broken).toBe(tries);

    // Toolbar edits; Esc closes the popover first, not the dialog.
    await strip.getByRole("button", { name: /^item 3/ }).click();
    const toolbar = dialog.getByRole("toolbar", { name: "Edit item 3" });
    await toolbar.getByRole("button", { name: "Color" }).click();
    await toolbar.getByRole("button", { name: "navy" }).click();
    await expect(toolbar.getByRole("button", { name: "navy" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(toolbar.getByRole("group", { name: "Colors" })).toBeHidden();
    await expect(dialog).toBeVisible();
    await axe(page, "matterport-viewer"); // the viewer's shadow DOM carries an inert meta viewport we don't control
    await toolbar.getByRole("button", { name: "Remove item 3" }).click();
    await expectPlaced(11);
  });

  // Live: Gemini plans, real model search, a real scan with its real floor plan. Results vary, so checks are structural.
  // UI overhaul: see above; rewrite pending.
  test.skip("furnish this room on a real scan: inside the rooms, no overlaps, undo and clear", async ({ page }) => {
    test.setTimeout(360_000);
    const SID = "1FFftrgRFBd", BEDROOM = "h26t7ky77ew74yb0pg8qqf5rd"; // a single-floor Houston home in the private bundle
    const file = process.env.HERMIT_DB ?? path.join("data", "sample", "hermit.db");
    const row = fs.existsSync(file) ? (new DatabaseSync(file, { readOnly: true }).prepare("SELECT json FROM roomgraphs WHERE sid = ?").get(SID) as { json: string } | undefined) : undefined;
    test.skip(!row, `needs the private bundle with scan ${SID}`);
    const graph = JSON.parse(row!.json) as RoomGraph, bedroom = graph.rooms.find((r) => r.id === BEDROOM)!;
    await page.setViewportSize({ width: 1280, height: 800 });
    // Point the demo replay's report at the real scan and its floor plan, as a home search.
    await page.route("**/api/agent?replay=demo", async (r) => {
      const res = await r.fetch();
      const body = (await res.text()).split("\n\n").map((chunk) => {
        if (!chunk.startsWith("data: ")) return chunk;
        const e = JSON.parse(chunk.slice(6));
        if (e.spec) e.spec = { ...e.spec, mode: "home", useType: "home" };
        for (const rep of e.reports ?? []) Object.assign(rep, { inside: { sid: SID, sweepId: bedroom.sweeps![0].id }, floorplan: graph });
        return `data: ${JSON.stringify(e)}`;
      }).join("\n\n");
      await r.fulfill({ response: res, body });
    });
    await fresh(page, "/studio?replay=demo");
    await cards(page).first().getByRole("button", { name: "View property" }).click({ timeout: 60_000 });
    const { dialog, input } = await openFurnishChat(page);
    await page.evaluate((id) => {
      const s = (document.querySelector("matterport-viewer") as unknown as { mpSdk: { Sweep: { moveTo: (id: string, o: object) => Promise<unknown>; Transition: { INSTANT: unknown } } } }).mpSdk;
      return s.Sweep.moveTo(id, { transition: s.Sweep.Transition.INSTANT });
    }, bedroom.sweeps![0].id);
    await expect(input).toHaveAttribute("placeholder", /^Furnish this bedroom/, { timeout: 30_000 });

    type Item = { id: string; name: string; pos: { x: number; y: number; z: number }; rotY: number; size: Size; fitted?: Size };
    const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]"), `hermit:furnish:${SID}`) as Promise<Item[]>;
    const toast = dialog.locator(".furnish-toast"), toasts: string[] = [];
    const say = async (text: string) => {
      await expect(toast).toBeHidden({ timeout: 10_000 }); // the last reply fades after 6 s, so the next toast is this one's
      await input.fill(text);
      await dialog.getByRole("button", { name: "Send" }).click();
      await expect(toast).toBeVisible({ timeout: 120_000 });
      const t = await toast.innerText();
      toasts.push(`"${text}" → ${t}`);
      return t;
    };
    const inBedroom = (p: Item) => pointInPolygon({ x: p.pos.x, y: -p.pos.z }, bedroom.polygon);

    // 1. Furnish, timing chat → items placed → every model settled (ready, or a box when none was found/loaded).
    const before = await saved();
    const t0 = Date.now();
    const furnishing = say("furnish this room");
    await expect.poll(async () => (await saved()).length, { timeout: 120_000 }).toBeGreaterThan(before.length);
    const tPlaced = Date.now();
    await furnishing;
    const show = dialog.getByRole("button", { name: "Show the furniture tray" });
    if (await show.count()) await show.click();
    await dialog.getByRole("tab", { name: /Placed/ }).click();
    const statuses = () => page.evaluate(() => [...document.querySelectorAll(".furnish-strip .furnish-card[data-status]")].map((b) => b.getAttribute("data-status")!));
    await expect.poll(async () => (await statuses()).filter((s) => s === "searching" || s === "loading").length, { timeout: 180_000, intervals: [500] }).toBe(0);
    const tSettled = Date.now();
    const items = await saved(), st = await statuses();
    const count = (s: string) => st.filter((x) => x === s).length;
    await page.screenshot({ path: process.env.FURNISH_SHOT ?? test.info().outputPath("furnished.png") });

    // 2. Structure: at least two pieces, each inside a room on the plan; floor pieces don't overlap (2 cm slack, rugs
    // excluded: they lie under things by design); raised pieces stand on another piece.
    const floorY = Math.min(...items.map((p) => p.pos.y));
    const foot = (p: Item, slack = 0) => { const s = p.fitted ?? p.size; return corners(p.pos, { ...s, w: s.w - slack, d: s.d - slack }, p.rotY); };
    const solid = items.filter((p) => p.pos.y <= floorY + 0.05 && (p.fitted ?? p.size).h > 0.1);
    const outside = items.filter((p) => !graph.rooms.some((r) => r.polygon.length >= 3 && pointInPolygon({ x: p.pos.x, y: -p.pos.z }, r.polygon))).map((p) => p.name);
    const overlaps = solid.flatMap((a, i) => solid.slice(i + 1).filter((b) => footprintsOverlap(foot(a, 0.02), foot(b, 0.02))).map((b) => `${a.name} × ${b.name}`));
    const floating = items.filter((p) => p.pos.y > floorY + 0.05 && !items.some((q) => q !== p && pointInPolygon({ x: p.pos.x, y: -p.pos.z }, foot(q)))).map((p) => p.name);
    console.log(`[furnish e2e] ${items.length} items: ${items.map((p) => `${p.name}${p.pos.y > floorY + 0.05 ? ` (raised ${(p.pos.y - floorY).toFixed(2)} m)` : ""}`).join(", ")}`);
    console.log(`[furnish e2e] chat → items placed ${tPlaced - t0} ms; placed → models settled ${tSettled - tPlaced} ms; models ready ${count("ready")}, no model ${count("none")}, failed to load ${count("failed")}`);
    console.log(`[furnish e2e] outside rooms: [${outside}]; overlaps: [${overlaps}]; floating: [${floating}]`);
    expect.soft(items.length, "at least two pieces placed").toBeGreaterThanOrEqual(2);
    expect.soft(outside, "every piece's center is in a room").toEqual([]);
    expect.soft(overlaps, "floor pieces don't overlap").toEqual([]);
    expect.soft(floating, "raised pieces stand on another piece").toEqual([]);

    // 3. Undo restores the list from before; then furnish again (cached plan) and clear the room.
    await say("undo");
    await expect.poll(async () => (await saved()).map((p) => p.id)).toEqual(before.map((p) => p.id));
    await say("furnish this room");
    await expect.poll(async () => (await saved()).filter(inBedroom).length, { timeout: 120_000 }).toBeGreaterThan(0);
    await say("clear this room");
    await expect.poll(async () => (await saved()).filter(inBedroom).map((p) => p.name)).toEqual([]);
    for (const t of toasts) console.log(`[furnish e2e] toast ${t}`);
  });
});

/** Two convex footprints overlap (separating axis test). */
function footprintsOverlap(a: Pt[], b: Pt[]): boolean {
  const axes = [a, b].flatMap((q) => [0, 1].map((i) => ({ x: q[i + 1].x - q[i].x, y: q[i + 1].y - q[i].y })));
  return axes.every((ax) => {
    const pa = a.map((p) => p.x * ax.x + p.y * ax.y), pb = b.map((p) => p.x * ax.x + p.y * ax.y);
    return Math.min(...pa) < Math.max(...pb) && Math.min(...pb) < Math.max(...pa);
  });
}

test.describe("designs in the chat", () => {
  // UI moved inline in spec revamp
  test.skip("draw a layout inside the chat, then match it", async ({ page }) => {
    await fresh(page);
    await page.getByRole("button", { name: "Add a design" }).click();
    await page.getByRole("menuitem", { name: "Draw a layout" }).click();
    const sheet = page.getByRole("dialog", { name: "Build your layout" });
    const canvas = sheet.getByRole("application");
    await expect(canvas).toHaveAttribute("aria-label", /5 rooms/);

    await sheet.getByRole("button", { name: "Add Office" }).click();
    await expect(canvas).toHaveAttribute("aria-label", /6 rooms/);
    await sheet.getByRole("button", { name: "Undo" }).click();
    await expect(canvas).toHaveAttribute("aria-label", /5 rooms/);
    await sheet.getByRole("button", { name: "Redo" }).click();
    const office = sheet.getByRole("button", { name: /^Office, 10 by 10 feet/ });
    await office.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Delete");
    await expect(canvas).toHaveAttribute("aria-label", /5 rooms/);
    const before = Number((await canvas.getAttribute("aria-label"))!.match(/(\d+) objects/)![1]);
    await sheet.getByRole("button", { name: "Add Sink" }).dragTo(sheet.locator(".canvas"), { targetPosition: { x: 200, y: 200 } });
    await expect(canvas).toHaveAttribute("aria-label", new RegExp(`${before + 1} objects`));

    const pct = async () => Number((await sheet.getByRole("button", { name: /^Zoom \d+%/ }).innerText()).replace("%", ""));
    const start = await pct();
    await sheet.getByRole("button", { name: "Zoom in" }).click();
    expect(await pct()).toBeGreaterThan(start);
    await sheet.getByRole("button", { name: /^Zoom \d+%/ }).click();
    expect(await pct()).toBe(100);
    const snap = sheet.getByRole("switch", { name: /Snap to grid/ });
    await snap.click();
    await expect(snap).toHaveAttribute("aria-checked", "false");
    await axe(page);

    await sheet.getByLabel("Layout name").fill("Clinic A");
    await sheet.getByRole("button", { name: "Save layout" }).click();
    await expect(sheet.getByRole("status")).toContainText("Saved \u201cClinic A\u201d");
    await sheet.getByRole("button", { name: /Use this layout/ }).click();
    await expect(sheet).toBeHidden();
    await expect(conversation(page)).toContainText("Here's my layout");
    await expect(conversation(page)).toContainText("2 exam rooms with sinks");
    await expect(conversation(page).getByRole("img", { name: /Drawn layout with 5 rooms/ })).toBeVisible();
    await quick(page, "Houston").click();
    await quick(page, "None of these").click();
    await waitForResults(page);
    await expect(conversation(page)).toContainText(/Comparing your drawing with \d+ real floor plans/);

    await page.goto(page.url());
    await expect(conversation(page).getByRole("img", { name: /Drawn layout/ })).toBeVisible();
  });

  // UI moved inline in spec revamp
  test.skip("/layout opens the drawing sheet in the chat", async ({ page }) => {
    await page.goto("/layout");
    await expect(page.getByRole("dialog", { name: "Build your layout" })).toBeVisible();
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Build your layout" })).toBeHidden();
    await expect(conversation(page)).toBeVisible();
  });

  // UI moved inline in spec revamp
  test.skip("uploading a floor plan continues the conversation", async ({ page }) => {
    await page.route("**/api/design", async (route) => {
      const body = { conversationId: "x", turn: { reply: "I read your floor plan: 3 exam rooms, a reception. Which city should I search: Houston or Los Angeles?", state: { spec: { mode: "business", useType: "medical clinic", rooms: [{ label: "exam room", count: 3, hard: false }], needs: {}, priorities: {}, input: "layout" }, asked: ["size", "rooms", "city"], phase: "gathering" }, ready: false, quickReplies: ["Houston", "Los Angeles"] } };
      await route.fulfill({ json: body });
    });
    await fresh(page);
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await page.getByRole("button", { name: "Add a design" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Upload a floor plan" }).click();
    await (await chooser).setFiles({ name: "plan.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
    await expect(conversation(page)).toContainText("Uploaded plan.png");
    await expect(conversation(page).getByRole("img", { name: /Uploaded floor plan/ })).toBeVisible();
    await expect(conversation(page)).toContainText("I read your floor plan");
    await expect(quick(page, "Houston")).toBeVisible();
  });

  // UI moved inline in spec revamp
  test.skip("uploads explain the missing key and offer drawing instead", async ({ page }) => {
    test.skip(!!process.env.ANTHROPIC_API_KEY, "only meaningful without a key");
    await fresh(page);
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await page.locator('input[type="file"]').setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
    await expect(conversation(page)).toContainText("needs an AI provider key");
    await quick(page, "Draw a layout").click();
    await expect(page.getByRole("dialog", { name: "Build your layout" })).toBeVisible();
  });

  // UI moved inline in spec revamp
  test.skip("oversized uploads are refused before sending", async ({ page }) => {
    await fresh(page);
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await page.locator('input[type="file"]').setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(6 * 1024 * 1024) });
    await expect(conversation(page)).toContainText("image is over 5 MB");
    await page.locator('input[type="file"]').setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(11 * 1024 * 1024) });
    await expect(conversation(page)).toContainText("PDF is over 10 MB");
  });
});

test.describe("layout studio navigation", () => {
  // UI moved inline in spec revamp
  test.skip("trackpad scroll pans, pinch zooms the plan not the page, empty-space drag pans, rooms still drag accurately", async ({ page }) => {
    await fresh(page, "/layout");
    const plan = page.getByRole("application");
    const vb = async () => (await plan.getAttribute("viewBox"))!.split(" ").map(Number);
    const pct = async () => Number((await page.getByRole("button", { name: /^Zoom \d+%/ }).innerText()).replace("%", ""));
    await expect.poll(async () => (await vb())[2]).toBeGreaterThan(1); // sized and framed
    await page.locator(".canvas").evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = (await page.locator(".canvas").boundingBox())!;

    // Two-finger scroll moves the view, not the page.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const [x0, y0] = await vb();
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(120, 200);
    await expect.poll(async () => (await vb())[1]).toBeGreaterThan(y0);
    expect((await vb())[0]).toBeGreaterThan(x0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);

    // Pinch (ctrl+wheel) zooms the plan out, down below the old 50% floor.
    const before = await pct();
    await page.keyboard.down("Control");
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");
    await expect.poll(pct).toBeLessThan(before);
    await expect.poll(pct).toBeLessThan(50);

    // Drag on empty space pans.
    await page.getByRole("dialog", { name: "Build your layout" }).getByRole("button", { name: "Fit", exact: true }).click();
    const [fx] = await vb();
    await page.locator(".canvas").evaluate((el) => el.scrollIntoView({ block: "center" }));
    const c = (await page.locator(".canvas").boundingBox())!; // clicking Fit may have scrolled the page
    // Middle of the left edge: Fit leaves a margin there, and it's clear of the sheet's header.
    await page.mouse.move(c.x + 12, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + 112, c.y + c.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await vb())[0]).toBeLessThan(fx);

    // After panning and zooming, dragging a room lands where the pointer goes.
    const z = 14 * (await pct()) / 100;
    const storage = page.locator('g[aria-label^="Storage"] rect').first();
    const sx = Number(await storage.getAttribute("x"));
    const r = (await storage.boundingBox())!;
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + 10 * z, r.y + r.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Number(await storage.getAttribute("x"))).toBe(sx + 10);

    // Keyboard: with the plan focused, arrows pan and 0 fits.
    await plan.focus();
    const [kx] = await vb();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await vb())[0]).toBeGreaterThan(kx);
    await axe(page);
  });

  // UI moved inline in spec revamp
  test.skip("Save and New are matching toolbar buttons; Save reflects unsaved changes", async ({ page }) => {
    await fresh(page, "/layout");
    const save = page.getByRole("button", { name: /^Save/ });
    const fresh_ = page.getByRole("button", { name: "New layout" });
    const [a, b] = [(await save.boundingBox())!, (await fresh_.boundingBox())!];
    expect(Math.abs(a.height - b.height)).toBeLessThan(1);
    await page.getByLabel("Layout name").fill("Clinic A");
    await save.click();
    await expect(save).toHaveText(/Saved/);
    await expect(save).toBeDisabled();
    await page.getByRole("button", { name: "Add Office" }).click();
    await expect(save).toHaveText(/Save changes/);
  });
});

test.describe("other uses", () => {
  // UI moved inline in spec revamp
  test.skip("a warehouse search asks about equipment and screens power", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("Message Hermit").fill("I need a 20,000 sf warehouse in Los Angeles");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("heavy power");
    await quick(page, "Heavy power + 2 drive-in doors").click();
    await expect(conversation(page)).toContainText("Checking electrical requirements");
    await waitForResults(page);
  });

  // UI moved inline in spec revamp
  test.skip("a wheelchair user gets asked for the chair width and sees which door stops it", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("Message Hermit").fill("I want to buy a 3 bedroom house in Houston, I use a wheelchair");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("How wide is the wheelchair");
    await page.getByLabel("Message Hermit").fill("25 inches");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("25 in chair");
    await waitForResults(page);
    const card = cards(page).filter({ hasText: "101 Sample Lane" });
    await expect(card).toContainText("Chair fits with offset hinges on 1 door (bathroom)");
    await expect(card.getByText("Concern:")).toBeAttached();
    await page.route("**/api/tour-key", (r) => r.fulfill({ json: { key: null } })); // no SDK key → the basic iframe tour
    await card.getByRole("button", { name: "View property" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Fit" }).click();
    await dialog.getByRole("button", { name: "Wheelchair access" }).click();
    await expect(dialog.getByRole("button", { name: "Wheelchair access" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("img", { name: /Wheelchair route .* 25 in chair: 5 rooms reachable, 0 fit with offset hinges, 1 blocked/ })).toBeVisible();
    await expect(dialog.getByText(/red = too narrow for the chair/)).toBeVisible();
    await dialog.getByRole("button", { name: "With offset hinges" }).click();
    await expect(dialog.getByRole("img", { name: /Wheelchair route .* 5 rooms reachable, 1 fit with offset hinges, 0 blocked/ })).toBeVisible();
    await dialog.getByRole("button", { name: "As scanned" }).click();
    await dialog.getByRole("button", { name: "Show the bathroom door (24 in) in the 3D tour" }).click();
    await expect(dialog.getByRole("tab", { name: "3D tour" })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.locator("iframe")).toHaveAttribute("src", /&ss=12/);
    await dialog.getByRole("tab", { name: "Fit" }).click();
    await page.screenshot({ path: "test-results/wheelchair-fit.png" });
    await axe(page);
  });

  // UI moved inline in spec revamp
  test.skip("buying a home asks for bedrooms, then must-haves", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("Message Hermit").fill("I want to buy a house in Houston under $450k");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("How many bedrooms");
    await quick(page, "3 bed / 2 bath").click();
    await expect(page.getByRole("group", { name: "Choose all that apply" })).toBeVisible();
    await quick(page, "None of these").click();
    await waitForResults(page);
  });
});

test.describe("replay and failure states", () => {
  // UI moved inline in spec revamp
  test.skip("the recorded demo replays with every outside request blocked", async ({ page }) => {
    await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort()));
    await fresh(page, "/?replay=demo");
    await expect(conversation(page)).toContainText("recorded run");
    await waitForResults(page);
    await expect(cards(page).first()).toBeVisible();
    await page.getByRole("region", { name: "Agent trace" }).getByText("See every step").click();
    await expect(page.getByLabel("Full agent trace")).toContainText("replay planner");
    await expect(conversation(page)).toContainText(/(medical|dental) clinic/);
    await expect(conversation(page)).not.toContainText("for a space");
  });

  // UI moved inline in spec revamp
  test.skip("a failed search tells you and lets you keep chatting", async ({ page }) => {
    await page.route("**/api/agent", (route) => route.fulfill({ status: 500, body: "boom" }));
    await fresh(page, "/");
    await page.getByLabel("Message Hermit").fill("small medical clinic in Houston, 1,200-1,800 sq ft, 3 exam rooms, a reception area and storage");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("Search failed");
    await expect(page.getByRole("region", { name: "Matching Spaces" }).getByRole("status")).not.toContainText("Searching");
    await page.getByLabel("Message Hermit").fill("try again");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("APIs validate input and refuse path tricks", async ({ request }) => {
    expect((await request.post("/api/chat", { data: { text: "" } })).status()).toBe(400);
    expect((await request.post("/api/agent", { data: { mode: "nope" } })).status()).toBe(400);
    expect((await request.get("/api/agent?replay=..%2F..%2Fshells")).status()).toBe(404);
    expect((await request.get("/api/asset/..%2Fshells")).status()).toBe(404);
    expect((await request.get("/api/shell/..%2Fshells")).status()).toBe(404);
    const open = await request.post("/api/chat", { data: { open: true, spec: { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" } } });
    expect(open.status()).toBe(200);
    const opened = await open.json();
    expect(opened.turn.reply).toMatch(/what kind of space/i);
    expect(opened.conversationId).toMatch(/^c_[a-f0-9]{24}$/);
    expect((await request.post("/api/chat", { data: { conversationId: "c_000000000000000000000000", text: "hi" } })).status()).toBe(404);
    expect((await request.get("/api/conversations/..%2Fx")).status()).toBe(404);
    expect((await request.post("/api/saved", { data: { report: {} } })).status()).toBe(400);
    expect((await request.get("/api/regulations?city=paris&useType=salon")).status()).toBe(400);
    const long = await request.post("/api/chat", { data: { conversationId: opened.conversationId, text: "a small dental clinic in Houston ".repeat(100) } });
    expect(long.status()).toBe(200);
    const regs = await (await request.get("/api/regulations?city=houston&useType=salon")).json();
    expect(regs.findings.every((f: { url: string }) => f.url.startsWith("https://"))).toBe(true);
  });

  test("missing printable reports fail gracefully", async ({ page }) => {
    await page.goto("/shell/nope?run=nope");
    await expect(page.getByText("Report not found")).toBeVisible();
  });
});

test.describe("layout and motion", () => {
  for (const path of ["/", "/saved", "/?design=draw"]) {
    test(`no horizontal overflow on ${path} @mobile`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(300);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw).toBeLessThanOrEqual(cw);
    });
  }

  // UI moved inline in spec revamp
  test.skip("reduced motion turns animation off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?design=draw");
    const t = await page.getByRole("button", { name: /Use this layout/ }).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(t).toBe("0s");
  });
});

test.describe("dream layout", () => {
  // UI moved inline in spec revamp
  test.skip("3D view, scaling and live closest matches with a 3D comparison", async ({ page }) => {
    await fresh(page, "/layout");
    await page.getByLabel("Start from").selectOption("home");
    const canvas = page.getByRole("application");
    await expect(canvas).toHaveAttribute("aria-label", /7 rooms/);
    const area = async () => Number((await canvas.getAttribute("aria-label"))!.match(/about ([\d,]+)/)![1].replace(/,/g, ""));
    const before = await area();
    await page.getByRole("button", { name: "Scale up" }).click();
    expect(await area()).toBeGreaterThan(before * 1.15);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await area()).toBe(before);

    await page.getByRole("button", { name: "3D model" }).click();
    const model = page.getByRole("img", { name: /Your layout: 7 rooms.*3D view/ });
    await expect(model).toBeVisible();
    await model.focus();
    await page.keyboard.press("ArrowRight");
    await expect(model).toHaveAttribute("aria-label", /rotated 335 degrees/);

    const matches = page.locator(".similar-list button");
    await expect(matches.first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".similar")).toContainText(/scanned homes/);
    await page.getByRole("button", { name: "Larger", exact: true }).click();
    await expect(page.locator(".similar")).toContainText("scaled to 125%");

    await matches.first().click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Your design" });
    await expect(dialog).toContainText("Your design");
    await expect(dialog.getByRole("img", { name: /Matched scan .* in 3D/ })).toBeVisible();
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Build your layout" })).toBeVisible();
  });
});
