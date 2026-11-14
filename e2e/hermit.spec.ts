import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
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

async function surveyToSearch(page: Page) {
  await fresh(page);
  await page.getByLabel("City").selectOption("houston");
  await page.getByLabel("Use Type").selectOption("medical");
  await page.getByLabel("Size").selectOption("1000-2500");
  await page.getByRole("button", { name: "Find shells" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(conversation(page)).toContainText("medical clinic in Houston");
}

test.describe("survey", () => {
  test("is short, friendly and keyboard-reachable", async ({ page }) => {
    await fresh(page);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Find a space that already fits");
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Survey" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Progress" }).getByRole("link", { name: /Survey/ })).toHaveAttribute("aria-current", "step");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    for (const label of ["City", "Use Type", "Size", "Budget", "Move-in Timing"]) await expect(page.getByLabel(label)).toBeVisible();
    await expect(page.getByRole("radio", { name: "Lease" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Buy" }).click();
    await expect(page.getByRole("radio", { name: "Buy" })).toHaveAttribute("aria-checked", "true");
    const sw = page.getByRole("switch", { name: /accessibility/i });
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    for (const chip of ["ADA Accessible", "On-site Parking", "Ground Floor", "Flexible Layout", "Patient-friendly", "Transit Nearby"]) await expect(page.getByRole("button", { name: chip })).toBeVisible();
    await page.getByRole("button", { name: "On-site Parking" }).click();
    await expect(page.getByRole("button", { name: "On-site Parking" })).toHaveAttribute("aria-pressed", "true");
    await axe(page);
  });

  test("hands off to a chat that asks only what is missing, then searches with visible thinking", async ({ page }) => {
    await surveyToSearch(page);
    await expect(conversation(page)).toContainText("How many exam rooms");
    await quick(page, "3 exam rooms with sinks").click();
    await expect(conversation(page)).toContainText("Checking local zoning laws");
    await expect(conversation(page)).toContainText("Measuring rooms in 3D scans");
    await waitForResults(page);

    const n = await cards(page).count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(5);
    await expect(cards(page).first().locator(".fit-badge")).toContainText(/\d+% Fit/);
    await expect(cards(page).first().locator("li")).toHaveCount(3);
    await expect(conversation(page)).toContainText(/I found \d+ .*best fit \(\d+%\)/);
    const trace = page.getByRole("region", { name: "Agent trace" });
    await expect(trace).toContainText(/Searched \d+ candidates/);
    await expect(trace).toContainText("Evaluated fit (layout, size, use)");
    await expect(trace).toContainText(/Ranked \d+ matching space/);
    await trace.getByText("See every step").click();
    await expect(page.getByLabel("Full agent trace")).toContainText("search_shells");
    await axe(page);
  });

  test("chat alone works without the survey", async ({ page }) => {
    await fresh(page, "/search");
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await page.getByLabel("Message Hermit").fill("I'm looking for a space for a small medical clinic in Houston. I need about 1,200-1,800 sq ft, with 3 exam rooms, a reception area, and some storage.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("Perfect, I have what I need");
    await waitForResults(page);
    await expect(cards(page).first()).toBeVisible();
  });
});

test.describe("results", () => {
  test.beforeEach(async ({ page }) => {
    await surveyToSearch(page);
    await page.getByLabel("Message Hermit").fill("3 exam rooms with sinks, a reception area, and some storage");
    await page.getByRole("button", { name: "Send" }).click();
    await waitForResults(page);
  });

  test("email drafts are obvious, editable and never sent", async ({ page, context }) => {
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

  test("full report, printable page and saving", async ({ page }) => {
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

  test("Inside, Above and Fit open evidence for the selected space", async ({ page }) => {
    if ((await cards(page).count()) > 1) {
      await cards(page).nth(1).locator("h3 button").click();
      await expect(cards(page).nth(1)).toHaveAttribute("data-selected", "true");
    }
    await page.getByRole("button", { name: "Inside" }).click();
    const panel = page.locator("#evidence-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Open 3D tour" }).click();
    await expect(panel.locator("iframe")).toHaveAttribute("src", /my\.matterport\.com/);
    await page.getByRole("button", { name: "Above" }).click();
    await expect(panel.getByRole("img", { name: /Aerial image/ })).toBeVisible();
    await page.getByRole("button", { name: "Fit" }).click();
    await expect(panel.locator("figure")).toBeVisible();
    await page.getByRole("button", { name: "Fit" }).click();
    await expect(panel).toBeHidden();
  });

  test("follow-ups compare layouts and refine the search", async ({ page }) => {
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

test.describe("layout studio", () => {
  test("build with blocks, undo/redo, zoom and snap, then match", async ({ page }) => {
    await fresh(page, "/layout");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Build your layout");
    const canvas = page.getByRole("application");
    await expect(canvas).toHaveAttribute("aria-label", /5 rooms/);

    await page.getByRole("button", { name: "Add Office" }).click();
    await expect(canvas).toHaveAttribute("aria-label", /6 rooms/);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(canvas).toHaveAttribute("aria-label", /5 rooms/);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(canvas).toHaveAttribute("aria-label", /6 rooms/);

    const office = page.getByRole("button", { name: /^Office, 10 by 10 feet/ });
    await office.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Delete");
    await expect(canvas).toHaveAttribute("aria-label", /5 rooms/);

    const before = Number((await canvas.getAttribute("aria-label"))!.match(/(\d+) objects/)![1]);
    await page.getByRole("button", { name: "Add Sink" }).dragTo(page.locator(".canvas"), { targetPosition: { x: 200, y: 200 } });
    await expect(canvas).toHaveAttribute("aria-label", new RegExp(`${before + 1} objects`));

    const pct = async () => Number((await page.getByRole("button", { name: /^Zoom \d+%/ }).innerText()).replace("%", ""));
    const start = await pct();
    await page.getByRole("button", { name: "Zoom in" }).click();
    expect(await pct()).toBeGreaterThan(start);
    await page.getByRole("button", { name: /^Zoom \d+%/ }).click();
    expect(await pct()).toBe(100);
    const snap = page.getByRole("switch", { name: /Snap to grid/ });
    await snap.click();
    await expect(snap).toHaveAttribute("aria-checked", "false");
    await axe(page);

    await page.getByLabel("Layout name").fill("Clinic A");
    await page.getByRole("button", { name: "Save layout" }).click();
    await expect(page.getByRole("status")).toContainText("Saved \u201cClinic A\u201d");
    await page.goto("/");
    await page.getByLabel(/Layout/).selectOption({ label: "Clinic A" });
    await page.getByRole("button", { name: "Find shells" }).click();
    await expect(conversation(page)).toContainText("Use my layout \u201cClinic A\u201d");
    await expect(conversation(page)).toContainText("2 exam rooms with sinks");
    await quick(page, "Houston").click();
    await waitForResults(page);
  });
});

test.describe("layout studio navigation", () => {
  test("trackpad scroll pans, pinch zooms the plan not the page, empty-space drag pans, rooms still drag accurately", async ({ page }) => {
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
    await page.getByRole("button", { name: "Fit" }).click();
    const [fx] = await vb();
    await page.locator(".canvas").evaluate((el) => el.scrollIntoView({ block: "center" }));
    const c = (await page.locator(".canvas").boundingBox())!; // clicking Fit may have scrolled the page
    await page.mouse.move(c.x + 12, c.y + 12);
    await page.mouse.down();
    await page.mouse.move(c.x + 112, c.y + 12, { steps: 5 });
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

  test("Save and New are matching toolbar buttons; Save reflects unsaved changes", async ({ page }) => {
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
  test("a warehouse search screens power", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("City").selectOption("los_angeles");
    await page.getByLabel("Use Type").selectOption("warehouse");
    await page.getByLabel("Size").selectOption("10000+");
    await page.getByRole("button", { name: "Find shells" }).click();
    await expect(conversation(page)).toContainText("heavy power");
    await quick(page, "Heavy power + 2 drive-in doors").click();
    await expect(conversation(page)).toContainText("Checking electrical requirements");
    await waitForResults(page);
  });

  test("a home purchase asks for bedrooms", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("City").selectOption("houston");
    await page.getByRole("radio", { name: "Buy" }).click();
    await page.getByLabel("Use Type").selectOption("home");
    await page.getByLabel("Budget").fill("$450,000");
    await page.getByRole("button", { name: "Find shells" }).click();
    await expect(conversation(page)).toContainText("How many bedrooms");
    await quick(page, "3 bed / 2 bath").click();
    await waitForResults(page);
  });
});

test.describe("replay and failure states", () => {
  test("the recorded demo replays with every outside request blocked", async ({ page }) => {
    await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort()));
    await fresh(page, "/search?replay=demo");
    await expect(conversation(page)).toContainText("recorded run");
    await waitForResults(page);
    await expect(cards(page).first()).toBeVisible();
    await page.getByRole("region", { name: "Agent trace" }).getByText("See every step").click();
    await expect(page.getByLabel("Full agent trace")).toContainText("replay planner");
  });

  test("APIs validate input and refuse path tricks", async ({ request }) => {
    expect((await request.post("/api/chat", { data: { text: "" } })).status()).toBe(400);
    expect((await request.post("/api/agent", { data: { mode: "nope" } })).status()).toBe(400);
    expect((await request.get("/api/agent?replay=..%2F..%2Fshells")).status()).toBe(404);
    expect((await request.get("/api/asset/..%2Fshells")).status()).toBe(404);
    expect((await request.get("/api/shell/..%2Fshells")).status()).toBe(404);
    const open = await request.post("/api/chat", { data: { open: true, spec: { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" } } });
    expect(open.status()).toBe(200);
    expect((await open.json()).reply).toMatch(/what kind of space/i);
  });

  test("missing printable reports fail gracefully", async ({ page }) => {
    await page.goto("/shell/nope?run=nope");
    await expect(page.getByText("Report not found")).toBeVisible();
  });
});

test.describe("layout and motion", () => {
  for (const path of ["/", "/search", "/layout", "/saved"]) {
    test(`no horizontal overflow on ${path} @mobile`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(300);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw).toBeLessThanOrEqual(cw);
    });
  }

  test("reduced motion turns animation off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const t = await page.getByRole("button", { name: "Find shells" }).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(t).toBe("0s");
  });
});
